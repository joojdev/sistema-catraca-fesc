import TurnstileClient, { Message } from './TurnstileClient'
import env, { logger } from './env'
import { Lockfile } from './utils/Lockfile'
import text from './utils/i18n'
import TagService from './application/services/tag.service'
import TagPrismaRepository from './database/prisma/repositories/tag.prisma.repository'
import ClassPrismaRepository from './database/prisma/repositories/class.prisma.repository'
import ClassService from './application/services/class.service'
import AccessPrismaRepository from './database/prisma/repositories/access.prisma.repository'
import AccessService from './application/services/access.service'
import { WeekDay } from './domain/enum/week-day'

const TURNSTILE_IP = env.TURNSTILE_IP
const TURNSTILE_PORT = env.TURNSTILE_PORT
const DELAY_TOLERANCE = env.DELAY_TOLERANCE
const TIMEZONE = env.TIMEZONE

const turnstile = new TurnstileClient(TURNSTILE_IP, TURNSTILE_PORT, 4)

const tagRepository = new TagPrismaRepository()
const tagService = new TagService(tagRepository)

const classRepository = new ClassPrismaRepository()
const classService = new ClassService(classRepository)

const accessRepository = new AccessPrismaRepository()
const accessService = new AccessService(accessRepository)

type Waiting = {
  messageIndex: number
  tagId: number
} | null

let waitingToTurn: Waiting = null

const lockfile = new Lockfile('import', 60)

turnstile.on('connect', () => {
  logger.info('Turnstile connected')
})

turnstile.on('data', async (message: Message) => {
  const currentDate = new Date(
    new Date().toLocaleString('en-US', { timeZone: TIMEZONE }),
  )

  if (message.command !== 'REON') return

  const data: string[] = message.data.split(']')
  const eventCode: number = parseInt(data[0])

  try {
    if (eventCode === 0) {
      await handleRFID(eventCode, data, message, currentDate)
    } else if (eventCode === 81) {
      await handleTurn(eventCode, message, currentDate)
    } else if (eventCode === 82) {
      waitingToTurn = null
    }
  } catch (err) {
    logger.error({ err }, 'Unhandled error processing message')
  }
})

turnstile.on('timeout', () => {
  logger.error('Turnstile timeout')
})

turnstile.on('error', (error) => {
  logger.error({ err: error }, 'Turnstile driver error')
})

turnstile.on('close', (hadError) => {
  logger.warn(
    `Connection closed ${hadError ? 'with' : 'without'} error(s). Attempting reconnect…`,
  )
  turnstile.connect()
})

async function handleRFID(
  _eventCode: number,
  data: string[],
  message: Message,
  currentDate: Date,
) {
  const tagId: number = parseInt(data[1])
  if (Number.isNaN(tagId)) return

  const way: number = parseInt(data[5])

  if (lockfile.isLocked()) {
    return turnstile.denyAccess(message.index, text.waitSystemIsUpdating)
  }

  const tag = await tagService.getByCredential({
    credential: tagId,
  })

  if (!tag) return turnstile.denyAccess(message.index)

  if (tag.admin)
    return allowAccess(turnstile, message.index, way, tag.status, tagId)

  if (!tag.released) return turnstile.denyAccess(message.index, tag.status)

  const lastAccess = await accessService.getLastAccessFromUserId({
    userId: tag.userId,
  })

  if (lastAccess) {
    const blockingUntil =
      lastAccess.timestamp.getTime() + DELAY_TOLERANCE * 2 * 60_000
    if (blockingUntil > currentDate.getTime()) {
      return turnstile.denyAccess(message.index, text.onlyOneAccess)
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

  const classes = await classService.getClassesFromUserIdAndWeekDay({
    userId: tag.userId,
    weekDay: today,
  })

  if (!classes.length) return turnstile.denyAccess(message.index)

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

    return allowAccess(turnstile, message.index, way, tag.status, tagId)
  }

  return turnstile.denyAccess(message.index, text.outOfHour)
}

async function handleTurn(
  _eventCode: number,
  _message: Message,
  currentDate: Date,
) {
  if (!waitingToTurn) return

  const tag = await tagService.getByCredential({
    credential: waitingToTurn.tagId,
  })

  if (!tag || tag.admin) return

  await accessService.create({
    userId: tag.userId,
    timestamp: currentDate,
  })

  waitingToTurn = null
}

function allowAccess(
  turnstile: TurnstileClient,
  index: number,
  way: number,
  status: string,
  tagId: number,
) {
  if (way === 2) {
    turnstile.allowEntry(index, status)
  } else if (way === 3) {
    turnstile.allowExit(index, status)
  }

  waitingToTurn = {
    messageIndex: index,
    tagId,
  }
}

const delay = async (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms))

async function main() {
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
