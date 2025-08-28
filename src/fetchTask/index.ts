import schedule from 'node-schedule'
import env, { logger } from '../env'
import runImport from '../utils/importJob'
import express from 'express'

async function main() {
  schedule.scheduleJob(env.CRON_PARAMETERS, () => runImport())

  const app = express()

  app.get('/trigger-import', async (request, response) => {
    runImport()
      .then(() => response.send('Import finished!'))
      .catch((error) => {
        logger.error(error)
        response.status(500).send('Error running import!')
      })
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
