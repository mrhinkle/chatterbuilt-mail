import { createServer } from "./http/app.js";

const app = await createServer();

async function shutdown(): Promise<void> {
  await app.close();
  process.exit(0);
}

process.on("SIGTERM", () => {
  void shutdown();
});
process.on("SIGINT", () => {
  void shutdown();
});
