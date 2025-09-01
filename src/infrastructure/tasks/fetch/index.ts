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
import fs from 'fs'
import path from 'path'

/**
 * Schema de validação para ações administrativas
 */
const AdminActionSchema = z.object({
  Token: z.string(), // Token de autenticação para operações admin
})

/**
 * Schema para verificação de token
 */
const TokenVerificationSchema = z.object({
  Token: z.string(),
})

/**
 * Interface para controle de rate limiting por IP
 */
interface RateLimitEntry {
  count: number
  resetTime: number
}

/**
 * Map para controlar rate limiting por IP
 * Key: IP address, Value: RateLimitEntry
 */
const rateLimitMap = new Map<string, RateLimitEntry>()

/**
 * Limpa entradas expiradas do rate limit a cada 5 minutos
 */
setInterval(
  () => {
    const now = Date.now()
    for (const [ip, entry] of rateLimitMap.entries()) {
      if (now > entry.resetTime) {
        rateLimitMap.delete(ip)
      }
    }
    logger.debug(
      `Rate limit cleanup: ${rateLimitMap.size} IPs sendo monitorados`,
    )
  },
  5 * 60 * 1000,
) // 5 minutos

/**
 * Middleware de rate limiting
 * Limita a 3 requisições por hora por IP para rotas protegidas
 */
function rateLimitMiddleware(
  request: express.Request,
  response: express.Response,
  next: express.NextFunction,
) {
  const ip = request.ip || request.connection.remoteAddress || 'unknown'
  const now = Date.now()
  const oneHour = 60 * 60 * 1000 // 1 hora em millisegundos
  const maxRequests = 3

  // Obtém ou cria entrada para este IP
  let entry = rateLimitMap.get(ip)

  if (!entry || now > entry.resetTime) {
    // Primeira requisição ou janela de tempo expirada
    entry = {
      count: 1,
      resetTime: now + oneHour,
    }
    rateLimitMap.set(ip, entry)

    logger.debug(
      {
        ip,
        count: entry.count,
        resetIn: Math.round((entry.resetTime - now) / 1000 / 60),
      },
      'Rate limit: Nova janela iniciada',
    )

    return next()
  }

  if (entry.count >= maxRequests) {
    const resetIn = Math.round((entry.resetTime - now) / 1000 / 60)

    logger.warn(
      {
        ip,
        count: entry.count,
        maxRequests,
        resetIn,
        path: request.path,
      },
      'Rate limit excedido',
    )

    return response.status(429).json({
      success: false,
      message: 'Muitas tentativas. Tente novamente em algumas horas.',
      retryAfter: resetIn,
      limit: maxRequests,
      current: entry.count,
    })
  }

  // Incrementa contador
  entry.count++
  rateLimitMap.set(ip, entry)

  logger.debug(
    {
      ip,
      count: entry.count,
      remaining: maxRequests - entry.count,
      resetIn: Math.round((entry.resetTime - now) / 1000 / 60),
    },
    'Rate limit: Requisição contabilizada',
  )

  next()
}

/**
 * HTML da página de administração
 * Tenta várias localizações possíveis para o arquivo admin.html
 */
function loadAdminPageHTML(): string {
  return fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'utils', 'admin.html'),
    { encoding: 'utf-8' },
  )
}

