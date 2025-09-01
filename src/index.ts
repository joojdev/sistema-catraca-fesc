import TurnstileClient, {
  Message,
} from '@/infrastructure/clients/TurnstileClient'
import env, { logger } from '@/infrastructure/config/env'
import { Lockfile } from '@/utils/Lockfile'
import text from '@/utils/i18n'
import TagService from '@/application/services/tag.service'
import TagPrismaRepository from '@/infrastructure/database/prisma/repositories/tag.prisma.repository'
import ClassPrismaRepository from '@/infrastructure/database/prisma/repositories/class.prisma.repository'
import ClassService from '@/application/services/class.service'
import AccessPrismaRepository from '@/infrastructure/database/prisma/repositories/access.prisma.repository'
import AccessService from '@/application/services/access.service'
import { WeekDay } from '@/domain/enum/week-day'
import TagRepository from '@/domain/repositories/tag.repository'
import ClassRepository from '@/domain/repositories/class.repository'
import AccessRepository from '@/domain/repositories/access.repository'

// Constantes de configuração extraídas do ambiente
const TURNSTILE_IP = env.TURNSTILE_IP
const TURNSTILE_PORT = env.TURNSTILE_PORT
const DELAY_TOLERANCE = env.DELAY_TOLERANCE // Tolerância em minutos para entrada/saída
const TIMEZONE = env.TIMEZONE

// Constantes para códigos de evento da catraca
const EVENT_CODES = {
  RFID_READ: 0, // Leitura de cartão RFID
  TURN_START: 81, // Início da rotação da catraca
  TURN_END: 82, // Fim da rotação da catraca
} as const

// Constantes para direções de acesso
const ACCESS_DIRECTIONS = {
  ENTRY: 2, // Entrada
  EXIT: 3, // Saída
} as const

// Interface para controlar estado de espera da catraca
interface WaitingToTurn {
  messageIndex: number
  tagId: number
}

/**
 * Orquestrador principal para controle de acesso via catraca RFID.
 * Gerencia autenticação, validação de horários e controle de entrada/saída.
 */
class TurnstileOrchestrator {
  private readonly turnstile: TurnstileClient
  private readonly tagRepository: TagRepository
  private readonly tagService: TagService
  private readonly classRepository: ClassRepository
  private readonly classService: ClassService
  private readonly accessRepository: AccessRepository
  private readonly accessService: AccessService
  private readonly lockfile: Lockfile

  // Estado para controlar quando alguém está aguardando passar pela catraca
  private waitingToTurn: WaitingToTurn | null = null

  // Cache dos dias da semana para evitar recriação constante
  private readonly weekDays: readonly WeekDay[] = [
    WeekDay.sunday,
    WeekDay.monday,
    WeekDay.tuesday,
    WeekDay.wednesday,
    WeekDay.thursday,
    WeekDay.friday,
    WeekDay.saturday,
  ] as const

  constructor() {
    // Inicializa cliente da catraca com retry de 4 tentativas
    this.turnstile = new TurnstileClient(TURNSTILE_IP, TURNSTILE_PORT, 4)

    // Inicializa repositórios e serviços usando injeção de dependência
    this.tagRepository = new TagPrismaRepository()
    this.tagService = new TagService(this.tagRepository)

    this.classRepository = new ClassPrismaRepository()
    this.classService = new ClassService(this.classRepository)

    this.accessRepository = new AccessPrismaRepository()
    this.accessService = new AccessService(this.accessRepository)

    // Lockfile para prevenir conflitos durante atualizações do sistema
    this.lockfile = new Lockfile('import', 60)
  }

  /**
   * Inicializa os event listeners da catraca e configura o tratamento de mensagens
   */
  initializeTurnstile(): void {
    this.turnstile.on('connect', () => {
      logger.info('Catraca conectada com sucesso')
    })

    this.turnstile.on('data', async (message: Message) => {
      await this.processMessage(message)
    })

    this.turnstile.on('timeout', () => {
      logger.error('Timeout na conexão com a catraca')
    })

    this.turnstile.on('error', (error) => {
      logger.error({ err: error }, 'Erro no driver da catraca')
    })

    this.turnstile.on('close', (hadError) => {
      logger.warn(
        `Conexão fechada ${hadError ? 'com' : 'sem'} erro(s). Tentando reconectar...`,
      )
      this.turnstile.connect()
    })
  }

