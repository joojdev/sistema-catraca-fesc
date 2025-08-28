import Access from '@/domain/entities/access.entity'
import { Status } from '@/domain/enum/status'

export interface CreateAccessInput {
  timestamp: Date
  userId: number
}

export interface UpdateAccessStatusInput {
  id: string
  status: Status
}

export interface GetLastAccessInput {
  userId: number
}

export default interface AccessRepository {
  create(data: CreateAccessInput): Promise<Access>
  getWaitingAccesses(): Promise<Access[]>
  updateStatus(data: UpdateAccessStatusInput): Promise<void>
  getLastAccessFromUserId(data: GetLastAccessInput): Promise<Access | null>
}
