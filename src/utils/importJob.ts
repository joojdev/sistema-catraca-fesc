import { Access, PrismaClient, Status, WeekDay } from "../../generated/prisma";
import env, { logger } from "../env";
import ky from "ky";
import { z } from "zod";
import { Lockfile } from "./Lockfile";

const lockfile = new Lockfile("import", 60);

const weekDays: { [key: string]: WeekDay } = {
  dom: "sunday",
  seg: "monday",
  ter: "tuesday",
  qua: "wednesday",
  qui: "thursday",
  sex: "friday",
  sab: "saturday",
};

type PostRequestBody = {
  acesso: number;
  aluno: number;
  id_acesso: number;
}[];

const PostApiResponseSchema = z.array(
  z.object({
    acesso: z.coerce.number(),
    status: z
      .enum(["success", "failed"])
      .transform((value) => value == "success"),
    message: z.string(),
  }),
);

function timeToMinutes(time: string) {
  const [hh, mm, _ss] = time.split(":").map((number) => parseInt(number));
  return hh * 60 + mm;
}

const HourSchema = z
  .object({
    hora: z
      .string()
      .regex(
        /^(?:[0-9]|1[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/,
        "The hour must be in the format H:MM:SS or HH:MM:SS!",
      ),
    dias: z.array(z.enum(Object.keys(weekDays))),
  })
  .transform(
    ({
      hora: start,
      dias: receivedWeekDays,
    }: {
      hora: string;
      dias: string[];
    }) =>
      [
        timeToMinutes(start),
        receivedWeekDays.map((receivedWeekDay) => weekDays[receivedWeekDay]),
      ] as [number, WeekDay[]],
  );

const GetApiResponseSchema = z.object({
  aluno_id: z.coerce.number(),
  credencial: z.coerce.number(),
  horarios: z.array(HourSchema),
  liberado: z.boolean(),
  status: z.string().nonempty(),
  admin: z.boolean(),
});

type GetApiResponse = z.infer<typeof GetApiResponseSchema>;

export default async function runImport(prisma: PrismaClient) {
  logger.info("Starting import...");
  lockfile.acquire();

  const url = new URL(env.API_URL);
  url.pathname = "/api/catraca";

  let data: GetApiResponse[];

  try {
    data = await ky
      .get(url.toString(), {
        headers: {
          Token: env.API_TOKEN,
        },
      })
      .json();
  } catch (error) {
    logger.error("There was an error while trying to fetch the API");
    lockfile.release();
    return;
  }

  const validUsers = [];

  for (const item of data) {
    const result = GetApiResponseSchema.safeParse(item);
    if (result.success) {
      validUsers.push(result.data);
    } else {
      logger.warn(
        {
          aluno_id: item?.aluno_id,
          reason: result.error.issues.map((e) => e.message).join("; "),
        },
        "Invalid user entry skipped during import",
      );
    }
  }

  if (validUsers.length === 0) {
    logger.warn("All user entries were invalid — nothing to import.");
    lockfile.release();
    return;
  }

  for (const user of validUsers) {
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

    if (!user.liberado && !user.admin) continue;

    for (const [start, weekDayList] of user.horarios) {
      for (const weekDay of weekDayList) {
        await prisma.class.create({
          data: {
            start,
            weekDay,
            tag_user_id: tag.user_id,
          },
        });
      }
    }
  }

  logger.info("Finished importing!");
  lockfile.release();

  logger.info("Started sending access data...");

  const waitingAccesses: Access[] = await prisma.access.findMany({
    where: {
      status: Status.waiting,
    },
  });

  if (!waitingAccesses.length) return logger.info("No access data to be sent.");

  const requestBody: PostRequestBody = waitingAccesses.map(
    ({ timestamp, id, tag_user_id }) => ({
      acesso: timestamp.getTime() - 1000 * 60 * 60 * 3,
      aluno: tag_user_id,
      id_acesso: id,
    }),
  );

  try {
    data = await ky
      .post(url.toString(), {
        headers: {
          Token: env.API_TOKEN,
          "Content-Type": "application/json",
        },
        json: requestBody,
      })
      .json();
  } catch (error) {
    logger.error("There was an error while trying to fetch the API");
    logger.error(error);
    return;
  }

  const parsed = PostApiResponseSchema.safeParse(data);

  if (!parsed.success) {
    logger.error("There was an error in the POST response.");
    return;
  }

  for (const response of parsed.data) {
    await prisma.access.update({
      where: {
        id: response.acesso,
      },
      data: {
        status: response.status ? Status.granted : Status.revoked,
      },
    });
  }

  logger.info("Finished sending access data!");
}
