import { PrismaClient } from '@prisma/client'

/**
 * Instância global do cliente Prisma ORM
 *
 * O PrismaClient é responsável por:
 * - Gerenciar conexões com o banco de dados
 * - Fornecer API tipada para operações CRUD
 * - Implementar connection pooling automático
 * - Garantir type safety nas consultas
 *
 * Configurações automáticas do Prisma:
 * - Connection string lida da variável DATABASE_URL
 * - Pool de conexões gerenciado automaticamente
 * - Query logging baseado em NODE_ENV
 * - Reconexão automática em caso de falha
 *
 * Padrão Singleton: Uma única instância é compartilhada
 * em toda a aplicação para otimizar recursos e conexões
 */
export const prisma = new PrismaClient({
  // Configurações podem ser adicionadas aqui se necessário:
  // log: ['query', 'info', 'warn', 'error'], // Logs de debug
  // errorFormat: 'pretty', // Formatação de erros mais legível
})
