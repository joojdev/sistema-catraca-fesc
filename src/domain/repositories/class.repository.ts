import Class from '@/domain/entities/class.entity'
import { WeekDay } from '@/domain/enum/week-day'

/**
 * Interface para criação de nova aula/horário
 */
export interface CreateClassInput {
  start: number // Horário de início em minutos desde meia-noite (ex: 540 = 9:00)
  weekDay: WeekDay // Dia da semana (enum)
  userId: number // ID do usuário associado à aula
}

/**
 * Interface para exclusão de aulas por usuário
 */
export interface DeleteClassesInput {
  id: number // ID do usuário cujas aulas serão removidas
}

/**
 * Interface para busca de aulas por usuário e dia
 */
export interface GetClassesInput {
  userId: number // ID do usuário
  weekDay: WeekDay // Dia da semana específico
}

/**
 * Interface do repositório de aulas - define contrato para persistência
 *
 * Gerencia horários de aula dos usuários:
 * - Controla quando cada usuário pode acessar o sistema
 * - Permite múltiplos horários por usuário/dia
 * - Suporta validação por janela de tempo
 */
export default interface ClassRepository {
  /**
   * Cria nova aula ou atualiza existente
   * Previne duplicatas por usuário/dia/horário
   */
  create(data: CreateClassInput): Promise<Class>

  /**
   * Remove todas as aulas de um usuário específico
   * Usado antes de reimportar horários atualizados
   */
  deleteFromUserId(data: DeleteClassesInput): Promise<void>

  /**
   * Busca aulas de um usuário em dia específico
   * Usado para validar acesso em tempo real
   */
  getClassesFromUserIdAndWeekDay(data: GetClassesInput): Promise<Class[]>

  /**
   * Lista todas as aulas cadastradas
   * Usado para relatórios administrativos
   */
  getAll(): Promise<Class[]>

  /**
   * Remove todas as aulas (operação destrutiva)
   */
  eraseAll(): Promise<void>
}
