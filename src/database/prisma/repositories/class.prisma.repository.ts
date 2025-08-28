import ClassRepository, {
  CreateClassInput,
  DeleteClassesInput,
  GetClassesInput,
} from '../../../domain/repositories/class.repository'
import { prisma } from '..'
import Class from '../../../domain/entities/class.entity'

export default class ClassPrismaRepository implements ClassRepository {
  async create(data: CreateClassInput) {
    return (await prisma.class.upsert({
      where: {
        start_weekDay_tagUserId: {
          start: data.start,
          weekDay: data.weekDay,
          tagUserId: data.userId,
        },
      },
      update: {},
      create: {
        start: data.start,
        weekDay: data.weekDay,
        tagUserId: data.userId,
      },
    })) as Class
  }

  async deleteFromUserId(data: DeleteClassesInput) {
    await prisma.class.deleteMany({
      where: {
        tagUserId: data.id,
      },
    })
  }

  async getClassesFromUserIdAndWeekDay(data: GetClassesInput) {
    return (await prisma.class.findMany({
      where: {
        tagUserId: data.userId,
        weekDay: data.weekDay,
      },
      orderBy: {
        start: 'asc',
      },
    })) as Class[]
  }

  async getAll() {
    return (await prisma.class.findMany()) as Class[]
  }

  async eraseAll() {
    await prisma.class.deleteMany()
  }
}
