import { PrismaClient, Class, Tag, Access } from '../../generated/prisma';
import env, { logger } from '../env';
import ky from 'ky';

const prisma = new PrismaClient();

// Para uma melhor estabilidade e assertividade no desenvolvimento desta parte,
// esperarei o endpoint que mostra os alunos aptos do SGE ficar pronto.

// TODO: [ ] função que busca informações no SGE
//       [ ] função que checa se há modificações no banco de dados atual e as aplica
//       [ ] função que roda a cada período (node-cron)