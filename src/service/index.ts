import schedule from "node-schedule";
import { PrismaClient } from "../../generated/prisma";
import env, { logger } from "../env";
import runImport from "../utils/importJob";
import express from "express";

async function main() {
  const prisma = new PrismaClient();

  await prisma.$connect();
  logger.info("Connected to database!");

  schedule.scheduleJob(env.CRON_PARAMETERS, () => runImport(prisma));

  const app = express();

  app.get("/trigger-import", async (request, response) => {
    runImport(prisma)
      .then(() => response.send("Import finished!"))
      .catch((error) => {
        logger.error(error);
        response.status(500).send("Error running import!");
      });
  });

  app.listen(3000, () => {
    logger.info("Server running on port 3000!");
  });

  process.on("SIGINT", async () => {
    logger.info("Gracefully shutting down...");
    await prisma.$disconnect();
    process.exit(0);
  });
}

main();