  /**
   * Processa mensagens recebidas da catraca
   */
  private async processMessage(message: Message): Promise<void> {
    const currentDate = this.getCurrentDate()

    // Só processa comandos REON (Read Event On)
    if (message.command !== 'REON') return

    const data = message.data.split(']')
    const eventCode: number = parseInt(data[0])

    try {
      switch (eventCode) {
        case EVENT_CODES.RFID_READ:
          await this.handleRFID(data, message, currentDate)
          break
        case EVENT_CODES.TURN_START:
          await this.handleTurnStart(message, currentDate)
          break
        case EVENT_CODES.TURN_END:
          this.handleTurnEnd()
          break
        default:
          logger.debug({ eventCode }, 'Código de evento não reconhecido')
      }
    } catch (err) {
      logger.error(
        { err, eventCode, messageData: message.data },
        'Erro não tratado ao processar mensagem da catraca',
      )
    }
  }

  /**
   * Obtém a data atual no fuso horário configurado
   */
  private getCurrentDate(): Date {
    return new Date(new Date().toLocaleString('en-US', { timeZone: TIMEZONE }))
  }

  /**
   * Trata eventos de leitura de cartão RFID
   */
  private async handleRFID(
    data: string[],
    message: Message,
    currentDate: Date,
  ): Promise<void> {
    const tagId: number = parseInt(data[1])
    const way: number = parseInt(data[5]) // Direção: 2=entrada, 3=saída

    // Valida se o ID da tag é válido
    if (Number.isNaN(tagId)) {
      logger.warn({ rawData: data }, 'ID de tag inválido recebido')
      return
    }

    // Verifica se sistema está em manutenção
    if (this.lockfile.isLocked()) {
      logger.info('Acesso negado: sistema em atualização')
      return this.turnstile.denyAccess(message.index, text.waitSystemIsUpdating)
    }

    // Busca informações da tag
    const tag = await this.tagService.getByCredential({
      credential: tagId,
    })

    if (!tag) {
      logger.warn({ tagId }, 'Tag não encontrada no sistema')
      return this.turnstile.denyAccess(message.index)
    }

    // Administradores têm acesso total
    if (tag.admin) {
      logger.info(
        { tagId, userId: tag.userId },
        'Acesso de administrador autorizado',
      )
      return this.allowAccess(message.index, way, tag.status, tagId)
    }

    // Verifica se a tag está liberada para uso
    if (!tag.released) {
      logger.info(
        { tagId, userId: tag.userId },
        'Acesso negado: tag não liberada',
      )
      return this.turnstile.denyAccess(message.index, tag.status)
    }

    // Verifica controle anti-spam (múltiplas tentativas muito próximas)
    const isBlocked = await this.checkAccessSpamProtection(
      tag.userId,
      currentDate,
    )
    if (isBlocked) {
      logger.info(
        { tagId, userId: tag.userId },
        'Acesso negado: tentativas muito frequentes',
      )
      return this.turnstile.denyAccess(message.index, text.onlyOneAccess)
    }

    // Verifica se usuário tem aulas agendadas para hoje
    const hasValidClass = await this.validateUserSchedule(
      tag.userId,
      currentDate,
    )
    if (!hasValidClass) {
      logger.info(
        { tagId, userId: tag.userId },
        'Acesso negado: fora do horário de aula',
      )
      return this.turnstile.denyAccess(message.index, text.outOfSchedule)
    }

    logger.info({ tagId, userId: tag.userId }, 'Acesso autorizado')
    return this.allowAccess(message.index, way, tag.status, tagId)
  }

  /**
   * Verifica proteção contra spam de tentativas de acesso
   */
  private async checkAccessSpamProtection(
    userId: number,
    currentDate: Date,
  ): Promise<boolean> {
    const lastAccess = await this.accessService.getLastAccessFromUserId({
      userId,
    })

    if (!lastAccess) return false

    const blockingUntil =
      lastAccess.timestamp.getTime() + DELAY_TOLERANCE * 2 * 60_000
    return blockingUntil > currentDate.getTime()
  }

  /**
   * Valida se o usuário tem aulas no horário atual
   */
  private async validateUserSchedule(
    userId: number,
    currentDate: Date,
  ): Promise<boolean> {
    const today = this.weekDays[currentDate.getDay()]

    const classes = await this.classService.getClassesFromUserIdAndWeekDay({
      userId,
      weekDay: today,
    })

    if (!classes.length) return false

    // Verifica se alguma aula está dentro da janela de tolerância
    return classes.some((classElement) => {
      const { windowStart, windowEnd } = this.calculateClassTimeWindow(
        classElement.start,
        currentDate,
      )

      return currentDate >= windowStart && currentDate <= windowEnd
    })
  }

