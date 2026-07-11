import { RedisContainer } from '@testcontainers/redis';

let container: Awaited<ReturnType<RedisContainer['start']>> | undefined;

export default async function globalSetup() {
  container = await new RedisContainer('redis:7-alpine').start();
  const url = container.getConnectionUrl();

  process.env['TEST_REDIS_URL'] = url;
  process.env['REDIS_URL'] = url;

  return async () => {
    await container?.stop();
    container = undefined;
  };
}
