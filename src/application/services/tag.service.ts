import TagRepository, {
  CreateTagInput,
  CredentialInput,
} from '../../domain/repositories/tag.repository'

export default class TagService implements TagRepository {
  constructor(private repo: TagRepository) {}

  async createOrUpdate(data: CreateTagInput) {
    return await this.repo.createOrUpdate(data)
  }

  async getByCredential(data: CredentialInput) {
    return await this.repo.getByCredential(data)
  }
}
