import { PrismaClient } from '../generated/prisma';
import CatracaClient, { Message } from './CatracaClient';
import dotenv from 'dotenv';
dotenv.config();

const ip_catraca = process.env.IP_CATRACA as string;
const port_catraca = parseInt(process.env.PORT_CATRACA as string);

const prisma = new PrismaClient();
const catraca = new CatracaClient(ip_catraca, port_catraca, 40);

catraca.on('connect', () => {
    console.log('Connected!')
});

catraca.on('data', (message: Message) => {
    if (message.command == 'REON') {
        const data = message.data.split(']');

        const tagId: number = parseInt(data[1]);

        if (tagId == 20859544) {
            catraca.allowEntrance(message.index);
        } else if (!Number.isNaN(tagId)) {
            catraca.denyAccess(message.index);
        }
    }
})

catraca.on('timeout', () => {
    console.log('Error: Timeout')
});

catraca.on('error', (error) => {
    console.log(`Error: ${error.message}`)
});

catraca.on('close', (hadError) => {
    console.log(`Connection closed ${hadError ? 'with' : 'without'} error(s).`);
    catraca.connect();
});

const delay = async (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
    while (true) {
        await delay(100);
    }
}

main()
    .catch(console.log)
    .finally(async () => {
        await prisma.$disconnect();
    });