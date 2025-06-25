import { PrismaClient } from '../generated/prisma';

const prisma = new PrismaClient();

async function main() {

}

main()
    .catch(console.log)
    .finally(async () => {
        await prisma.$disconnect();
    });