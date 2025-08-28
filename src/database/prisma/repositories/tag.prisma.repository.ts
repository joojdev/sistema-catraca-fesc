import TagRepository, {
  CreateTagInput,
  CredentialInput,
} from '../../../domain/repositories/tag.repository'
import { prisma } from '..'

export default class TagPrismaRepository implements TagRepository {
  async createOrUpdate(data: CreateTagInput) {
    return await prisma.tag.upsert({
      where: {
        userId: data.userId,
      },
      update: {
        credential: data.credential,
        released: data.released,
        status: data.status,
        admin: data.admin,
      },
      create: {
        credential: data.credential,
        userId: data.userId,
        released: data.released,
        status: data.status,
        admin: data.admin,
      },
    })
  }

  async getByCredential(data: CredentialInput) {
    return await prisma.tag.findUnique({
      where: {
        credential: data.credential,
      },
    })
  }

  async eraseAll() {
    await prisma.tag.deleteMany()
  }

  async getAll() {
    return await prisma.tag.findMany()
  }
}