  /**
   * Calcula a janela de tempo válida para uma aula (com tolerância)
   */
  private calculateClassTimeWindow(
    startMinutes: number,
    currentDate: Date,
  ): {
    windowStart: Date
    windowEnd: Date
  } {
    const hours = Math.floor(startMinutes / 60)
    const minutes = startMinutes % 60

    const classStartDate = new Date(currentDate)
    classStartDate.setHours(hours, minutes, 0, 0)

    const toleranceMs = DELAY_TOLERANCE * 60_000

    return {
      windowStart: new Date(classStartDate.getTime() - toleranceMs),
      windowEnd: new Date(classStartDate.getTime() + toleranceMs),
    }
  }

  /**
   * Trata início da rotação da catraca (evento 81)
   */
  private async handleTurnStart(
    _message: Message,
    currentDate: Date,
  ): Promise<void> {
    if (!this.waitingToTurn) {
      logger.warn('Rotação da catraca iniciada sem usuário aguardando')
      return
    }

    const tag = await this.tagService.getByCredential({
      credential: this.waitingToTurn.tagId,
    })

    // Só registra acesso para usuários não-admin
    if (!tag || tag.admin) {
      this.waitingToTurn = null
      return
    }

    try {
      await this.accessService.create({
        userId: tag.userId,
        timestamp: currentDate,
      })

      logger.info(
        {
          userId: tag.userId,
          tagId: this.waitingToTurn.tagId,
        },
        'Acesso registrado com sucesso',
      )
    } catch (error) {
      logger.error(
        {
          err: error,
          userId: tag.userId,
          tagId: this.waitingToTurn.tagId,
        },
        'Erro ao registrar acesso',
      )
    } finally {
      this.waitingToTurn = null
    }
  }

  /**
   * Trata fim da rotação da catraca (evento 82)
   */
  private handleTurnEnd(): void {
    if (this.waitingToTurn) {
      logger.info('Rotação da catraca cancelada')
    }
    this.waitingToTurn = null
  }

  /**
   * Autoriza acesso e configura estado de espera
   */
  private async allowAccess(
    index: number,
    way: number,
    status: string,
    tagId: number,
  ): Promise<void> {
    try {
      if (way === ACCESS_DIRECTIONS.ENTRY) {
        await this.turnstile.allowEntry(index, status)
        logger.debug({ tagId }, 'Entrada autorizada')
      } else if (way === ACCESS_DIRECTIONS.EXIT) {
        await this.turnstile.allowExit(index, status)
        logger.debug({ tagId }, 'Saída autorizada')
      } else {
        logger.warn({ way, tagId }, 'Direção de acesso não reconhecida')
        return
      }

      // Configura estado de espera para registrar acesso quando catraca girar
      this.waitingToTurn = {
        messageIndex: index,
        tagId,
      }
    } catch (error) {
      logger.error(
        { err: error, tagId, way },
        'Erro ao autorizar acesso na catraca',
      )
    }
  }

  /**
   * Inicia conexão com a catraca
   */
  async start(): Promise<void> {
    logger.info('Iniciando orquestrador da catraca...')
    this.initializeTurnstile()
    await this.turnstile.connect()
  }

  /**
   * Para o orquestrador graciosamente
   */
  async stop(): Promise<void> {
    logger.info('Parando orquestrador da catraca...')
    // Aqui vai código para parar serviços, se for preciso no futuro.
  }
}

/**
 * Utilitário para delay assíncrono
 */
const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Função principal da aplicação
 */
async function main(): Promise<void> {
  const orchestrator = new TurnstileOrchestrator()

  try {
    await orchestrator.start()

    logger.info('Sistema de controle de acesso inicializado')

    // Loop principal - mantém a aplicação rodando
    while (true) {
      await delay(1000) // Reduzido para 1s para melhor responsividade
    }
  } catch (error) {
    logger.error({ err: error }, 'Erro crítico na inicialização')
    throw error
  }
}

/**
 * Função para shutdown gracioso da aplicação
 */
async function shutdown(signal: string): Promise<void> {
  try {
    logger.info(
      `Recebido sinal ${signal}. Encerrando aplicação graciosamente...`,
    )

    // Aqui você pode adicionar cleanup adicional se necessário
    // await orchestrator.stop()

    process.exit(0)
  } catch (err) {
    logger.error({ err }, 'Erro durante o shutdown')
    process.exit(1)
  }
}

// Registra handlers para sinais de sistema
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
process.on('uncaughtException', (error) => {
  logger.error({ err: error }, 'Exceção não capturada')
  process.exit(1)
})
process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Promise rejection não tratada')
  process.exit(1)
})

// Inicia a aplicação
main().catch((err) => {
  logger.error({ err }, 'Erro fatal no loop principal')
  process.exit(1)
})
