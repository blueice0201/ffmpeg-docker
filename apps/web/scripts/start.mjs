process.env.PORT ??= '3001';
process.env.BACKEND_URL ??= 'http://127.0.0.1:3000';

await import('../.output/server/index.mjs');
