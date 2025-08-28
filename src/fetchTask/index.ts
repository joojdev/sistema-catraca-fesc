import schedule from 'node-schedule'
import env, { logger } from '../env'
import runImport from '../utils/importJob'
import express from 'express'
import TagPrismaRepository from '../database/prisma/repositories/tag.prisma.repository'
import TagService from '../application/services/tag.service'
import AccessPrismaRepository from '../database/prisma/repositories/access.prisma.repository'
import AccessService from '../application/services/access.service'
import ClassPrismaRepository from '../database/prisma/repositories/class.prisma.repository'
import ClassService from '../application/services/class.service'
import z from 'zod'

const AdminActionSchema = z.object({
  Token: z.string(),
})

async function main() {
  const tagRepository = new TagPrismaRepository()
  const tagService = new TagService(tagRepository)

  const accessRepository = new AccessPrismaRepository()
  const accessService = new AccessService(accessRepository)

  const classRepository = new ClassPrismaRepository()
  const classService = new ClassService(classRepository)

  schedule.scheduleJob(env.CRON_PARAMETERS, () => runImport())

  const app = express()

  app.use(express.json())

  app.use((request, response, next) => {
    const parsed = AdminActionSchema.safeParse(request.body)

    if (!parsed.success) return response.status(401).send('Não autorizado!')

    const { Token } = parsed.data

    if (Token !== env.ADMIN_TOKEN)
      return response.status(401).send('Não autorizado!')

    next()
  })

  app.get('/trigger-import', async (request, response) => {
    runImport()
      .then(() => response.send('Import finished!'))
      .catch((error) => {
        logger.error(error)
        response.status(500).send('Error running import!')
      })
  })

  app.get('/erase-everything', async (request, response) => {
    await tagService.eraseAll()
    await classService.eraseAll()
    await accessService.eraseAll()
    response.send('Database erased!')
  })

  app.get('/list-accesses', async (request, response) => {
    const accesses = await accessService.getAll()
    return response.json(accesses)
  })

  app.get('/list-classes', async (request, response) => {
    const classes = await classService.getAll()
    return response.json(classes)
  })

  app.get('/list-tags', async (request, response) => {
    const tags = await tagService.getAll()
    return response.json(tags)
  })

  app.listen(3000, () => {
    logger.info('Server running on port 3000!')
  })

  process.on('SIGINT', async () => {
    logger.info('Gracefully shutting down...')
    process.exit(0)
  })
}

main()
