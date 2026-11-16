import type { Config } from "../config.js";

const SAMPLE_TIMEOUT_MS = 20_000;
const SAMPLE_MAX_TOKENS = 1024;
const ANTHROPIC_MODEL = "claude-haiku-5-5";
const OPENROUTER_MODEL = "anthropic/claude-haiku-5.5";

function modelId(config: Config, fallback: string): string {
  return config.sampleModel ?? fallback;
}

export class SampleError extends Error {
  readonly code = "upstream_error";

  constructor() {
    super("The model did not answer.");
    this.name = "SampleError";
  }
}

/**
 * One model call with the owner's key. The key is a header, never a log field.
 * Redirects are refused so the key cannot follow to another host.
 * Returns null when no key is configured.
 */
export async function completeSample(config: Config, prompt: string): Promise<string | null> {
  if (config.anthropicApiKey) return anthropic(config, config.anthropicApiBase, config.anthropicApiKey, prompt);
  if (config.openrouterApiKey) return openrouter(config, config.openrouterApiBase, config.openrouterApiKey, prompt);
  return null;
}

async function anthropic(config: Config, base: string, key: string, prompt: string): Promise<string> {
  const response = await post(`${base}/v1/messages`, {
    "content-type": "application/json",
    "x-api-key": key,
    "anthropic-version": "2023-06-01",
  }, {
    model: modelId(config, ANTHROPIC_MODEL),
    max_tokens: SAMPLE_MAX_TOKENS,
    messages: [{ role: "user", content: prompt }],
  });
  const content = response.content;
  if (!Array.isArray(content)) throw new SampleError();
  const text = content
    .map((part) => (part && typeof part === "object" && "text" in part && typeof part.text === "string" ? part.text : ""))
    .join("")
    .trim();
  if (!text) throw new SampleError();
  return text;
}

async function openrouter(config: Config, base: string, key: string, prompt: string): Promise<string> {
  const response = await post(`${base}/api/v1/chat/completions`, {
    "content-type": "application/json",
    authorization: `Bearer ${key}`,
  }, {
    model: modelId(config, OPENROUTER_MODEL),
    max_tokens: SAMPLE_MAX_TOKENS,
    messages: [{ role: "user", content: prompt }],
  });
  const choices = response.choices;
  const first = Array.isArray(choices) ? choices[0] : undefined;
  const message = first && typeof first === "object" && "message" in first ? first.message : undefined;
  const content = message && typeof message === "object" && "content" in message ? message.content : undefined;
  if (typeof content !== "string" || !content.trim()) throw new SampleError();
  return content.trim();
}

async function post(url: string, headers: Record<string, string>, body: unknown): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(SAMPLE_TIMEOUT_MS),
    });
  } catch {
    throw new SampleError();
  }
  if (!response.ok) throw new SampleError();
  try {
    const parsed: unknown = await response.json();
    if (!parsed || typeof parsed !== "object") throw new SampleError();
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof SampleError) throw error;
    throw new SampleError();
  }
}
