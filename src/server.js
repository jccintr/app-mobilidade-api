import { assertEnv, env } from './config/env.js';
import { connectDb, disconnectDb } from './config/db.js';
import { createApp } from './app.js';
import { createServer } from 'node:http';
import { initRealtime } from './realtime/socket.js';
import { clearDispatchTimers, startDispatchSweeper } from './rides/dispatch.js';

async function main() {
  assertEnv();
  await connectDb();
  console.log('MongoDB conectado.');

  const app = createApp();
  const server = createServer(app);
  initRealtime(server);
  const stopSweeper = startDispatchSweeper();
  server.listen(env.port, () => {
    console.log(`${env.platformName} — API em http://localhost:${env.port} (${env.nodeEnv})`);
  });

  const shutdown = async (signal) => {
    console.log(`${signal} recebido, encerrando...`);
    stopSweeper();
    clearDispatchTimers();
    server.close(async () => {
      await disconnectDb();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
