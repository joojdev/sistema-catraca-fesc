import { join } from 'path'
import { existsSync, statSync, unlinkSync, writeFileSync } from 'fs'
import { logger } from '@/infrastructure/config/env'

/**
 * Classe para implementar um sistema de lockfile (arquivo de bloqueio)
 * Previne execução simultânea de processos críticos através de um arquivo temporário
 *
 * Casos de uso:
 * - Evitar múltiplas execuções de jobs de importação
 * - Garantir que operações críticas no banco não sejam executadas em paralelo
 * - Implementar mutex simples baseado em sistema de arquivos
 */
export class Lockfile {
  private readonly filePath: string // Caminho completo do arquivo de lock
  private readonly timeoutMs: number // Timeout em milissegundos para expiração do lock

  /**
   * @param name - Nome único do lock (será usado como nome do arquivo)
   * @param timeoutSeconds - Tempo limite em segundos após o qual o lock expira (padrão: 5 minutos)
   */
  constructor(name: string, timeoutSeconds: number = 300) {
    // Cria arquivo de lock no diretório temporário do sistema (/tmp no Linux/macOS)
    this.filePath = join('/tmp', `${name}.lock`)
    this.timeoutMs = timeoutSeconds * 1000 // Converte segundos para milissegundos
  }

  /**
   * Tenta adquirir o lock criando um arquivo
   * @returns true se conseguiu adquirir o lock, false se já estava ocupado
   */
  acquire(): boolean {
    // Se já existe um lock válido, não pode adquirir
    if (this.isLocked()) {
      logger.debug({ lockPath: this.filePath }, 'Lock já está sendo usado')
      return false
    }

    try {
      // Cria arquivo de lock com timestamp atual
      // flag 'w' sobrescreve se existir (para casos de cleanup)
      writeFileSync(this.filePath, Date.now().toString(), { flag: 'w' })
      logger.debug({ lockPath: this.filePath }, 'Lock adquirido com sucesso')
      return true
    } catch (error) {
      logger.error(
        { err: error, lockPath: this.filePath },
        'Erro ao adquirir lock',
      )
      return false
    }
  }

  /**
   * Verifica se existe um lock ativo e válido
   * @returns true se existe lock válido, false caso contrário
   */
  isLocked(): boolean {
    // Se arquivo não existe, não há lock
    if (!existsSync(this.filePath)) {
      return false
    }

    try {
      // Obtém estatísticas do arquivo para verificar idade
      const stats = statSync(this.filePath)
      const age = Date.now() - stats.mtimeMs // Calcula idade do arquivo em ms

      // Se arquivo é mais antigo que timeout, considera expirado
      if (age > this.timeoutMs) {
        logger.warn(
          {
            lockPath: this.filePath,
            ageSeconds: Math.floor(age / 1000),
            timeoutSeconds: Math.floor(this.timeoutMs / 1000),
          },
          'Lock expirado detectado - removendo automaticamente',
        )

        // Remove lock expirado automaticamente
        this.release()
        return false
      }

      // Lock existe e ainda é válido
      logger.debug(
        {
          lockPath: this.filePath,
          ageSeconds: Math.floor(age / 1000),
        },
        'Lock ativo encontrado',
      )
      return true
    } catch (error) {
      logger.error(
        { err: error, lockPath: this.filePath },
        'Erro ao verificar status do lockfile - assumindo não bloqueado',
      )

      // Em caso de erro, assume que não há lock válido
      // Isso evita deadlocks em casos de problemas de I/O
      return false
    }
  }

  /**
   * Libera o lock removendo o arquivo
   * Operação sempre segura - não falha se arquivo não existe
   */
  release(): void {
    // Se arquivo não existe, já está "liberado"
    if (!existsSync(this.filePath)) {
      logger.debug({ lockPath: this.filePath }, 'Lock já estava liberado')
      return
    }

    try {
      // Remove arquivo de lock
      unlinkSync(this.filePath)
      logger.debug({ lockPath: this.filePath }, 'Lock liberado com sucesso')
    } catch (error) {
      // Log erro mas não propaga - liberação deve ser sempre "segura"
      logger.error(
        { err: error, lockPath: this.filePath },
        'Erro ao liberar lockfile - pode causar bloqueio futuro',
      )
    }
  }

  /**
   * Retorna informações sobre o estado atual do lock
   * Útil para debugging e monitoramento
   */
  getStatus(): {
    exists: boolean
    isActive: boolean
    filePath: string
    ageMs: number | undefined
    timeoutMs: number
  } {
    const exists = existsSync(this.filePath)
    let ageMs: number | undefined
    let isActive = false

    if (exists) {
      try {
        const stats = statSync(this.filePath)
        ageMs = Date.now() - stats.mtimeMs
        isActive = ageMs <= this.timeoutMs
      } catch {
        // Em caso de erro, considera inativo
        isActive = false
      }
    }

    return {
      exists,
      isActive,
      filePath: this.filePath,
      ageMs,
      timeoutMs: this.timeoutMs,
    }
  }

  /**
   * Força remoção do lock independentemente do timeout
   * Use com cuidado - pode interromper processos legítimos
   */
  forceRelease(): void {
    logger.warn({ lockPath: this.filePath }, 'Forçando liberação do lock')
    this.release()
  }
}
