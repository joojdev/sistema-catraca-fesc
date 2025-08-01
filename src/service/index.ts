import { PrismaClient, WeekDay } from "../../generated/prisma";
import env, { logger } from "../env";
import ky from "ky";
import schedule from "node-schedule";
import { z } from "zod";

const weekDays: WeekDay[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function timeToMinutes(time: string) {
  const [hh, mm] = time.split(":").map((number) => parseInt(number));
  return hh * 60 + mm;
}

const HourSchema = z
  .tuple([
    z
      .string()
      .regex(
        /^(?:[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$/,
        "The hour must be in the format H:MM or HH:MM!",
      ),
    z.coerce.number().min(0).max(6)
  ])
  .transform(
    ([start, weekDay]) =>
      [timeToMinutes(start), weekDays[weekDay]] as [number, WeekDay],
  );

const ApiResponseSchema = z.array(
  z.object({
    aluno_id: z.coerce.number(),
    credencial: z.coerce.number(),
    horarios: z.array(HourSchema),
    liberado: z.boolean(),
    status: z.string().nonempty(),
    admin: z.boolean(),
  }),
);

async function main() {
  const prisma = new PrismaClient();
  try {
    await prisma.$connect();
    logger.info("Connected to database!");
    startCron(prisma);
  } catch (error) {
    logger.error("There was an error trying to connect to the database!");
    logger.error(error);
    await prisma.$disconnect();
    process.exit(1);
  }

  process.on("SIGINT", async () => {
    logger.info("Gracefully shutting down...");
    await prisma.$disconnect();
    process.exit(0);
  });
}

async function startCron(prisma: PrismaClient) {
  logger.info("Started Cron Job!");
  schedule.scheduleJob(env.CRON_PARAMETERS, async () => {
    const url = new URL(env.API_URL);
    url.pathname = "/services/catraca";

    const data = await ky
      .get(url.toString(), {
        headers: {
          Token: env.API_TOKEN,
        },
      })
      .json();

    const parsed = ApiResponseSchema.safeParse(data);

    if (!parsed.success) {
      logger.error("There was an error in the API!");
      logger.error(
        parsed.error.issues.map((error) => error.message).join("\n"),
      );
      return;
    }

    for (const user of parsed.data) {
      let tag = await prisma.tag.findUnique({
        where: {
          user_id: user.aluno_id,
        },
      });

      if (tag == null) {
        tag = await prisma.tag.create({
          data: {
            user_id: user.aluno_id,
            admin: user.admin,
            credential: user.credencial,
            released: user.liberado,
            status: user.status,
          },
        });
      } else {
        if (tag.credential != user.credencial) {
          await prisma.tag.update({
            data: {
              credential: user.credencial,
            },
            where: {
              user_id: tag.user_id,
            },
          });
        }

        await prisma.class.deleteMany({
          where: {
            tag_user_id: tag.user_id,
          },
        });
      }

      for (const [start, weekDay] of user.horarios) {
        await prisma.class.create({
          data: {
            start,
            weekDay,
            tag_user_id: tag.user_id,
          },
        });
      }
    }
  });
}

main();
