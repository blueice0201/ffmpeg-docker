import { serve } from '@hono/node-server';
import { createApp } from '~/app';
import { env } from '~/config/env';
import { checkRedisHealth } from '~/config/redis';
import { logger } from '~/config/logger';
import { initCacheDir } from '~/utils/cache';

await checkRedisHealth();

if (env.CACHE_ENABLED) {
  await initCacheDir();
}

const app = createApp();

serve(
  {
    fetch: app.fetch,
    port: env.PORT
  },
  (info) => {
    logger.info('🚀 FFmpeg REST API started');
    logger.info({ port: info.port, storageMode: env.STORAGE_MODE }, 'Server info');
    if (env.CACHE_ENABLED) {
      logger.info(
        {
          cacheDir: env.CACHE_DIR,
          cacheTtlHours: env.CACHE_TTL_HOURS,
          cacheMaxSizeMb: env.CACHE_MAX_SIZE_MB
        },
        'Stateless binary cache enabled'
      );
    }
    logger.info(`📚 OpenAPI Spec: http://localhost:${info.port}/doc`);
    logger.info(`📖 API Reference: http://localhost:${info.port}/reference`);
    logger.info(`🧩 Compose Manifest: http://localhost:${info.port}/doc/compose-manifest`);
    logger.info(`🤖 LLM Documentation: http://localhost:${info.port}/llms.txt`);
  }
);
