import env, { logger } from '@/infrastructure/config/env'
import ky from 'ky'
import { z } from 'zod'
import { Lockfile } from '@/utils/Lockfile'
import { WeekDay } from '@/domain/enum/week-day'
import TagPrismaRepository from '@/infrastructure/database/prisma/repositories/tag.prisma.repository'
import TagService from '@/application/services/tag.service'
import ClassPrismaRepository from '@/infrastructure/database/prisma/repositories/class.prisma.repository'
import ClassService from '@/application/services/class.service'
import AccessPrismaRepository from '@/infrastructure/database/prisma/repositories/access.prisma.repository'
import AccessService from '@/application/services/access.service'
import { Status } from '@/domain/enum/status'

/**
 * Mapeamento de abreviações de dias da semana em português para enum WeekDay
 * Converte: dom -> sunday, seg -> monday, etc.
 */
const weekDays: { [key: string]: string } = {
  dom: 'sunday',
  seg: 'monday',
  ter: 'tuesday',
  qua: 'wednesday',
  qui: 'thursday',
  sex: 'friday',
  sab: 'saturday',
}

/**
 * Estrutura do corpo da requisição POST para enviar dados de acesso
 * Array com informações de cada acesso realizado
 */
type PostRequestBody = {
  acesso: number // Timestamp do acesso (em milissegundos)
  aluno: number // ID do aluno/usuário
  id_acesso: string // ID único do registro de acesso
}[]

/**
 * Schema de validação para resposta da API ao enviar dados de acesso (POST)
 * Valida array de objetos com status de processamento de cada acesso
 */
const PostApiResponseSchema = z.array(
  z.object({
    acesso: z.string(), // ID do acesso processado
    status: z
      .enum(['success', 'failed'])
      .transform((value) => value === 'success'), // Converte string para boolean
    message: z.string(), // Mensagem de status/erro
  }),
)

/**
 * Converte horário no formato "HH:MM:SS" para minutos desde meia-noite
 * Exemplo: "14:30:00" -> 870 minutos (14*60 + 30)
 */
function timeToMinutes(time: string): number {
  const [hh, mm] = time.split(':').map((number) => parseInt(number))
  return hh * 60 + mm
}

/**
 * Schema para validação e transformação de horários vindos da API
 * Valida formato de hora e converte dias da semana
 */
