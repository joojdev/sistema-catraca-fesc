import ClassRepository, {
  CreateClassInput,
  DeleteClassesInput,
  GetClassesInput,
} from '@/domain/repositories/class.repository'
import { prisma } from '@/infrastructure/database/prisma'
import Class from '@/domain/entities/class.entity'

/**
 * Implementação do repositório de aulas usando Prisma ORM
 *
 * Características especiais:
 * - Usa chave composta para prevenir duplicatas
 * - Otimizado para consultas por usuário/dia
 * - Suporte a múltiplos horários por usuário
 */
export default class ClassPrismaRepository implements ClassRepository {
  /**
   * Cria nova aula usando upsert com chave composta
   *
   * Chave composta (start_weekDay_tagUserId):
   * - start: horário de início
   * - weekDay: dia da semana
   * - tagUserId: ID do usuário
   *
   * Isso previne duplicatas exatas mas permite:
   * - Mesmo usuário em horários diferentes no mesmo dia
   * - Mesmo horário em dias diferentes
   * - Usuários diferentes no mesmo horário/dia
   */
  async create(data: CreateClassInput): Promise<Class> {
    return (await prisma.class.upsert({
      where: {
        // Chave composta única - previne duplicata exata
        start_weekDay_tagUserId: {
          start: data.start, // Ex: 540 (9:00 AM)
          weekDay: data.weekDay, // Ex: WeekDay.monday
          tagUserId: data.userId, // ID do usuário
        },
      },
      update: {
        // Para upsert de aulas, geralmente não há o que atualizar
        // Os campos da chave já definem univocamente a aula
        // Poderia adicionar campos como 'duration', 'classroom', etc.
      },
      create: {
        // Cria nova aula com todos os dados
        start: data.start,
        weekDay: data.weekDay,
        tagUserId: data.userId,
      },
    })) as Class
  }

  /**
   * Remove todas as aulas de um usuário específico
   *
   * Usado principalmente durante reimportação de dados:
   * 1. Remove todos os horários antigos do usuário
   * 2. Insere novos horários atualizados
   *
   * Isso garante que a importação seja idempotente
   * e remova horários que não existem mais na API externa
   */
  async deleteFromUserId(data: DeleteClassesInput): Promise<void> {
    await prisma.class.deleteMany({
      where: {
        tagUserId: data.id, // Remove todas as aulas do usuário
      },
      // Prisma automaticamente gerencia transações para deleteMany
    })
  }

  /**
   * Busca aulas de usuário em dia específico, ordenadas por horário
   *
   * Usado pela catraca para:
   * - Validar se usuário tem aula no dia atual
   * - Verificar janela de tempo permitida para acesso
   * - Permitir múltiplas aulas no mesmo dia
   *
   * Ordenação por 'start' permite:
   * - Processar aulas na ordem cronológica
   * - Otimizar validação de janela de tempo
   * - Melhor experiência em relatórios
   */
  async getClassesFromUserIdAndWeekDay(
    data: GetClassesInput,
  ): Promise<Class[]> {
    return (await prisma.class.findMany({
      where: {
        tagUserId: data.userId, // Filtro por usuário
        weekDay: data.weekDay, // Filtro por dia da semana
      },
      orderBy: {
        start: 'asc', // Ordena por horário (mais cedo primeiro)
      },
      // Possível otimização futura: incluir dados da tag
      // include: { tag: { select: { status: true, released: true } } }
    })) as Class[]
  }

  /**
   * Lista todas as aulas do sistema
   *
   * Usos administrativos:
   * - Relatórios de ocupação por horário
   * - Auditoria de configurações
   * - Exportação de dados
   *
   * Performance: Para grandes volumes, considerar:
   * - Paginação com take/skip
   * - Filtros por período ou usuário
   * - Projeção apenas dos campos necessários
   */
  async getAll(): Promise<Class[]> {
    return (await prisma.class.findMany({
      // Possíveis otimizações:
      // orderBy: [{ weekDay: 'asc' }, { start: 'asc' }], // Ordem cronológica
      // include: { tag: { select: { userId: true } } }, // Dados relacionados
      // take: 1000, // Limitação para performance
    })) as Class[]
  }

  /**
   * Remove todas as aulas - OPERAÇÃO DESTRUTIVA
   *
   * Cuidados:
   * - Remove todos os horários do sistema
   * - Usuários ficarão sem acesso até nova importação
   * - Usar apenas em reset completo ou manutenção
   */
  async eraseAll(): Promise<void> {
    await prisma.class.deleteMany({
      // Sem filtros = deleta tudo
      // Considerar backup antes desta operação
    })
  }
}
