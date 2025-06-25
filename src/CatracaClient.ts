import TCPClient from './TCPClient';

class CatracaClient {
    private tcpClient: TCPClient | null = null;

    constructor(private ip: string, private port: number) {
        this.tcpClient = new TCPClient(this.ip, this.port);
    }

    private checksum(buffer: Buffer): number {
        let sum = 0;
        for (const byte of buffer) sum ^= byte;
        return sum;
    }

    private async send(index: number, payload: string): Promise<false | string> {
        const data = Buffer.from(`${index}+${payload}`, 'ascii');
        const size = Buffer.from([data.length, 0]);
        const checksum = Buffer.from([this.checksum(Buffer.concat([data, size]))]);

        const fullPayload = Buffer.concat([
            Buffer.from([0x02]),
            size,
            data,
            checksum,
            Buffer.from([0x03])
        ]);

        return await this.tcpClient!.send(fullPayload);
    }

    // private async listen(): Promise<false | Response> {
        
    // }
}

export default CatracaClient;