const ADMIN_PAGE_HTML = loadAdminPageHTML()

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

  // Middleware para capturar IP real (atrás de proxies)
  app.set('trust proxy', true)

  // Middleware para parsing de JSON
  app.use(express.json({ limit: '10mb' })) // Limite de 10MB para requisições

  // ===== ROTAS PÚBLICAS (SEM AUTENTICAÇÃO) =====

  /**
   * GET /admin
   * Serve a página de administração (interface web)
   * Esta rota não requer autenticação pois a própria página gerencia isso
   */
  app.get('/admin', (request, response) => {
    logger.info({ ip: request.ip }, 'Acesso à página administrativa')
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    response.send(ADMIN_PAGE_HTML)
  })

  /**
   * GET /
   * Redireciona a raiz para a página administrativa
   */
  app.get('/', (request, response) => {
    response.redirect('/admin')
  })

  /**
   * GET /health
   * Endpoint de health check para monitoramento - SEM RATE LIMIT
   */
  app.get('/health', (request, response) => {
    response.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: process.env.npm_package_version || 'unknown',
    })
  })

  // ===== ROTA DE VERIFICAÇÃO DE TOKEN =====

  /**
   * POST /verify-token
   * Verifica se o token fornecido é válido
   * Permite que a interface web valide o token antes de fazer outras requisições
   * APLICA RATE LIMITING
   */
  app.post('/verify-token', rateLimitMiddleware, (request, response) => {
    const parsed = TokenVerificationSchema.safeParse(request.body)

    if (!parsed.success) {
      logger.warn(
        {
          ip: request.ip,
          userAgent: request.get('User-Agent'),
          errors: parsed.error.issues,
        },
        'Verificação de token: estrutura inválida',
      )
      return response.status(400).json({
        success: false,
        message: 'Token não fornecido',
        valid: false,
      })
    }

    const { Token } = parsed.data

    if (Token !== env.ADMIN_TOKEN) {
      logger.warn(
        {
          ip: request.ip,
          userAgent: request.get('User-Agent'),
          providedToken: Token.substring(0, 10) + '...', // Log parcial por segurança
        },
        'Verificação de token: token inválido',
      )
      return response.json({
        success: false,
        message: 'Token inválido',
        valid: false,
      })
    }

    logger.info({ ip: request.ip }, 'Token verificado com sucesso')
    response.json({
      success: true,
      message: 'Token válido',
      valid: true,
      timestamp: new Date().toISOString(),
    })
  })

  // ===== MIDDLEWARE DE AUTENTICAÇÃO PARA ROTAS PROTEGIDAS =====

  /**
   * Middleware de segurança que valida token em rotas da API
   * Aplica-se apenas às rotas protegidas
   */
  app.use('/api', rateLimitMiddleware, (request, response, next) => {
    // Valida estrutura da requisição
    const parsed = AdminActionSchema.safeParse(request.body)

    if (!parsed.success) {
      logger.warn(
        {
          ip: request.ip,
          userAgent: request.get('User-Agent'),
          path: request.path,
          errors: parsed.error.issues,
        },
        'Tentativa de acesso sem token válido',
      )
      return response
        .status(401)
        .json({ success: false, message: 'Token não fornecido ou inválido' })
    }

    const { Token } = parsed.data

    // Verifica se token corresponde ao token administrativo configurado
    if (Token !== env.ADMIN_TOKEN) {
      logger.warn(
        {
          ip: request.ip,
          userAgent: request.get('User-Agent'),
          path: request.path,
          providedToken: Token.substring(0, 10) + '...', // Log parcial por segurança
        },
        'Tentativa de acesso com token inválido',
      )
      return response
        .status(401)
        .json({ success: false, message: 'Token administrativo inválido' })
    }

    // Token válido - continua para próximo middleware/rota
    logger.debug(
      { ip: request.ip, path: request.path },
      'Acesso administrativo autorizado',
    )
    next()
  })

  // ===== ROTAS ADMINISTRATIVAS PROTEGIDAS =====

  /**
   * POST /api/trigger-import
   * Dispara importação manual (fora do agendamento)
   * Útil para testes ou sincronizações urgentes
   */
  app.post('/api/trigger-import', async (request, response) => {
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
   * POST /api/erase-everything
   * OPERAÇÃO DESTRUTIVA: Apaga todos os dados do sistema
   * Use com extremo cuidado - não há rollback
   */
  app.post('/api/erase-everything', async (request, response) => {
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
   * POST /api/list-accesses
   * Lista todos os registros de acesso
   * Útil para auditoria e monitoramento
   */
  app.post('/api/list-accesses', async (request, response) => {
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
   * POST /api/list-classes
   * Lista todos os horários de aula cadastrados
   */
  app.post('/api/list-classes', async (request, response) => {
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
   * POST /api/list-tags
   * Lista todas as tags/credenciais cadastradas
   */
  app.post('/api/list-tags', async (request, response) => {
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

  // ===== INICIALIZAÇÃO DO SERVIDOR =====

  const PORT = env.PORT || 3000

  app.listen(PORT, () => {
    logger.info({ port: PORT }, 'Servidor administrativo iniciado')
    logger.info(
      `Página administrativa disponível em: http://localhost:${PORT}/admin`,
    )
    logger.info('Rate limiting configurado: 3 requisições por hora por IP')
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
      // Limpa rate limit map
      rateLimitMap.clear()

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
