import type { IncomingMessage, ServerResponse } from "node:http";
import { rememberStart } from "../../src/http/start-once.js";
import { buildRuntime } from "../../src/http/app.js";

const runtime = rememberStart(() => buildRuntime());

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const app = await runtime();
  await app.handle(req, res);
}
