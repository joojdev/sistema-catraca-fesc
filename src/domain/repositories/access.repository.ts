import Access from '@/domain/entities/access.entity'
import { Status } from '@/domain/enum/status'

/**
 * Interface para criação de novo registro de acesso
 */
export interface CreateAccessInput {
  timestamp: Date // Data/hora exata do acesso
  userId: number // ID do usuário que acessou
}

/**
 * Interface para atualização do status de um acesso
 */
export interface UpdateAccessStatusInput {
  id: string // UUID do registro de acesso
  status: Status // Novo status (granted, revoked, waiting)
}

/**
 * Interface para buscar último acesso de um usuário
 */
export interface GetLastAccessInput {
  userId: number // ID do usuário
}

/**
 * Interface do repositório de acessos - define contrato para persistência
 *
 * Gerencia registros de entrada/saída dos usuários:
 * - Registra todos os acessos realizados
 * - Controla sincronização com API externa
 * - Permite auditoria e relatórios
 * - Implementa controle anti-spam
 */
export default interface AccessRepository {
  /**
   * Registra novo acesso realizado
   * Chamado quando usuário passa pela catraca
   */
  create(data: CreateAccessInput): Promise<Access>

  /**
   * Busca acessos aguardando sincronização com API externa
   * Status 'waiting' indica que ainda não foi enviado
   */
  getWaitingAccesses(): Promise<Access[]>

  /**
   * Atualiza status após tentativa de sincronização
   * 'granted' = enviado com sucesso, 'revoked' = erro no envio
   */
  updateStatus(data: UpdateAccessStatusInput): Promise<void>

  /**
   * Busca último acesso de um usuário específico
   * Usado para controle anti-spam (evitar acessos muito frequentes)
   */
  getLastAccessFromUserId(data: GetLastAccessInput): Promise<Access | null>

  /**
   * Lista todos os acessos registrados
   * Para relatórios e auditoria
   */
  getAll(): Promise<Access[]>

  /**
   * Remove todos os registros de acesso (operação destrutiva)
   */
  eraseAll(): Promise<void>
}
