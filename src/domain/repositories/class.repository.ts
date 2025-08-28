import Class from '@/domain/entities/class.entity'
import { WeekDay } from '@/domain/enum/week-day'

export interface CreateClassInput {
  start: number
  weekDay: WeekDay
  userId: number
}

export interface DeleteClassesInput {
  id: number
}

export interface GetClassesInput {
  userId: number
  weekDay: WeekDay
}

export default interface ClassRepository {
  create(data: CreateClassInput): Promise<Class>
  deleteFromUserId(data: DeleteClassesInput): Promise<void>
  getClassesFromUserIdAndWeekDay(data: GetClassesInput): Promise<Class[]>
}
