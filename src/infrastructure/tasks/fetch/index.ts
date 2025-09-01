import schedule from 'node-schedule'
import env, { logger } from '@/infrastructure/config/env'
import runImport from '@/infrastructure/tasks/fetch/importJob'
import express from 'express'
import TagPrismaRepository from '@/infrastructure/database/prisma/repositories/tag.prisma.repository'
import TagService from '@/application/services/tag.service'
import AccessPrismaRepository from '@/infrastructure/database/prisma/repositories/access.prisma.repository'
import AccessService from '@/application/services/access.service'
import ClassPrismaRepository from '@/infrastructure/database/prisma/repositories/class.prisma.repository'
import ClassService from '@/application/services/class.service'
import { z } from 'zod'

/**
 * Schema de validação para ações administrativas
 * Todas as rotas administrativas requerem um token válido
 */
const AdminActionSchema = z.object({
  Token: z.string(), // Token de autenticação para operações admin
})

/**
 * Função principal da aplicação
 * Configura e inicia:
 * 1. Agendamento automático de importação (cron job)
 * 2. Servidor web com APIs administrativas
 * 3. Middlewares de segurança
 */
async function main(): Promise<void> {
  // ===== INICIALIZAÇÃO DOS SERVIÇOS =====

  // Inicializa repositórios e serviços de domínio
  const tagRepository = new TagPrismaRepository()
  const tagService = new TagService(tagRepository)

  const accessRepository = new AccessPrismaRepository()
  const accessService = new AccessService(accessRepository)

  const classRepository = new ClassPrismaRepository()
  const classService = new ClassService(classRepository)

  // ===== CONFIGURAÇÃO DO AGENDAMENTO AUTOMÁTICO =====

  logger.info(
    { cronPattern: env.CRON_PARAMETERS },
    'Configurando agendamento automático de importação',
  )

  // Agenda execução automática do job de importação
  // Exemplo de CRON_PARAMETERS: '0 */6 * * *' (a cada 6 horas)
  schedule.scheduleJob(env.CRON_PARAMETERS, () => {
    logger.info('Executando importação agendada...')

    runImport()
      .then(() => {
        logger.info('Importação agendada concluída com sucesso')
      })
      .catch((error) => {
        logger.error({ err: error }, 'Erro na importação agendada')
      })
  })

  // ===== CONFIGURAÇÃO DO SERVIDOR WEB =====

  const app = express()

  // Middleware para parsing de JSON
  app.use(express.json({ limit: '10mb' })) // Limite de 10MB para requisições

  // ===== MIDDLEWARE DE AUTENTICAÇÃO =====

  /**
   * Middleware de segurança que valida token em todas as rotas
   * Verifica se o token enviado no body da requisição é válido
   */
  app.use((request, response, next) => {
    // Valida estrutura da requisição
    const parsed = AdminActionSchema.safeParse(request.body)

    if (!parsed.success) {
      logger.warn(
        {
          ip: request.ip,
          userAgent: request.get('User-Agent'),
          errors: parsed.error.issues,
        },
        'Tentativa de acesso sem token válido',
      )
      return response.status(401).send('Não autorizado!')
    }

    const { Token } = parsed.data

    // Verifica se token corresponde ao token administrativo configurado
    if (Token !== env.ADMIN_TOKEN) {
      logger.warn(
        {
          ip: request.ip,
          userAgent: request.get('User-Agent'),
          providedToken: Token.substring(0, 10) + '...', // Log parcial por segurança
        },
        'Tentativa de acesso com token inválido',
      )
      return response.status(401).send('Não autorizado!')
    }

    // Token válido - continua para próximo middleware/rota
    logger.debug({ ip: request.ip }, 'Acesso administrativo autorizado')
    next()
  })

  // ===== ROTAS ADMINISTRATIVAS =====

  /**
   * POST /trigger-import
   * Dispara importação manual (fora do agendamento)
   * Útil para testes ou sincronizações urgentes
   */
  app.post('/trigger-import', async (request, response) => {
    logger.info({ ip: request.ip }, 'Importação manual disparada')

    runImport()
      .then(() => {
        logger.info('Importação manual concluída com sucesso')
        response.json({
          success: true,
          message: 'Import finished!',
          timestamp: new Date().toISOString(),
        })
      })
      .catch((error) => {
        logger.error({ err: error }, 'Erro na importação manual')
        response.status(500).json({
          success: false,
          message: 'Error running import!',
          error: error.message,
        })
      })
  })

  /**
   * POST /erase-everything
   * OPERAÇÃO DESTRUTIVA: Apaga todos os dados do sistema
   * Use com extremo cuidado - não há rollback
   */
  app.post('/erase-everything', async (request, response) => {
    logger.warn(
      { ip: request.ip },
      'OPERAÇÃO DESTRUTIVA: Limpeza completa do banco solicitada',
    )

    try {
      // Apaga dados em ordem para evitar problemas de referência
      await accessService.eraseAll() // Remove acessos primeiro
      await classService.eraseAll() // Remove horários
      await tagService.eraseAll() // Remove tags por último

      logger.warn('Banco de dados completamente limpo')
      response.json({
        success: true,
        message: 'Database erased!',
        timestamp: new Date().toISOString(),
      })
    } catch (error: any) {
      logger.error({ err: error }, 'Erro ao limpar banco de dados')
      response.status(500).json({
        success: false,
        message: 'Error erasing database!',
        error: error.message,
      })
    }
  })

  /**
   * GET /list-accesses
   * Lista todos os registros de acesso
   * Útil para auditoria e monitoramento
   */
  app.get('/list-accesses', async (request, response) => {
    try {
      const accesses = await accessService.getAll()

      logger.info(
        {
          count: accesses.length,
          ip: request.ip,
        },
        'Lista de acessos solicitada',
      )

      response.json({
        success: true,
        data: accesses,
        count: accesses.length,
        timestamp: new Date().toISOString(),
      })
    } catch (error: any) {
      logger.error({ err: error }, 'Erro ao buscar lista de acessos')
      response.status(500).json({
        success: false,
        message: 'Error fetching accesses',
        error: error.message,
      })
    }
  })

  /**
   * GET /list-classes
   * Lista todos os horários de aula cadastrados
   */
  app.get('/list-classes', async (request, response) => {
    try {
      const classes = await classService.getAll()

      logger.info(
        {
          count: classes.length,
          ip: request.ip,
        },
        'Lista de horários solicitada',
      )

      response.json({
        success: true,
        data: classes,
        count: classes.length,
        timestamp: new Date().toISOString(),
      })
    } catch (error: any) {
      logger.error({ err: error }, 'Erro ao buscar lista de horários')
      response.status(500).json({
        success: false,
        message: 'Error fetching classes',
        error: error.message,
      })
    }
  })

  /**
   * GET /list-tags
   * Lista todas as tags/credenciais cadastradas
   */
  app.get('/list-tags', async (request, response) => {
    try {
      const tags = await tagService.getAll()

      logger.info(
        {
          count: tags.length,
          ip: request.ip,
        },
        'Lista de tags solicitada',
      )

      response.json({
        success: true,
        data: tags,
        count: tags.length,
        timestamp: new Date().toISOString(),
      })
    } catch (error: any) {
      logger.error({ err: error }, 'Erro ao buscar lista de tags')
      response.status(500).json({
        success: false,
        message: 'Error fetching tags',
        error: error.message,
      })
    }
  })

  /**
   * GET /health
   * Endpoint de health check para monitoramento
   */
  app.get('/health', (request, response) => {
    response.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: process.env.npm_package_version || 'unknown',
    })
  })

  // ===== TRATAMENTO DE ERROS GLOBAIS =====

  // Middleware de tratamento de erros não capturados
  app.use(
    (error: Error, request: express.Request, response: express.Response) => {
      logger.error(
        {
          err: error,
          url: request.url,
          method: request.method,
          ip: request.ip,
        },
        'Erro não tratado na aplicação',
      )

      response.status(500).json({
        success: false,
        message: 'Internal server error',
        timestamp: new Date().toISOString(),
      })
    },
  )

  // ===== INICIALIZAÇÃO DO SERVIDOR =====

  const PORT = env.PORT || 3000

  app.listen(PORT, () => {
    logger.info({ port: PORT }, 'Servidor administrativo iniciado')
  })

  // ===== CONFIGURAÇÃO DE SHUTDOWN GRACIOSO =====

  /**
   * Handler para shutdown gracioso da aplicação
   * Captura sinais do sistema (Ctrl+C, kill, etc.)
   */
  const gracefulShutdown = async (signal: string) => {
    logger.info(
      { signal },
      'Sinal de shutdown recebido - encerrando graciosamente...',
    )

    try {
      // Aqui você pode adicionar cleanup adicional se necessário:
      // - Fechar conexões de banco
      // - Finalizar jobs em andamento
      // - Liberar recursos

      // Cancela jobs agendados
      schedule.gracefulShutdown()

      logger.info('Shutdown concluído com sucesso')
      process.exit(0)
    } catch (error) {
      logger.error({ err: error }, 'Erro durante shutdown')
      process.exit(1)
    }
  }

  // Registra handlers para diferentes sinais de sistema
  process.on('SIGINT', () => gracefulShutdown('SIGINT')) // Ctrl+C
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM')) // kill command
  process.on('SIGUSR2', () => gracefulShutdown('SIGUSR2')) // nodemon restart

  // Handlers para erros não capturados
  process.on('uncaughtException', (error) => {
    logger.error({ err: error }, 'Exceção não capturada - encerrando aplicação')
    process.exit(1)
  })

  process.on('unhandledRejection', (reason) => {
    logger.error(
      { err: reason },
      'Promise rejection não tratada - encerrando aplicação',
    )
    process.exit(1)
  })

  logger.info('Sistema inicializado com sucesso')
}

// ===== INICIALIZAÇÃO DA APLICAÇÃO =====

main().catch((error) => {
  logger.error({ err: error }, 'Erro fatal na inicialização da aplicação')
  process.exit(1)
})
