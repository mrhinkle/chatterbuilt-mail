import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig, type Config } from "../config.js";
import { completeSample } from "./sample.js";

const KEY = randomBytes(32).toString("base64");
const ANTHROPIC = "claude-haiku-5-5";
const OPENROUTER = "anthropic/claude-haiku-5.5";

interface Seen {
  path: string;
  model: string;
  authorization: string;
}

const open: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  while (open.length > 0) {
    const item = open.pop();
    if (item) await item.close();
  }
});

function config(extra: Record<string, string | undefined>): Config {
  return loadConfig({
    OWNER_TOKEN: "owner-token-at-least-32-characters",
    ENCRYPTION_KEY: KEY,
    NODE_ENV: "test",
    ...extra,
  });
}

function endpoint(): Promise<{ url: string; seen: Seen[] }> {
  const seen: Seen[] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { model?: string };
      const authorization = req.headers.authorization ?? req.headers["x-api-key"] ?? "";
      seen.push({
        path: req.url ?? "",
        model: typeof body.model === "string" ? body.model : "",
        authorization: Array.isArray(authorization) ? authorization[0] ?? "" : authorization,
      });
      const openrouter = (req.url ?? "").includes("/chat/completions");
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(openrouter
        ? { choices: [{ message: { content: "from openrouter" } }] }
        : { content: [{ type: "text", text: "from anthropic" }] }));
    });
  });
  open.push({
    close: () => new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    }),
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({ url: `http://127.0.0.1:${port}`, seen });
    });
  });
}

describe("completeSample model id", () => {
  it("sends the provider default to each fake endpoint", async () => {
    const fake = await endpoint();
    const anthropic = await completeSample(config({
      ANTHROPIC_API_KEY: "sk-ant-test-key",
      ANTHROPIC_API_BASE: fake.url,
    }), "summarize");
    const openrouter = await completeSample(config({
      OPENROUTER_API_KEY: "sk-or-test-key",
      OPENROUTER_API_BASE: fake.url,
    }), "summarize");
    expect(anthropic).toBe("from anthropic");
    expect(openrouter).toBe("from openrouter");
    expect(fake.seen).toEqual([
      { path: "/v1/messages", model: ANTHROPIC, authorization: "sk-ant-test-key" },
      { path: "/api/v1/chat/completions", model: OPENROUTER, authorization: "Bearer sk-or-test-key" },
    ]);
  });

  it("sends SAMPLE_MODEL to whichever provider is configured", async () => {
    const fake = await endpoint();
    const chosen = "anthropic/claude-haiku-5.5";
    await completeSample(config({
      ANTHROPIC_API_KEY: "sk-ant-test-key",
      ANTHROPIC_API_BASE: fake.url,
      SAMPLE_MODEL: chosen,
    }), "summarize");
    await completeSample(config({
      OPENROUTER_API_KEY: "sk-or-test-key",
      OPENROUTER_API_BASE: fake.url,
      SAMPLE_MODEL: ` ${chosen} `,
    }), "summarize");
    expect(fake.seen.map((hit) => hit.model)).toEqual([chosen, chosen]);
    expect(fake.seen.map((hit) => hit.path)).toEqual(["/v1/messages", "/api/v1/chat/completions"]);
  });
});
