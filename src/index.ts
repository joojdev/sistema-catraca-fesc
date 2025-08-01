/**
 * Access‑control service
 * ----------------------
 * Escuta eventos da catraca via `TurnstileClient`, valida o cartão RFID
 * (Tag) contra regras de horário de aula e registra o acesso no banco
 * através do Prisma.
 *
 * Esta versão mantém **toda a lógica original** e acrescenta:
 *   • Validação de variáveis de ambiente com Zod (fail‑fast)
 *   • Logging estruturado com Pino (JSON compatível com observabilidade)
 *   • Encerramento gracioso (SIGINT/SIGTERM) fechando conexões
 *   • Pequenas refatorações semânticas (const CONFIG)
 *
 * Variáveis de ambiente esperadas (todas obrigatórias):
 *   TURNSTILE_IP      → IP da controladora
 *   TURNSTILE_PORT    → porta TCP
 *   DELAY_TOLERANCE   → tolerância, em minutos, antes/depois do início da aula
 *   TIMEZONE          → fuso horário IANA (ex.: 'America/Sao_Paulo') usado
 *                        para converter datas na lógica de horário de aula.
 *   LOG_LEVEL         → nível do logger (debug|info|warn|error) – opcional
 */

// ------------------------- Imports & Config ------------------------------
import { PrismaClient, Class, Tag, Access } from "../generated/prisma";
import TurnstileClient, { Message } from "./TurnstileClient";
import env, { logger } from "./env";

// ------------------------- Constantes -----------------------------------
const TURNSTILE_IP = env.TURNSTILE_IP;
const TURNSTILE_PORT = env.TURNSTILE_PORT;
const DELAY_TOLERANCE = env.DELAY_TOLERANCE;
const TIMEZONE = env.TIMEZONE;

// ------------------------- Instâncias -----------------------------------
const prisma = new PrismaClient();
const turnstile = new TurnstileClient(TURNSTILE_IP, TURNSTILE_PORT, 40); // 40 s de open‑gate

// ------------------------- Tipos & Estado --------------------------------
// Estrutura para guardar o cartão autorizado até o giro da catraca
// (índice da mensagem + id do cartão)
type Waiting = {
  messageIndex: number;
  tagId: number;
} | null;

let waitingToTurn: Waiting = null; // nenhuma autorização pendente

// ------------------------- Eventos do Driver ----------------------------
turnstile.on("connect", () => {
  logger.info("Turnstile connected");
});

turnstile.on("data", async (message: Message) => {
  // Data/hora local considerando o fuso IANA
  const currentDate = new Date(
    new Date().toLocaleString("en-US", { timeZone: TIMEZONE }),
  );

  if (message.command !== "REON") return; // ignorar msgs irrelevantes

  // ---------------------- Decodifica payload --------------------------
  const data: string[] = message.data.split("]");
  const eventCode: number = parseInt(data[0]); // tipo do evento

  try {
    if (eventCode === 0) {
      await handleRFID(eventCode, data, message, currentDate);
    } else if (eventCode === 81) {
      await handleTurn(eventCode, message, currentDate);
    } else if (eventCode === 82) {
      waitingToTurn = null; // cancelamento‑reset
    }
  } catch (err) {
    logger.error({ err }, "Unhandled error processing message");
  }
});

turnstile.on("timeout", () => {
  logger.error("Turnstile timeout");
});

turnstile.on("error", (error) => {
  logger.error({ err: error }, "Turnstile driver error");
});

turnstile.on("close", (hadError) => {
  logger.warn(
    `Connection closed ${hadError ? "with" : "without"} error(s). Attempting reconnect…`,
  );
  turnstile.connect(); // tenta reconectar indefinidamente
});

