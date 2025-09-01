import ClassRepository, {
  CreateClassInput,
  DeleteClassesInput,
  GetClassesInput,
} from '@/domain/repositories/class.repository'

export default class ClassService implements ClassRepository {
  constructor(private repo: ClassRepository) {}

  async create(data: CreateClassInput) {
    return await this.repo.create(data)
  }

  async deleteFromUserId(data: DeleteClassesInput) {
    await this.repo.deleteFromUserId(data)
  }

  async getClassesFromUserIdAndWeekDay(data: GetClassesInput) {
    return await this.repo.getClassesFromUserIdAndWeekDay(data)
  }

  async getAll() {
    return await this.repo.getAll()
  }

  async eraseAll() {
    await this.repo.eraseAll()
  }
}
