import dotenv from 'dotenv'

import { z } from 'zod' // validação de env vars
import pino from 'pino'
dotenv.config() // logger estruturado

// ------------------------- Environment Validation ------------------------
const envSchema = z.object({
  TURNSTILE_IP: z.ipv4().nonoptional(),
  TURNSTILE_PORT: z.coerce.number().nonnegative().nonoptional(),
  DELAY_TOLERANCE: z.coerce.number().nonnegative().nonoptional(),
  TIMEZONE: z.string().nonempty(),
  LOG_LEVEL: z.string().optional().default('info'),
  API_URL: z.url(),
  API_TOKEN: z.string().nonempty(),
  CRON_PARAMETERS: z.string().nonempty(),
  ADMIN_TOKEN: z.string().nonempty(),
})

const _env = envSchema.safeParse(process.env)

if (!_env.success)
  throw new Error('Invalid environment variables: ' + _env.error)

// ------------------------- Logger ---------------------------------------
export const logger = pino({ level: _env.data.LOG_LEVEL })

export default _env.data
