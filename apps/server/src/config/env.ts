import { z } from 'zod';
import path from 'path';
import { fileURLToPath } from 'url';

if (process.env['NODE_ENV'] !== 'production') {
  const dotenv = await import('dotenv');
  const configDir = path.dirname(fileURLToPath(import.meta.url));
  dotenv.config({ path: path.resolve(configDir, '../../../../.env') });
}

const schema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  REDIS_URL: z.string().default('redis://localhost:6379'),

  TEMP_DIR: z.string().default('/tmp/ffmpeg-rest'),
  MAX_FILE_SIZE: z.coerce.number().default(100 * 1024 * 1024),
  CONVERT_MAX_TOTAL_SIZE: z.coerce.number().default(500 * 1024 * 1024),

  STORAGE_MODE: z.enum(['stateless', 's3']).default('stateless'),
  CACHE_ENABLED: z.stringbool().default(false),
  CACHE_DIR: z.string().optional(),
  CACHE_TTL_HOURS: z.coerce.number().int().positive().default(2160),
  CACHE_MAX_SIZE_MB: z.coerce.number().int().positive().default(1024),

  AUTH_TOKEN: z.string().optional()
});

const parsedEnv = schema.parse(process.env);

export const env = {
  ...parsedEnv,
  CACHE_DIR: parsedEnv.CACHE_DIR ?? path.join(parsedEnv.TEMP_DIR, 'cache')
};
