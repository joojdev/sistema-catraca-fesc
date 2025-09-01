/**
 * TurnstileClient
 * ---------------
 * Cliente de alto nível para comunicação com catracas (ou controladoras de acesso)
 * através de um soquete TCP (veja `TCPClient`). Encapsula a criação do frame
 * de comunicação, parseia respostas e disponibiliza métodos convenientes para
 * autorizar ou negar passagem.
 *
 * Somente **comentários** foram adicionados para explicar a lógica; o código
 * executável permanece exatamente igual.
 */

import TCPClient from './TCPClient'
import { EventEmitter } from 'node:events'
import text from '../../utils/i18n'

// -------------------- Tipos auxiliares ---------------------------------------

/**
 * Resultado de uma operação que pode falhar.
 * - Sucesso:        { ok: true,  value: T }
 * - Falha/erro:     { ok: false, error: Error }
 */
type Result<T> = { ok: true; value: T } | { ok: false; error: Error }

/**
 * Estrutura de mensagem retornada pelo equipamento após o parse.
 * Os nomes refletem exatamente os campos presentes na resposta.
 */
export type Message = {
  originalResponse: string // resposta completa em modo "binary"
  originalResponseBuffer: Buffer // buffer bruto da resposta
  size: number // byte de tamanho (segundo byte do frame)
  index: number // número sequencial utilizado pelo protocolo
  command: string // comando executado (ex.: "REON")
  error_or_version: string // erro retornado OU versão do firmware
  data: string // payload de dados (Ex.: mensagem no display)
}

// -------------------- Cliente principal --------------------------------------

class TurnstileClient extends EventEmitter {
  private tcpClient: TCPClient | null = null // soquete encapsulado

  /**
   * @param ip           Endereço IP da catraca/controladora
   * @param port         Porta TCP do serviço
   * @param release_time Tempo (em segundos) que a catraca ficará destravada
   */
  constructor(
    private ip: string,
    private port: number,
    private release_time: number = 4,
  ) {
    super()
    this.tcpClient = new TCPClient(this.ip, this.port)

    // Reencaminha eventos baixos (do socket) para consumidores externos
    this.tcpClient.on('connect', () => this.emit('connect'))
    this.tcpClient.on('data', (data) =>
      this.emit('data', this._readResponse(data)),
    )
    this.tcpClient.on('timeout', () => this.emit('timeout'))
    this.tcpClient.on('error', (error) => this.emit('error', error))
    this.tcpClient.on('close', (hadError) => this.emit('close', hadError))

    // Inicia conexão assim que o objeto é criado
    this.connect()
  }

  // -------------------- Parsing -------------------------------------------

  /**
   * Converte o buffer recebido em uma estrutura de alto nível (`Message`).
   * Lança erros se qualquer validação falhar.
   */
  private _readResponse = (messageBuffer: Buffer): Message => {
    const STX = 0x02 // Start of TeXt
    const ETX = 0x03 // End of TeXt
    const PLUS = 0x2b // '+' separador

    const length = messageBuffer.length

    // --- Validações básicas --------------------------------------------------
    if (length < 7) {
      throw new Error('Resposta muito curta')
    }
    if (messageBuffer[0] !== STX || messageBuffer[length - 1] !== ETX) {
      throw new Error('interferência na comunicação com o equipamento')
    }

    // --- Cabeçalho ----------------------------------------------------------
    const size = messageBuffer[1] // byte de tamanho
    const indexStr =
      String.fromCharCode(messageBuffer[3]) +
      String.fromCharCode(messageBuffer[4]) // índice (dois dígitos ASCII)
    const index = Number.parseInt(indexStr, 10) // ex.: "01" → 1

    // o byte 5 (0-based) deve ser o primeiro "+"
    let cursor = 5
    if (messageBuffer[cursor] !== PLUS) {
      throw new Error('Formato inesperado (faltou separador após índice)')
    }
    cursor++ // 1.º caractere do comando

    // --- Comando -------------------------------------------------------------
    const cmdStart = cursor
    while (cursor < length - 1 && messageBuffer[cursor] !== PLUS) cursor++
    const command = messageBuffer.slice(cmdStart, cursor).toString('ascii')

    // --- Err/Versão ----------------------------------------------------------
    if (messageBuffer[cursor] !== PLUS) {
      throw new Error('Formato inesperado (faltou separador após comando)')
    }
    cursor++ // 1.º caractere de err_or_version

    const errStart = cursor
    while (cursor < length - 1 && messageBuffer[cursor] !== PLUS) cursor++
    const errorOrVersion = messageBuffer
      .slice(errStart, cursor)
      .toString('ascii')

    // --- Dados ---------------------------------------------------------------
    if (messageBuffer[cursor] !== PLUS) {
      throw new Error('Formato inesperado (faltou separador após err/version)')
    }
    cursor++ // 1.º byte de data

    // data vai até antes do checksum (penúltimo byte)
    const data = messageBuffer.slice(cursor, length - 2).toString('ascii')

    // --- Monta resultado -----------------------------------------------------
    const parsed: Message = {
      originalResponse: messageBuffer.toString('binary'),
      originalResponseBuffer: messageBuffer,
      size,
      index,
      command,
      error_or_version: errorOrVersion,
      data,
    }

    // Repassa para fora caso alguém queira ouvir
    this.emit('message', parsed)

    return parsed
  }

  // -------------------- Conexão --------------------------------------------

  /**
   * Garante que o socket esteja conectado (tentativa única).
   */
  async connect() {
    await this.tcpClient?.connect()
  }

  // -------------------- Utilidades privadas --------------------------------

  /**
   * Calcula checksum (XOR de todos os bytes) segundo protocolo.
   */
  private _checksum(buffer: Buffer): number {
    let sum = 0
    for (const byte of buffer) sum ^= byte // XOR byte‑a‑byte
    return sum
  }

  /**
   * Constrói um frame pronto para envio ao equipamento.
   * Formato: STX | size | index+payload | checksum | ETX
   */
  private _buildFrame(index: number, payload: string): Buffer {
    const data = Buffer.from(`${index}+${payload}`, 'ascii')
    const size = Buffer.from([data.length, 0]) // 2 bytes (LSB, MSB)
    const checksum = Buffer.from([this._checksum(Buffer.concat([data, size]))])

    const builtFrame = Buffer.concat([
      Buffer.from([0x02]), // STX
      size,
      data,
      checksum,
      Buffer.from([0x03]), // ETX
    ])

    return builtFrame
  }

  /**
   * Envia frame ao equipamento e retorna sucesso/erro encapsulado em Result.
   */
  private async _send(index: number, payload: string): Promise<Result<string>> {
    const frame = this._buildFrame(index, payload)
    const error = await this.tcpClient!.send(frame)

    if (!error) return { ok: true, value: 'success!' }
    return { ok: false, error: new Error(error) }
  }

  // -------------------- API pública -----------------------------------------

  /**
   * Autoriza ENTRADA (sentido 2) por `release_time` segundos.
   */
  async allowEntry(index: number, message: string) {
    this._send(index, `REON+00+6]${this.release_time}]${message}]2`)
  }

  /**
   * Autoriza SAÍDA (sentido 1) por `release_time` segundos.
   */
  async allowExit(index: number, message: string) {
    this._send(index, `REON+00+5]${this.release_time}]${message}]1`)
  }

  /**
   * Nega acesso exibindo mensagem customizável (padrão "ACESSO NEGADO!").
   */
  async denyAccess(index: number, message: string = text.accessDenied) {
    this._send(index, `REON+00+30]${this.release_time}]${message}]1`)
  }
}

export default TurnstileClient