// ------------------------- Handlers de Eventos --------------------------
async function handleRFID(
  _eventCode: number,
  data: string[],
  message: Message,
  currentDate: Date,
) {
  const tagId: number = parseInt(data[1]); // credential numérico
  if (Number.isNaN(tagId)) return; // pacote inválido

  const way: number = parseInt(data[5]); // 2‑entrada,3‑saída conforme firmware

  // ---------------------- Consulta Tag -------------------------------
  const tag: Tag | null = await prisma.tag.findUnique({
    where: { credential: tagId },
  });
  if (!tag) return turnstile.denyAccess(message.index); // cartão desconhecido

  // Admins ignoram todas as regras
  if (tag.admin)
    return allowAccess(turnstile, message.index, way, tag.status, tagId);

  // Cartão bloqueado
  if (!tag.released) return turnstile.denyAccess(message.index, tag.status);

  // --------------------- Horário de Aula -----------------------------
  const classes: Class[] = await prisma.class.findMany({
    where: { tag_user_id: tag.user_id },
    orderBy: { start: "asc" },
  });
  if (!classes.length) return turnstile.denyAccess(message.index); // sem aulas cadastradas

  let foundWindow = false;

  for (const classElement of classes) {
    const rawStartMinutes = classElement.start; // minutos após 00:00
    const h = Math.floor(rawStartMinutes / 60);
    const m = rawStartMinutes % 60;
    const classStartDate = new Date(currentDate);
    classStartDate.setHours(h, m, 0, 0);

    // Janela permitida: [start‑tol, start+tol]
    const windowStart = new Date(
      classStartDate.getTime() - DELAY_TOLERANCE * 60_000,
    );
    const windowEnd = new Date(
      classStartDate.getTime() + DELAY_TOLERANCE * 60_000,
    );

    if (currentDate > windowEnd) {
      continue; // muito depois → tenta próxima aula
    }

    if (currentDate < windowStart) {
      return turnstile.denyAccess(message.index, "VOLTE NO HORÁRIO DA AULA!");
    }

    foundWindow = true; // dentro do horário permitido

    // ----------------‑‑ Restrições de múltiplos acessos -------------
    const lastAccess: Access | null = await prisma.access.findFirst({
      where: { tag_user_id: tag.user_id },
      orderBy: { timestamp: "desc" },
    });

    if (lastAccess) {
      const blockingUntil =
        lastAccess.timestamp.getTime() + DELAY_TOLERANCE * 2 * 60_000;
      if (blockingUntil > currentDate.getTime()) {
        return turnstile.denyAccess(message.index, "APENAS 1 ACESSO POR AULA!");
      }
    }

    // Tudo certo → libera catraca
    return allowAccess(turnstile, message.index, way, tag.status, tagId);
  }

  if (!foundWindow) {
    return turnstile.denyAccess(message.index, "ATRASADO(A)!");
  }
}

async function handleTurn(
  _eventCode: number,
  message: Message,
  currentDate: Date,
) {
  if (!waitingToTurn) return; // nada pendente

  const tag: Tag | null = await prisma.tag.findUnique({
    where: { credential: waitingToTurn.tagId },
  });
  if (!tag || tag.admin) return; // admin não registra

  await prisma.access.create({
    data: {
      tag_user_id: tag.user_id,
      timestamp: currentDate,
    },
  });

  waitingToTurn = null; // limpo até próxima leitura
}

// ------------------------- Helper: libera catraca ------------------------
function allowAccess(
  turnstile: TurnstileClient,
  index: number,
  way: number,
  status: string,
  tagId: number,
) {
  if (way === 2) {
    turnstile.allowEntry(index, status);
  } else if (way === 3) {
    turnstile.allowExit(index, status);
  }

  // Guarda info para quando sensor de giro disparar
  waitingToTurn = {
    messageIndex: index,
    tagId,
  };
}

// ------------------------- Loop principal --------------------------------
const delay = async (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  while (true) {
    await delay(100); // mantém processo vivo; lógica é event‑driven
  }
}

// ------------------------- Shutdown Gracioso -----------------------------
async function shutdown(signal: string) {
  try {
    logger.info(`Received ${signal}. Shutting down gracefully…`);
    await prisma.$disconnect();
    process.exit(0);
  } catch (err) {
    logger.error({ err }, "Error during shutdown");
    process.exit(1);
  }
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// ------------------------- Bootstrap -------------------------------------
main().catch((err) => logger.error({ err }, "Fatal error in main loop"));
