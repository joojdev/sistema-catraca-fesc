import { PrismaClient } from '../../generated/prisma';
import env, { logger } from '../env';
import ky from 'ky';
import cron from 'node-cron';

async function main() {
  const prisma = new PrismaClient();
  try {
    await prisma.$connect();
    logger.info('Connected to database!');
    startCron(prisma);
  } catch (error) {
    logger.error('There was an error trying to connect to the database!');
    logger.error(error);
  } finally {
    await prisma.$disconnect();
  }
}

async function startCron(prisma: PrismaClient) {
  logger.info('Started cron job!');
  cron.schedule(env.CRON_PARAMETERS, async () => {
    const url = new URL(env.API_URL);
    url.pathname = '/services/catraca';

    const data = await ky.get(url.toString(), {
      headers: {
        Token: env.API_TOKEN
      }
    }).json();
  
    console.log(data);
  });
}

main();

// Para uma melhor estabilidade e assertividade no desenvolvimento desta parte,
// esperarei o endpoint que mostra os alunos aptos do SGE ficar pronto.

// TODO: [x] função que busca informações no SGE
//       [ ] função que checa se há modificações no banco de dados atual e as aplica
//       [x] função que roda a cada período (node-cron)