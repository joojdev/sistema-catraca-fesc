import env, { logger } from '../env'
import ky from 'ky'
import { z } from 'zod'
import { Lockfile } from './Lockfile'
import { WeekDay } from '@/domain/enum/week-day'
import TagPrismaRepository from '@/database/prisma/repositories/tag.prisma.repository'
import TagService from '@/application/services/tag.service'
import ClassPrismaRepository from '@/database/prisma/repositories/class.prisma.repository'
import ClassService from '@/application/services/class.service'
import AccessPrismaRepository from '@/database/prisma/repositories/access.prisma.repository'
import AccessService from '@/application/services/access.service'
import { Status } from '@/domain/enum/status'

const lockfile = new Lockfile('import', 60)

const weekDays: { [key: string]: string } = {
  dom: 'sunday',
  seg: 'monday',
  ter: 'tuesday',
  qua: 'wednesday',
  qui: 'thursday',
  sex: 'friday',
  sab: 'saturday',
}

type PostRequestBody = {
  acesso: number
  aluno: number
  id_acesso: string
}[]

const PostApiResponseSchema = z.array(
  z.object({
    acesso: z.string(),
    status: z
      .enum(['success', 'failed'])
      .transform((value) => value === 'success'),
    message: z.string(),
  }),
)

function timeToMinutes(time: string) {
  const [hh, mm] = time.split(':').map((number) => parseInt(number))
  return hh * 60 + mm
}

const HourSchema = z
  .object({
    hora: z
      .string()
      .regex(
        /^(?:[0-9]|1[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/,
        'The hour must be in the format H:MM:SS or HH:MM:SS!',
      ),
    dias: z.array(z.enum(Object.keys(weekDays))),
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
        timeToMinutes(start),
        receivedWeekDays.map((receivedWeekDay) => weekDays[receivedWeekDay]),
      ] as [number, WeekDay[]],
  )

const GetApiResponseSchema = z.object({
  aluno_id: z.coerce.number(),
  credencial: z.coerce.number(),
  horarios: z.array(HourSchema),
  liberado: z.boolean(),
  status: z.string().nonempty(),
  admin: z.boolean(),
})

type GetApiResponse = z.infer<typeof GetApiResponseSchema>

export default async function runImport() {
  const tagRepository = new TagPrismaRepository()
  const tagService = new TagService(tagRepository)

  const classRepository = new ClassPrismaRepository()
  const classService = new ClassService(classRepository)

  const accessRepository = new AccessPrismaRepository()
  const accessService = new AccessService(accessRepository)

  logger.info('Starting import...')
  lockfile.acquire()

  const url = new URL(env.API_URL)
  url.pathname = '/api/catraca'

  let data: GetApiResponse[]

  try {
    data = await ky
      .get(url.toString(), {
        headers: {
          Token: env.API_TOKEN,
        },
      })
      .json()
  } catch {
    logger.error('There was an error while trying to fetch the API')
    lockfile.release()
    return
  }

  const validUsers = []

  for (const item of data) {
    const result = GetApiResponseSchema.safeParse(item)
    if (result.success) {
      validUsers.push(result.data)
    } else {
      logger.warn(
        {
          aluno_id: item?.aluno_id,
          reason: result.error.issues.map((e) => e.message).join('; '),
        },
        'Invalid user entry skipped during import',
      )
    }
  }

  if (validUsers.length === 0) {
    logger.warn('All user entries were invalid — nothing to import.')
    lockfile.release()
    return
  }

  for (const user of validUsers) {
    await tagService.createOrUpdate({
      admin: user.admin,
      credential: user.credencial,
      released: user.liberado,
      status: user.status,
      userId: user.aluno_id,
    })

    await classService.deleteFromUserId({
      id: user.aluno_id,
    })

    if (!user.liberado && !user.admin) continue

    for (const [start, weekDayList] of user.horarios) {
      for (const weekDay of weekDayList) {
        await classService.create({
          start,
          weekDay,
          userId: user.aluno_id,
        })
      }
    }
  }

  logger.info('Finished importing!')
  lockfile.release()

  logger.info('Started sending access data...')

  const waitingAccesses = await accessService.getWaitingAccesses()

  if (!waitingAccesses.length) return logger.info('No access data to be sent.')

  const requestBody: PostRequestBody = waitingAccesses.map(
    ({ timestamp, id, tagUserId }) => ({
      acesso: timestamp.getTime() - 1000 * 60 * 60 * 3,
      aluno: tagUserId,
      id_acesso: id,
    }),
  )

  try {
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
    logger.error('There was an error while trying to fetch the API')
    logger.error(error)
    return
  }

  const parsed = PostApiResponseSchema.safeParse(data)

  if (!parsed.success) {
    logger.error('There was an error in the POST response.')
    return
  }

  for (const response of parsed.data) {
    await accessService.updateStatus({
      id: response.acesso,
      status: response.status ? Status.granted : Status.revoked,
    })
  }

  logger.info('Finished sending access data!')
}