const HourSchema = z
  .object({
    hora: z
      .string()
      .regex(
        /^(?:[0-9]|1[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/,
        'The hour must be in the format H:MM:SS or HH:MM:SS!',
      ), // Valida formato HH:MM:SS
    dias: z.array(z.enum(Object.keys(weekDays) as [string, ...string[]])), // Dias válidos
  })
  .transform(
    ({
      hora: start,
      dias: receivedWeekDays,
    }: {
      hora: string
      dias: string[]
    }) =>
      [
        timeToMinutes(start), // Converte hora para minutos
        receivedWeekDays.map((receivedWeekDay) => weekDays[receivedWeekDay]), // Mapeia dias
      ] as [number, WeekDay[]],
  )

/**
 * Schema de validação para dados de usuário vindos da API (GET)
 * Define estrutura e tipos esperados para cada usuário
 */
const GetApiResponseSchema = z.object({
  aluno_id: z.coerce.number(), // ID do aluno (converte string para number)
  credencial: z.coerce.number(), // Número da credencial/tag RFID
  horarios: z.array(HourSchema), // Array de horários de aula
  liberado: z.boolean(), // Se o acesso está liberado
  status: z.string().nonempty(), // Status textual (ex: "Ativo", "Pendente")
  admin: z.boolean(), // Se é administrador
})

type GetApiResponse = z.infer<typeof GetApiResponseSchema>

/**
 * Função principal de importação de dados
 * Executa duas operações principais:
 * 1. Importa dados de usuários, tags e horários da API externa
 * 2. Envia dados de acesso registrados localmente para a API externa
 */
export default async function runImport(): Promise<void> {
  // Inicializa repositórios e serviços
  const tagRepository = new TagPrismaRepository()
  const tagService = new TagService(tagRepository)

  const classRepository = new ClassPrismaRepository()
  const classService = new ClassService(classRepository)

  const accessRepository = new AccessPrismaRepository()
  const accessService = new AccessService(accessRepository)

  // Cria lockfile para prevenir execuções simultâneas (timeout: 60s)
  const lockfile = new Lockfile('import', 60)

  logger.info('Iniciando processo de importação...')

  // Tenta adquirir o lock - se já estiver em execução, sai
  if (!lockfile.acquire()) {
    logger.warn('Importação já está em execução - abortando')
    return
  }

  // Monta URL da API para buscar dados
  const url = new URL(env.API_URL)
  url.pathname = '/api/catraca'

  let data: GetApiResponse[]

  try {
    // ===== FASE 1: IMPORTAÇÃO DE DADOS =====
    logger.info('Buscando dados da API externa...')

    // Faz requisição GET para buscar dados de usuários
    data = await ky
      .get(url.toString(), {
        headers: {
          Token: env.API_TOKEN, // Token de autenticação
        },
      })
      .json()
  } catch (error) {
    logger.error({ err: error }, 'Erro ao buscar dados da API externa')
    lockfile.release()
    return
  }

  // Valida dados recebidos da API
  const validUsers: GetApiResponse[] = []

  for (const item of data) {
    const result = GetApiResponseSchema.safeParse(item)
    if (result.success) {
      validUsers.push(result.data)
    } else {
      // Log de usuários com dados inválidos para auditoria
      logger.warn(
        {
          aluno_id: item?.aluno_id,
          reason: result.error.issues.map((e) => e.message).join('; '),
        },
        'Entrada de usuário inválida ignorada durante importação',
      )
    }
  }

  // Verifica se há dados válidos para processar
  if (validUsers.length === 0) {
    logger.warn(
      'Todas as entradas de usuário eram inválidas - nada para importar',
    )
    lockfile.release()
    return
  }

  logger.info({ count: validUsers.length }, 'Processando usuários válidos...')

  // Processa cada usuário válido
  for (const user of validUsers) {
    try {
      // Cria ou atualiza tag do usuário
      await tagService.createOrUpdate({
        admin: user.admin,
        credential: user.credencial,
        released: user.liberado,
        status: user.status,
        userId: user.aluno_id,
      })

      // Remove horários antigos do usuário para evitar duplicatas
      await classService.deleteFromUserId({
        id: user.aluno_id,
      })

      // Só cria horários se usuário estiver liberado ou for admin
      if (!user.liberado && !user.admin) {
        logger.debug(
          { userId: user.aluno_id },
          'Usuário não liberado - pulando criação de horários',
        )
        continue
      }

      // Cria novos horários de aula
      for (const [start, weekDayList] of user.horarios) {
        for (const weekDay of weekDayList) {
          await classService.create({
            start, // Horário de início em minutos
            weekDay, // Dia da semana
            userId: user.aluno_id,
          })
        }
      }
    } catch (error) {
      logger.error(
        { err: error, userId: user.aluno_id },
        'Erro ao processar usuário específico',
      )
      // Continua processando outros usuários mesmo se um falhar
    }
  }

  logger.info('Importação de dados finalizada!')
  lockfile.release()

  // ===== FASE 2: ENVIO DE DADOS DE ACESSO =====
  logger.info('Iniciando envio de dados de acesso...')

  // Busca acessos que ainda não foram enviados para a API externa
  const waitingAccesses = await accessService.getWaitingAccesses()

  if (!waitingAccesses.length) {
    logger.info('Nenhum dado de acesso pendente para enviar')
    return
  }

  logger.info(
    { count: waitingAccesses.length },
    'Enviando registros de acesso...',
  )

  // Prepara dados no formato esperado pela API
  const requestBody: PostRequestBody = waitingAccesses.map(
    ({ timestamp, id, tagUserId }) => ({
      // Ajusta timestamp para fuso horário (subtrai 3 horas = UTC-3)
      acesso: timestamp.getTime() - 1000 * 60 * 60 * 3,
      aluno: tagUserId,
      id_acesso: id,
    }),
  )

  try {
    // Envia dados de acesso via POST
    data = await ky
      .post(url.toString(), {
        headers: {
          Token: env.API_TOKEN,
          'Content-Type': 'application/json',
        },
        json: requestBody,
      })
      .json()
  } catch (error) {
    logger.error(
      { err: error },
      'Erro ao enviar dados de acesso para API externa',
    )
    return
  }

  // Valida resposta da API
  const parsed = PostApiResponseSchema.safeParse(data)

  if (!parsed.success) {
    logger.error(
      { errors: parsed.error.issues },
      'Erro na estrutura da resposta POST da API',
    )
    return
  }

  // Atualiza status local baseado na resposta da API
  for (const response of parsed.data) {
    try {
      await accessService.updateStatus({
        id: response.acesso,
        status: response.status ? Status.granted : Status.revoked,
      })
    } catch (error) {
      logger.error(
        { err: error, accessId: response.acesso },
        'Erro ao atualizar status de acesso local',
      )
    }
  }

  logger.info('Envio de dados de acesso finalizado com sucesso!')
}
