import Tag from '@/domain/entities/tag.entity'

export interface CreateTagInput {
  userId: number
  credential: number
  released: boolean
  status: string
  admin: boolean
}

export interface CredentialInput {
  credential: number
}

export default interface TagRepository {
  createOrUpdate(data: CreateTagInput): Promise<Tag>
  getByCredential(data: CredentialInput): Promise<Tag | null>
}
