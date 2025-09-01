import TurnstileClient, {
  Message,
} from './infrastructure/clients/TurnstileClient'
import env, { logger } from './infrastructure/config/env'
import { Lockfile } from './utils/Lockfile'
import text from './utils/i18n'
import TagService from './application/services/tag.service'
import TagPrismaRepository from './infrastructure/database/prisma/repositories/tag.prisma.repository'
import ClassPrismaRepository from './infrastructure/database/prisma/repositories/class.prisma.repository'
import ClassService from './application/services/class.service'
import AccessPrismaRepository from './infrastructure/database/prisma/repositories/access.prisma.repository'
import AccessService from './application/services/access.service'
import { WeekDay } from './domain/enum/week-day'
import TagRepository from './domain/repositories/tag.repository'
import ClassRepository from './domain/repositories/class.repository'
import AccessRepository from './domain/repositories/access.repository'

const TURNSTILE_IP = env.TURNSTILE_IP
const TURNSTILE_PORT = env.TURNSTILE_PORT
const DELAY_TOLERANCE = env.DELAY_TOLERANCE
const TIMEZONE = env.TIMEZONE

type Waiting = {
  messageIndex: number
  tagId: number
} | null

class TurnstileOrchestrator {
  private turnstile: TurnstileClient
  private tagRepository: TagRepository
  private tagService: TagService
  private classRepository: ClassRepository
  private classService: ClassService
  private accessRepository: AccessRepository
  private accessService: AccessService
  private lockfile: Lockfile

  private waitingToTurn: Waiting = null

  constructor() {
    this.turnstile = new TurnstileClient(TURNSTILE_IP, TURNSTILE_PORT, 4)

    this.tagRepository = new TagPrismaRepository()
    this.tagService = new TagService(this.tagRepository)

    this.classRepository = new ClassPrismaRepository()
    this.classService = new ClassService(this.classRepository)

    this.accessRepository = new AccessPrismaRepository()
    this.accessService = new AccessService(this.accessRepository)

    this.lockfile = new Lockfile('import', 60)
  }

  initializeTurnstile() {
    this.turnstile.on('connect', () => {
      logger.info('Turnstile connected')
    })

    this.turnstile.on('data', async (message: Message) => {
      const currentDate = new Date(
        new Date().toLocaleString('en-US', { timeZone: TIMEZONE }),
      )

      if (message.command !== 'REON') return

      const data: string[] = message.data.split(']')
      const eventCode: number = parseInt(data[0])

      try {
        if (eventCode === 0) {
          await this.handleRFID(eventCode, data, message, currentDate)
        } else if (eventCode === 81) {
          await this.handleTurn(eventCode, message, currentDate)
        } else if (eventCode === 82) {
          this.waitingToTurn = null
        }
      } catch (err) {
        logger.error({ err }, 'Unhandled error processing message')
      }
    })

    this.turnstile.on('timeout', () => {
      logger.error('Turnstile timeout')
    })

    this.turnstile.on('error', (error) => {
      logger.error({ err: error }, 'Turnstile driver error')
    })

    this.turnstile.on('close', (hadError) => {
      logger.warn(
        `Connection closed ${hadError ? 'with' : 'without'} error(s). Attempting reconnect…`,
      )
      this.turnstile.connect()
    })
  }

  async handleRFID(
    _eventCode: number,
    data: string[],
    message: Message,
    currentDate: Date,
  ) {
    const tagId: number = parseInt(data[1])
    if (Number.isNaN(tagId)) return

    const way: number = parseInt(data[5])

    if (this.lockfile.isLocked()) {
      return this.turnstile.denyAccess(message.index, text.waitSystemIsUpdating)
    }

    const tag = await this.tagService.getByCredential({
      credential: tagId,
    })

    if (!tag) return this.turnstile.denyAccess(message.index)

    if (tag.admin)
      return this.allowAccess(
        this.turnstile,
        message.index,
        way,
        tag.status,
        tagId,
      )

    if (!tag.released)
      return this.turnstile.denyAccess(message.index, tag.status)

    const lastAccess = await this.accessService.getLastAccessFromUserId({
      userId: tag.userId,
    })

    if (lastAccess) {
      const blockingUntil =
        lastAccess.timestamp.getTime() + DELAY_TOLERANCE * 2 * 60_000
      if (blockingUntil > currentDate.getTime()) {
        return this.turnstile.denyAccess(message.index, text.onlyOneAccess)
      }
    }

    const weekDays: WeekDay[] = [
      WeekDay.sunday,
      WeekDay.monday,
      WeekDay.tuesday,
      WeekDay.wednesday,
      WeekDay.thursday,
      WeekDay.friday,
      WeekDay.saturday,
    ]

    const today = weekDays[currentDate.getDay()]

    const classes = await this.classService.getClassesFromUserIdAndWeekDay({
      userId: tag.userId,
      weekDay: today,
    })

    if (!classes.length) return this.turnstile.denyAccess(message.index)

    for (const classElement of classes) {
      const rawStartMinutes = classElement.start
      const h = Math.floor(rawStartMinutes / 60)
      const m = rawStartMinutes % 60

      const classStartDate = new Date(currentDate)
      classStartDate.setHours(h, m, 0, 0)

      const windowStart = new Date(
        classStartDate.getTime() - DELAY_TOLERANCE * 60_000,
      )
      const windowEnd = new Date(
        classStartDate.getTime() + DELAY_TOLERANCE * 60_000,
      )

      if (currentDate > windowEnd) {
        continue
      }

      if (currentDate < windowStart) {
        continue
      }

      return this.allowAccess(
        this.turnstile,
        message.index,
        way,
        tag.status,
        tagId,
      )
    }

    return this.turnstile.denyAccess(message.index, text.outOfSchedule)
  }

  async handleTurn(_eventCode: number, _message: Message, currentDate: Date) {
    if (!this.waitingToTurn) return

    const tag = await this.tagService.getByCredential({
      credential: this.waitingToTurn.tagId,
    })

    if (!tag || tag.admin) return

    await this.accessService.create({
      userId: tag.userId,
      timestamp: currentDate,
    })

    this.waitingToTurn = null
  }

  async allowAccess(
    turnstile: TurnstileClient,
    index: number,
    way: number,
    status: string,
    tagId: number,
  ) {
    if (way === 2) {
      await turnstile.allowEntry(index, status)
    } else if (way === 3) {
      await turnstile.allowExit(index, status)
    }

    this.waitingToTurn = {
      messageIndex: index,
      tagId,
    }
  }
}

const delay = async (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms))

async function main() {
  const orchestrator = new TurnstileOrchestrator()

  orchestrator.initializeTurnstile()

  while (true) {
    await delay(100)
  }
}

async function shutdown(signal: string) {
  try {
    logger.info(`Received ${signal}. Shutting down gracefully…`)
    process.exit(0)
  } catch (err) {
    logger.error({ err }, 'Error during shutdown')
    process.exit(1)
  }
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

main().catch((err) => logger.error({ err }, 'Fatal error in main loop'))
