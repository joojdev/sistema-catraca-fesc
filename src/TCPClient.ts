/**
 * TCPClient
 * Wrapper simples para net.Socket do Node.js que fornece interface baseada
 * em Promises para conectar‑se e enviar dados, além de expor eventos úteis.
 *
 * Uso típico:
 *   const client = new TCPClient('127.0.0.1', 1234);
 *   await client.send(Buffer.from('ping'));
 *   client.on('data', (buf) => { ... });
 *
 * Somente comentários foram adicionados; a lógica original permanece intacta.
 */

import net from 'node:net';
import { EventEmitter, once } from 'node:events';

// Tempo máximo (ms) sem receber dados antes de considerar timeout
const RECV_TIMEOUT_MS = 30_500; // 30,5 s
// Tamanho máximo de mensagem a ser propagada para listeners
const MSG_MAX_LEN = 4096;

// Possíveis retornos de connect():
//   void        → sucesso
//   '_TIMEOUT_' → falha por timeout
//   string      → mensagem de erro específica
type ConnectResult = void | '_TIMEOUT_' | string;

/**
 * Cliente TCP minimalista com reconexão preguiçosa.
 * Eventos emitidos:
 *  - 'connect'  quando a conexão é estabelecida
 *  - 'data'     ao receber dados (truncados em MSG_MAX_LEN)
 *  - 'timeout'  quando o socket fica ocioso demais
 *  - 'error'    em erros de I/O
 *  - 'close'    quando a conexão é encerrada
 */
export default class TCPClient extends EventEmitter {
    // Instância ativa do socket; null quando desconectado
    private socket: net.Socket | null = null;

    constructor(private ip: string, private port: number) {
        super();
    }

    /**
     * Garante que exista conexão ativa.
     * Idempotente: se já estiver conectado apenas retorna.
     */
    async connect(): Promise<ConnectResult> {
        // Reutiliza socket existente se ainda válido
        if (this.socket && !this.socket.destroyed) return;

        // Cria novo socket TCP
        this.socket = net.createConnection({ host: this.ip, port: this.port });

        // Define timeout para recepção de dados
        this.socket.setTimeout(RECV_TIMEOUT_MS);

        // Encaminha eventos de baixo nível
        this.socket.on('data', (chunk) => this.emit('data', chunk.slice(0, MSG_MAX_LEN)));
        this.socket.on('timeout', () => this._handleTimeout());
        this.socket.on('error', (error) => this._handleError(error));
        this.socket.on('close', (hadError) => this.emit('close', hadError));

        // Aguarda a primeira ocorrência entre connect, error ou timeout
        try {
            await Promise.race([
                once(this.socket, 'connect').then(() => {
                    this.emit('connect');
                }),
                once(this.socket, 'error').then(([error]) => {
                    throw error;
                }),
                // Timeout durante a tentativa de conexão
                once(this.socket, 'timeout').then(() => {
                    throw new Error('_TIMEOUT_');
                })
            ])
        } catch (error) {
            // Libera recursos e propaga erro
            this._cleanup();
            if ((error as any).message == '_TIMEOUT_') return '_TIMEOUT_';
            return `socket_connect() failed: ${(error as any).message}`;
        }
    }

    /**
     * Envia dados após garantir conexão.
     * @param payload Buffer ou string a transmitir.
     * @returns false se sucesso; string com erro caso contrário.
     */
    async send(payload: Buffer | string): Promise<false | string> {
        const err = await this.connect();
        if (err) return err;
        if (!this.socket) return 'inexistent socket.';

        return new Promise(resolve => {
            this.socket!.write(payload, error => {
                if (error) {
                    this._handleError(error);
                    resolve(`socket_send() failed: ${error.message}`);
                } else {
                    resolve(false);
                }
            });
        });
    }

    /**
     * Fecha a conexão explicitamente.
     */
    close() {
        this._cleanup();
    }

    // ---------------- Métodos privados ----------------

    private _handleTimeout() {
        this.emit('timeout');
        this._cleanup();
    }

    private _handleError(error: NodeJS.ErrnoException) {
        this.emit('error', error)
        this._cleanup();
    }

    /**
     * Destroi o socket e reseta estado interno.
     */
    private _cleanup() {
        if (this.socket && !this.socket.destroyed) {
            this.socket.destroy();
        }
        this.socket = null;
    }
}
