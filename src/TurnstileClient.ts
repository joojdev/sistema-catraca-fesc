import TCPClient from './TCPClient';
import { EventEmitter } from 'node:events';

type Result<T> = { ok: true, value: T } | { ok: false, error: Error };
export type Message = {
    originalResponse: string,
    originalResponseBuffer: Buffer,
    size: number,
    index: number,
    command: string,
    error_or_version: string,
    data: string
};

class TurnstileClient extends EventEmitter {
    private tcpClient: TCPClient | null = null;

    constructor(private ip: string, private port: number, private release_time: number = 4) {
        super();
        this.tcpClient = new TCPClient(this.ip, this.port);

        this.tcpClient.on('connect', () => this.emit('connect'));
        this.tcpClient.on('data', (data) => this.emit('data', this._readResponse(data)));
        this.tcpClient.on('timeout', () => this.emit('timeout'));
        this.tcpClient.on('error', (error) => this.emit('error', error));
        this.tcpClient.on('close', (hadError) => this.emit('close', hadError));

        this.connect();
    }

    private _readResponse = (messageBuffer: Buffer): Message => {
        const STX = 0x02;
        const ETX = 0x03;
        const PLUS = 0x2B;          // '+'

        const length = messageBuffer.length;

        // --- Validações básicas --------------------------------------------------
        if (length < 7) {
            throw new Error('Resposta muito curta');
        }
        if (messageBuffer[0] !== STX || messageBuffer[length - 1] !== ETX) {
            throw new Error('interferência na comunicação com o equipamento');
        }

        // --- Cabeçalho ----------------------------------------------------------
        const size = messageBuffer[1];                       // byte de tamanho
        const indexStr = String.fromCharCode(messageBuffer[3]) +
            String.fromCharCode(messageBuffer[4]); // dois dígitos
        const index = Number.parseInt(indexStr, 10);          // ex.: "01" → 1

        // o byte 5 (0-based) deve ser o primeiro '+'
        let cursor = 5;
        if (messageBuffer[cursor] !== PLUS) {
            throw new Error('Formato inesperado (faltou separador após índice)');
        }
        cursor++; // 1.º caractere do comando

        // --- Comando -------------------------------------------------------------
        const cmdStart = cursor;
        while (cursor < length - 1 && messageBuffer[cursor] !== PLUS) cursor++;
        const command = messageBuffer.slice(cmdStart, cursor).toString('ascii');

        // --- Err/Versão ----------------------------------------------------------
        if (messageBuffer[cursor] !== PLUS) {
            throw new Error('Formato inesperado (faltou separador após comando)');
        }
        cursor++; // 1.º caractere de err_or_version

        const errStart = cursor;
        while (cursor < length - 1 && messageBuffer[cursor] !== PLUS) cursor++;
        const errorOrVersion = messageBuffer
            .slice(errStart, cursor)
            .toString('ascii');

        // --- Dados ---------------------------------------------------------------
        if (messageBuffer[cursor] !== PLUS) {
            throw new Error('Formato inesperado (faltou separador após err/version)');
        }
        cursor++; // 1.º byte de data

        // data vai até antes do checksum (penúltimo byte)
        const data = messageBuffer
            .slice(cursor, length - 2)
            .toString('ascii');

        // --- Monta resultado -----------------------------------------------------
        const parsed: Message = {
            originalResponse: messageBuffer.toString('binary'),
            originalResponseBuffer: messageBuffer,
            size,
            index,
            command,
            error_or_version: errorOrVersion,
            data
        };

        // Repassa para fora caso alguém queira ouvir
        this.emit('message', parsed);

        return parsed;
    };



    async connect() {
        await this.tcpClient?.connect();
    }

    private _checksum(buffer: Buffer): number {
        let sum = 0;
        for (const byte of buffer) sum ^= byte; // XOR
        return sum;
    }

    private _buildFrame(index: number, payload: string): Buffer {
        const data = Buffer.from(`${index}+${payload}`, 'ascii');
        const size = Buffer.from([data.length, 0]);
        const checksum = Buffer.from([this._checksum(Buffer.concat([data, size]))]);

        const builtFrame = Buffer.concat([
            Buffer.from([0x02]),
            size,
            data,
            checksum,
            Buffer.from([0x03])
        ]);

        return builtFrame;
    }

    private async _send(index: number, payload: string): Promise<Result<string>> {
        const frame = this._buildFrame(index, payload);
        const error = await this.tcpClient!.send(frame);

        if (!error) return { ok: true, value: 'success!' };
        return { ok: false, error: new Error(error) };
    }

    async allowEntry(index: number, message: string) {
        this._send(index, `REON+00+6]${this.release_time}]${message}]2`)
    }

    async allowExit(index: number, message: string) {
        this._send(index, `REON+00+5]${this.release_time}]${message}]1`)
    }

    async denyAccess(index: number, message: string = "ACESSO NEGADO!") {
        this._send(index, `REON+00+30]${this.release_time}]${message}]1`);
    }
}

export default TurnstileClient;