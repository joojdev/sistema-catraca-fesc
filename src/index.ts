import { PrismaClient } from '../generated/prisma';
import TurnstileClient, { Message } from './TurnstileClient';
import dotenv from 'dotenv';
dotenv.config();

const TURNSTILE_IP = process.env.TURNSTILE_IP as string;
const TURNSTILE_PORT = parseInt(process.env.TURNSTILE_PORT as string);
const DELAY_TOLERANCE = parseInt(process.env.DELAY_TOLERANCE as string);
const TIMEZONE = process.env.TIMEZONE;

const prisma = new PrismaClient();
const turnstile = new TurnstileClient(TURNSTILE_IP, TURNSTILE_PORT, 40);

turnstile.on('connect', () => {
    console.log('Connected!')
});

turnstile.on('data', async (message: Message) => {
    const currentDate = new Date(new Date().toLocaleString('en-US', { timeZone: TIMEZONE }));

    if (message.command == 'REON') {
        const data: string[] = message.data.split(']');

        const eventCode: number = parseInt(data[0]);

        if (eventCode == 0) { // Leitura do RFID
            const tagId: number = parseInt(data[1]);

            if (Number.isNaN(tagId)) return;

            const way: number = parseInt(data[5]);

            const tag = await prisma.tag.findUnique({
                where: {
                    credential: tagId
                }
            });

            if (!tag) return turnstile.denyAccess(message.index);
            if (tag.admin) return allowAccess(turnstile, message.index, way, tag.status);
            if (!tag.released) return turnstile.denyAccess(message.index, tag.status);

            const classes = await prisma.class.findMany({
                where: { tag: tag },          // use a FK explícita
                orderBy: { start: 'asc' }          // garante horário crescente
            });

            if (!classes.length) return turnstile.denyAccess(message.index);

            let foundWindow = false;

            for (const classElement of classes) {
                const [h, m] = classElement.start.split(':').map(Number);
                const classStartDate = new Date(currentDate);
                classStartDate.setHours(h, m, 0, 0);

                const windowStart = new Date(classStartDate.getTime() - DELAY_TOLERANCE * 60_000);
                const windowEnd = new Date(classStartDate.getTime() + DELAY_TOLERANCE * 60_000);

                if (currentDate > windowEnd) {
                    continue;
                }

                if (currentDate < windowStart) {
                    return turnstile.denyAccess(
                        message.index,
                        'VOLTE NO HORÁRIO DA AULA!'
                    );
                }

                foundWindow = true;
                return allowAccess(turnstile, message.index, way, tag.status);
            }

            if (!foundWindow) {
                return turnstile.denyAccess(message.index, 'ATRASADO(A)!');
            }

        } else if (eventCode == 81) { // Giro da Catraca

        }
    }
});

function allowAccess(turnstile: TurnstileClient, index: number, way: number, status: string) {
    if (way == 2) {
        turnstile.allowEntry(index, status);
    } else if (way == 3) {
        turnstile.allowExit(index, status);
    }
}

turnstile.on('timeout', () => {
    console.log('Error: Timeout')
});

turnstile.on('error', (error) => {
    console.log(`Error: ${error.message}`)
});

turnstile.on('close', (hadError) => {
    console.log(`Connection closed ${hadError ? 'with' : 'without'} error(s).`);
    turnstile.connect();
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