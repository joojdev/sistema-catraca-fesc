import net from 'node:net';
import { once } from 'node:events';

const RECV_TIMEOUT_MS = 30_500; // 30.5 segundos
const MSG_MAX_LEN = 4096;

class TCPClient {
    private socket: net.Socket | null = null;

    constructor(private ip: string, private port: number) {}

    async connect(): Promise<false | '_TIMEOUT_' | string> {
        if (this.socket && !this.socket.destroyed) return false;

        this.socket = net.createConnection({ host: this.ip, port: this.port });

        this.socket.setTimeout(RECV_TIMEOUT_MS);

        try {
            await Promise.race([
                once(this.socket, 'connect'),
                once(this.socket, 'timeout').then(() => {
                    throw Object.assign(new Error('_TIMEOUT_'), { code: 'ETIMEDOUT' });
                }),
                once(this.socket, 'error').then(([error]) => {
                    throw error as NodeJS.ErrnoException;
                })
            ]);

            return false;
        } catch(error) {
            this.socket.destroy();
            this.socket = null;

            if (
                (error as NodeJS.ErrnoException).code == 'ETIMEDOUT' ||
                (error as NodeJS.ErrnoException).code == 'EAGAIN'
            ) {
                return '_TIMEDOUT_';
            }

            return `socket_connect() failed: ${(error as Error).message}`
        }
    }

    async listen(): Promise<Buffer | '_TIMEOUT_' | string> {
        const error = await this.connect();
        if (error) return error;

        if (!this.socket) return 'inexistent socket.';

        try {
            const [data] = (await Promise.race([
                once(this.socket, 'data'),
                once(this.socket, 'timeout').then(() => {
                    throw Object.assign(new Error('_TIMEOUT_'), { code: 'ETIMEDOUT' });
                }),
                once(this.socket, 'error').then(([error]) => { throw error; })
            ])) as [Buffer];

            return data.slice(0, MSG_MAX_LEN);
        } catch(error) {
            this.socket.destroy();
            this.socket = null;
            if ((error as any).code == 'ETIMEDOUT') return '_TIMEOUT_';
            return `socket_read failed: ${(error as any).message}`;
        }
    }

    async send(payload: Buffer | string): Promise<false | string> {
        const error = await this.connect();
        if (error) return error;

        if (!this.socket) return 'inexistent socket.';

        return new Promise<false | string>((resolve) => {
            this.socket!.write(payload, (error) => {
                if (error) {
                    this.socket!.destroy();
                    this.socket = null;
                    resolve(`socket_send() failed: ${error.message}`);
                } else {
                    resolve(false);
                }
            })
        });
    }
}

export default TCPClient;