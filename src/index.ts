/**
 * Access‑control service
 * ----------------------
 * Escuta eventos da catraca via `TurnstileClient`, valida o cartão RFID
 * (Tag) contra regras de horário de aula e registra o acesso no banco
 * através do Prisma.
 *
 * Somente **comentários** foram adicionados para documentar cada etapa;
 * nenhuma instrução original foi alterada.
 *
 * Variáveis de ambiente esperadas:
 *   TURNSTILE_IP      → IP da controladora
 *   TURNSTILE_PORT    → porta TCP
 *   DELAY_TOLERANCE   → tolerância, em minutos, antes/depois do início da aula
 *   TIMEZONE          → fuso horário IANA (ex.: 'America/Sao_Paulo') usado
 *                        para converter datas na lógica de horário de aula.
 */

// ------------------------- Imports & Config ------------------------------
import { PrismaClient, Class, Tag, Access } from '../generated/prisma'; // ORM data models
import TurnstileClient, { Message } from './TurnstileClient';           // driver da catraca
import dotenv from 'dotenv';
dotenv.config();                                                         // carrega .env

// ------------------------- Constantes -----------------------------------
const TURNSTILE_IP   = process.env.TURNSTILE_IP   as string;             // Endereço IP da catraca
const TURNSTILE_PORT = parseInt(process.env.TURNSTILE_PORT as string);   // Porta TCP
const DELAY_TOLERANCE= parseInt(process.env.DELAY_TOLERANCE as string);  // Tolerância (min)
const TIMEZONE       = process.env.TIMEZONE;                             // Fuso horário IANA

// ORM e driver instanciados ----------------------------------------------
const prisma     = new PrismaClient();                                   // Conexão Prisma
const turnstile  = new TurnstileClient(TURNSTILE_IP, TURNSTILE_PORT, 40);// 40 s de open‑gate

// Log de conexão ---------------------------------------------------------
turnstile.on('connect', () => {
    console.log('Connected!');
});

// ------------------------- Tipos & Estado --------------------------------
// Estrutura para guardar o cartão autorizado até o giro da catraca
// (índice da mensagem + id do cartão)
type Waiting = {
    messageIndex: number,
    tagId: number
} | null;

let waitingToTurn: Waiting = null; // nenhuma autorização pendente

