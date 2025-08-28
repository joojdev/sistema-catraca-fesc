import AccessRepository, {
  CreateAccessInput,
  GetLastAccessInput,
  UpdateAccessStatusInput,
} from '../../domain/repositories/access.repository'

export default class AccessService implements AccessRepository {
  constructor(private repo: AccessRepository) {}

  async create(data: CreateAccessInput) {
    return await this.repo.create(data)
  }

  async getWaitingAccesses() {
    return await this.repo.getWaitingAccesses()
  }

  async updateStatus(data: UpdateAccessStatusInput) {
    await this.repo.updateStatus(data)
  }

  async getLastAccessFromUserId(data: GetLastAccessInput) {
    return await this.repo.getLastAccessFromUserId(data)
  }
}
