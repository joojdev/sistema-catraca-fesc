import net from 'node:net';
import { EventEmitter, once } from 'node:events';

const RECV_TIMEOUT_MS = 30_500; // 30,5s
const MSG_MAX_LEN = 4096;

type ConnectResult = void | '_TIMEOUT_' | string;

export default class TCPClient extends EventEmitter {
    private socket: net.Socket | null = null;

    constructor(private ip: string, private port: number) {
        super();
    }

    async connect(): Promise<ConnectResult> {
        if (this.socket && !this.socket.destroyed) return;

        this.socket = net.createConnection({ host: this.ip, port: this.port });

        this.socket.setTimeout(RECV_TIMEOUT_MS);

        this.socket.on('data', (chunk) => this.emit('data', chunk.slice(0, MSG_MAX_LEN)));
        this.socket.on('timeout', () => this._handleTimeout());
        this.socket.on('error', (error) => this._handleError(error));
        this.socket.on('close', (hadError) => this.emit('close', hadError));

        try {
            await Promise.race([
                once(this.socket, 'connect').then(() => {
                    this.emit('connect');
                }),
                once(this.socket, 'error').then(([error]) => {
                    throw error;
                }),
                once(this.socket, 'timeout').then(() => {
                    throw new Error('_TIMEOUT_');
                })
            ])
        } catch (error) {
            this._cleanup();
            if ((error as any).message == '_TIMEOUT_') return '_TIMEOUT_';
            return `socket_connect() failed: ${(error as any).message}`;
        }
    }

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

    close() {
        this._cleanup();
    }

    private _handleTimeout() {
        this.emit('timeout');
        this._cleanup();
    }

    private _handleError(error: NodeJS.ErrnoException) {
        this.emit('error', error)
        this._cleanup();
    }

    private _cleanup() {
        if (this.socket && !this.socket.destroyed) {
            this.socket.destroy();
        }
        this.socket = null;
    }
}