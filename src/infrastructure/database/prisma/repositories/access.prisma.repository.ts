import AccessRepository, {
  CreateAccessInput,
  GetLastAccessInput,
  UpdateAccessStatusInput,
} from '@/domain/repositories/access.repository'
import { prisma } from '@/infrastructure/database/prisma'
import { v4 } from 'uuid'
import Access from '@/domain/entities/access.entity'
import { Status } from '@/domain/enum/status'

/**
 * Implementação do repositório de acessos usando Prisma ORM
 *
 * Características especiais:
 * - Usa UUID para IDs únicos distribuídos
 * - Status default 'waiting' para novos acessos
 * - Otimizado para consultas por usuário e timestamp
 * - Suporte a sincronização assíncrona com API externa
 */
export default class AccessPrismaRepository implements AccessRepository {
  /**
   * Cria novo registro de acesso
   *
   * Fluxo de acesso:
   * 1. Usuário passa pela catraca
   * 2. Sistema registra acesso local com status 'waiting'
   * 3. Job de sincronização envia para API externa
   * 4. Status é atualizado para 'granted' ou 'revoked'
   *
   * UUID garante IDs únicos mesmo em múltiplas instâncias
   */
  async create(data: CreateAccessInput): Promise<Access> {
    return (await prisma.access.create({
      data: {
        id: v4(), // UUID único gerado localmente
        timestamp: data.timestamp, // Data/hora exata do acesso
        tagUserId: data.userId, // Referência ao usuário
        // status: Status.waiting (valor padrão no schema)
      },
    })) as Access
  }

  /**
   * Busca acessos pendentes de sincronização
   *
   * Usado pelo job de importação para:
   * - Identificar acessos que ainda não foram enviados à API externa
   * - Processar em lotes para eficiência
   * - Implementar retry em caso de falha na sincronização
   *
   * Status 'waiting' = ainda não processado
   */
  async getWaitingAccesses(): Promise<Access[]> {
    return (await prisma.access.findMany({
      where: {
        status: Status.waiting, // Apenas acessos não sincronizados
      },
      // Possível otimização: ordenar por timestamp para FIFO
      // orderBy: { timestamp: 'asc' },
      // Possível limitação: processar em lotes
      // take: 1000,
    })) as Access[]
  }

  /**
   * Atualiza status após tentativa de sincronização
   *
   * Status finais:
   * - Status.granted: enviado com sucesso para API externa
   * - Status.revoked: erro no envio ou rejeitado pela API
   *
   * Permite rastreamento de falhas e retry se necessário
   */
  async updateStatus(data: UpdateAccessStatusInput): Promise<void> {
    await prisma.access.update({
      where: {
        id: data.id, // UUID do registro específico
      },
      data: {
        status: data.status, // Novo status após processamento
      },
    })
  }

  /**
   * Busca último acesso de um usuário específico
   *
   * Usado para controle anti-spam:
   * - Evita múltiplas tentativas em intervalo muito curto
   * - Implementa tolerância baseada em DELAY_TOLERANCE
   * - Melhora experiência do usuário (evita bloqueios desnecessários)
   *
   * Ordenação DESC + first = busca otimizada para último registro
   */
  async getLastAccessFromUserId(
    data: GetLastAccessInput,
  ): Promise<Access | null> {
    const access = await prisma.access.findFirst({
      where: {
        tagUserId: data.userId, // Filtro por usuário específico
      },
      orderBy: {
        timestamp: 'desc', // Mais recente primeiro
      },
      // findFirst automaticamente retorna apenas 1 registro
      // equivale a: take: 1
    })

    return access as Access | null
  }

  /**
   * Lista todos os acessos registrados
   *
   * Usos administrativos:
   * - Relatórios de frequência por usuário
   * - Auditoria de acessos por período
   * - Análise de padrões de uso
   * - Exportação para sistemas externos
   *
   * Performance: Para grandes volumes considerar:
   * - Filtros por período (WHERE timestamp BETWEEN)
   * - Paginação com cursor ou offset
   * - Índices em timestamp e tagUserId
   */
  async getAll(): Promise<Access[]> {
    return (await prisma.access.findMany({
      // Possíveis otimizações:
      // orderBy: { timestamp: 'desc' }, // Mais recentes primeiro
      // include: { tag: { select: { userId: true } } }, // Join com dados do usuário
      // where: { timestamp: { gte: startDate, lte: endDate } }, // Filtro por período
    })) as Access[]
  }

  /**
   * Remove todos os registros de acesso - OPERAÇÃO DESTRUTIVA
   *
   * CUIDADOS IMPORTANTES:
   * - Perda permanente de histórico de acessos
   * - Impacto em auditoria e compliance
   * - Impossibilita análises retrospectivas
   * - Pode afetar relatórios de frequência
   *
   * Usar apenas em:
   * - Reset completo do sistema
   * - Manutenção com backup prévio
   * - Ambiente de desenvolvimento/testes
   */
  async eraseAll(): Promise<void> {
    await prisma.access.deleteMany({
      // Sem filtros = deleta TODOS os acessos
      // SEMPRE fazer backup antes desta operação
    })

    // Considera log de auditoria para operações destrutivas
    // logger.warn('Todos os registros de acesso foram removidos')
  }
}
