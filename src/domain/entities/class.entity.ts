import { WeekDay } from '../enum/week-day'

export default class Class {
  constructor(
    public start: number,
    public weekDay: WeekDay,
    public tagUserId: number,
  ) {}
}
