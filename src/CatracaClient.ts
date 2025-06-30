import TCPClient from './TCPClient';

type Result<T> = { ok: true, value: T } | { ok: false, error: Error };

class CatracaClient {
    private tcpClient: TCPClient | null = null;

    constructor(private ip: string, private port: number, private release_time: number = 40) {
        this.tcpClient = new TCPClient(this.ip, this.port);
        this.tcpClient.connect();
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
}

export default CatracaClient;