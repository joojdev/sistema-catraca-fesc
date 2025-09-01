import Tag from '@/domain/entities/tag.entity'

/**
 * Interface para dados de criação/atualização de tag
 * Representa uma credencial RFID associada a um usuário
 */
export interface CreateTagInput {
  userId: number // ID único do usuário no sistema
  credential: number // Número da credencial RFID (identificador físico)
  released: boolean // Se a tag está liberada para acesso
  status: string // Status textual (ex: "Ativo", "Pendente", "Bloqueado")
  admin: boolean // Se é uma tag administrativa (acesso total)
}

/**
 * Interface para busca por credencial RFID
 */
export interface CredentialInput {
  credential: number // Número da credencial a ser buscada
}

/**
 * Interface do repositório de tags - define contrato para persistência
 *
 * Implementa padrão Repository para abstração da camada de dados
 * Permite trocar implementação (Prisma, TypeORM, etc.) sem afetar domínio
 */
export default interface TagRepository {
  /**
   * Cria nova tag ou atualiza existente baseado no userId
   * Uso do upsert previne duplicatas por usuário
   */
  createOrUpdate(data: CreateTagInput): Promise<Tag>

  /**
   * Busca tag pelo número da credencial RFID
   * Usado na validação de acesso pela catraca
   */
  getByCredential(data: CredentialInput): Promise<Tag | null>

  /**
   * Remove todas as tags do sistema (operação destrutiva)
   * Usado para reset completo em manutenção
   */
  eraseAll(): Promise<void>

  /**
   * Lista todas as tags cadastradas
   * Usado para relatórios e administração
   */
  getAll(): Promise<Tag[]>
}
