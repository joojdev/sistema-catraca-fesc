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

    // console.log(message);
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
                where: {
                    tag: tag
                }
            });

            if (!classes.length) return turnstile.denyAccess(message.index);

            for (const classElement of classes) {
                const [classHours, classMinutes] = classElement.start
                    .split(':')
                    .map((n) => parseInt(n, 10));

                // Data/hora do início da aula
                const classStartDate = new Date(currentDate);
                classStartDate.setHours(classHours, classMinutes, 0, 0);

                // Janela de permissão: [start - DELAY_TOLERANCE, start + DELAY_TOLERANCE]
                const windowStart = new Date(classStartDate.getTime() - DELAY_TOLERANCE * 60 * 1000);
                const windowEnd = new Date(classStartDate.getTime() + DELAY_TOLERANCE * 60 * 1000);

                console.log(`Janela: de ${windowStart.toLocaleTimeString()} até ${windowEnd.toLocaleTimeString()}`);

                if (currentDate >= windowStart && currentDate <= windowEnd) {
                    return allowAccess(turnstile, message.index, way, tag.status);
                } else {
                    // Se chegou antes demais ou muito atrasado
                    return turnstile.denyAccess(message.index, "Fora da janela de entrada permitida");
                }
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