// ------------------------- Tratamento de dados ---------------------------
turnstile.on('data', async (message: Message) => {
    // Data/hora local considerando o fuso IANA
    const currentDate = new Date(
        new Date().toLocaleString('en-US', { timeZone: TIMEZONE })
    );

    if (message.command == 'REON') {
        // ---------------------- Decodifica payload ----------------------
        const data: string[] = message.data.split(']');
        const eventCode: number = parseInt(data[0]); // tipo do evento

        if (eventCode == 0) { // ---------- Leitura do RFID -------------
            const tagId: number = parseInt(data[1]); // credential numérico
            if (Number.isNaN(tagId)) return;         // pacote inválido

            const way: number = parseInt(data[5]);   // 2‑entrada,3‑saída conforme firmware

            // ---------------------- Consulta Tag -----------------------
            const tag: Tag | null = await prisma.tag.findUnique({
                where: { credential: tagId }
            });
            if (!tag) return turnstile.denyAccess(message.index); // cartão desconhecido

            // Admins ignoram todas as regras
            if (tag.admin) return allowAccess(turnstile, message.index, way, tag.status, tagId);

            // Cartão bloqueado
            if (!tag.released) return turnstile.denyAccess(message.index, tag.status);

            // --------------------- Horário de Aula ---------------------
            const classes: Class[] = await prisma.class.findMany({
                where: { tag_user_id: tag.user_id }, // horários do usuário
                orderBy: { start: 'asc' }
            });
            if (!classes.length) return turnstile.denyAccess(message.index); // sem aulas cadastradas

            let foundWindow = false; // indica se atual hora está dentro de alguma janela

            for (const classElement of classes) {
                // converte minuto‑absoluto do dia para objeto Date no TZ correto
                const rawStartMinutes = classElement.start; // minutos após 00:00
                const h = Math.floor(rawStartMinutes / 60);
                const m = rawStartMinutes % 60;
                const classStartDate = new Date(currentDate);
                classStartDate.setHours(h, m, 0, 0);

                // Janela permitida: [start‑tol, start+tol]
                const windowStart = new Date(classStartDate.getTime() - DELAY_TOLERANCE * 60_000);
                const windowEnd   = new Date(classStartDate.getTime() + DELAY_TOLERANCE * 60_000);

                if (currentDate > windowEnd) {
                    // Muito depois → tenta próxima aula
                    continue;
                }

                if (currentDate < windowStart) {
                    // Chegou cedo demais
                    return turnstile.denyAccess(
                        message.index,
                        'VOLTE NO HORÁRIO DA AULA!'
                    );
                }

                foundWindow = true; // dentro do horário permitido

                // ----------------‑‑ Restrições de múltiplos acessos ------
                // Regra: 1 acesso por aula (tolerância*2 para ida/volta)
                const lastAccess: Access | null = await prisma.access.findFirst({
                    where: { tag_user_id: tag.user_id },
                    orderBy: { timestamp: 'desc' }
                });

                if (lastAccess) {
                    const blockingUntil = lastAccess.timestamp.getTime() + (DELAY_TOLERANCE * 2 * 60_000);
                    if (blockingUntil > currentDate.getTime()) {
                        return turnstile.denyAccess(message.index, 'APENAS 1 ACESSO POR AULA!');
                    }
                }

                // Tudo certo → libera catraca
                return allowAccess(turnstile, message.index, way, tag.status, tagId);
            }

            if (!foundWindow) {
                // Havia aulas, mas está atrasado para todas
                return turnstile.denyAccess(message.index, 'ATRASADO(A)!');
            }
        } else if (eventCode == 81) { // ---------- Giro da Catraca --------
            // Confirmação de passagem (sensor passou)
            if (!waitingToTurn) return; // nada pendente

            const tag: Tag | null = await prisma.tag.findUnique({
                where: { credential: waitingToTurn.tagId }
            });

            if (!tag || tag.admin) return; // admin não registra

            // Registra acesso
            await prisma.access.create({
                data: {
                    tag_user_id: tag.user_id,
                    timestamp: currentDate
                }
            });

            waitingToTurn = null; // limpo até próxima leitura
        } else if (eventCode == 82) { // ---------- Giro cancelado --------
            waitingToTurn = null; // cancelamento‑reset
        }
    }
});

// ------------------------- Helper: libera catraca ------------------------
function allowAccess(
    turnstile: TurnstileClient,
    index: number,
    way: number,
    status: string,
    tagId: number
) {
    if (way == 2) {
        turnstile.allowEntry(index, status); // entrada
    } else if (way == 3) {
        turnstile.allowExit(index, status);  // saída
    }

    // Guarda info para quando sensor de giro disparar
    waitingToTurn = {
        messageIndex: index,
        tagId
    };
}

// ------------------------- Outros Eventos -------------------------------
turnstile.on('timeout', () => {
    console.log('Error: Timeout');
});

turnstile.on('error', (error) => {
    console.log(`Error: ${error.message}`);
});

turnstile.on('close', (hadError) => {
    console.log(`Connection closed ${hadError ? 'with' : 'without'} error(s).`);
    turnstile.connect(); // tenta reconectar indefinidamente
});

// ------------------------- Loop principal --------------------------------
const delay = async (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
    while (true) {
        await delay(100); // mantém processo vivo; lógica é event‑driven
    }
}

main()
    .catch(console.log)
    .finally(async () => {
        await prisma.$disconnect(); // encerra ORM ao sair
    });
