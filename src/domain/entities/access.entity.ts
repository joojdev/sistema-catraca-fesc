import { Status } from '@/domain/enum/status'

export default class Access {
  constructor(
    public id: string,
    public timestamp: Date,
    public status: Status,
    public tagUserId: number,
  ) {}
}
