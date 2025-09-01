import { WeekDay } from '@/domain/enum/week-day'

export default class Class {
  constructor(
    public start: number,
    public weekDay: WeekDay,
    public tagUserId: number,
  ) {}
}
