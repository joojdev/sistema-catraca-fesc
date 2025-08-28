import { join } from 'path'
import { existsSync, statSync, unlinkSync, writeFileSync } from 'fs'
import { logger } from '../env'

export class Lockfile {
  private readonly filePath: string
  private readonly timeoutMs: number

  constructor(name: string, timeoutSeconds: number = 300) {
    this.filePath = join('/tmp', `${name}.lock`)
    this.timeoutMs = timeoutSeconds * 1000
  }

  acquire(): boolean {
    if (this.isLocked()) return false

    writeFileSync(this.filePath, Date.now().toString(), { flag: 'w' })
    return true
  }

  isLocked(): boolean {
    if (!existsSync(this.filePath)) return false

    try {
      const stats = statSync(this.filePath)
      const age = Date.now() - stats.mtimeMs

      if (age > this.timeoutMs) {
        logger.warn(
          `Lock has expired (${Math.floor(age / 1000)}s). Removing...`,
        )
        this.release()
        return false
      }

      return true
    } catch (error) {
      logger.error('Error while verifying lockfile:', error)
      return false
    }
  }

  release(): void {
    if (!existsSync(this.filePath)) return

    try {
      unlinkSync(this.filePath)
    } catch (error) {
      logger.error('Error while releasing lockfile:', error)
    }
  }
}
