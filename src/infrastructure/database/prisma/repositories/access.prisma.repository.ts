import AccessRepository, {
  CreateAccessInput,
  GetLastAccessInput,
  UpdateAccessStatusInput,
} from '../../../../domain/repositories/access.repository'
import { prisma } from '..'
import { v4 } from 'uuid'
import Access from '../../../../domain/entities/access.entity'
import { Status } from '../../../../domain/enum/status'

export default class AccessPrismaRepository implements AccessRepository {
  async create(data: CreateAccessInput) {
    return (await prisma.access.create({
      data: {
        id: v4(),
        timestamp: data.timestamp,
        tagUserId: data.userId,
      },
    })) as Access
  }

  async getWaitingAccesses() {
    return (await prisma.access.findMany({
      where: {
        status: Status.waiting,
      },
    })) as Access[]
  }

  async updateStatus(data: UpdateAccessStatusInput) {
    await prisma.access.update({
      where: {
        id: data.id,
      },
      data: {
        status: data.status,
      },
    })
  }

  async getLastAccessFromUserId(data: GetLastAccessInput) {
    const access = await prisma.access.findFirst({
      where: {
        tagUserId: data.userId,
      },
      orderBy: {
        timestamp: 'desc',
      },
    })

    return access as Access
  }

  async getAll() {
    return (await prisma.access.findMany()) as Access[]
  }

  async eraseAll() {
    await prisma.access.deleteMany()
  }
}
