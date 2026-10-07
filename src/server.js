import { loadConfig } from './config.js';
import { connectDatabase } from './database.js';
import { AtlasSessionStore } from './atlas-session-store.js';
import { createApp } from './app.js';

async function start() {
  const config = loadConfig();
  const db = await connectDatabase(config);
  const store = new AtlasSessionStore(db.readDb, db.writeDb);
  const app = createApp({ config, books: db.books, store, health: db.health });
  const server = app.listen(config.port, '0.0.0.0', () => console.log(`Listening on port ${config.port}`));
  const shutdown = () => {
    const timer = setTimeout(() => process.exit(1), 10000);
    timer.unref();
    server.close(async () => {
      await db.close(); clearTimeout(timer); process.exit(0);
    });
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}
start().catch(error => {
  // Startup errors here are sanitized configuration/connection messages.
  console.error(error.message);
  process.exit(1);
});
