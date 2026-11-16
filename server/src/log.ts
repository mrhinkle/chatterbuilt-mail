const SECRET_KEY = /token|passphrase|authorization|ciphertext|body|raw|html|plaintext|secret|key|password|signature/i;

export type LogSink = (line: string) => void;

/** Production sink. Lines are already redacted by Logger.info. */
export function stdoutSink(line: string): void {
  process.stdout.write(`${line}\n`);
}

/**
 * Every app log goes through here. Fields whose names look like secrets or mail
 * are dropped. Registered secret strings are stripped from the line.
 */
export class Logger {
  private secrets: string[] = [];
  private sink: LogSink;

  constructor(sink: LogSink = () => {}) {
    this.sink = sink;
  }

  setSink(sink: LogSink): void {
    this.sink = sink;
  }

  redact(value: string): void {
    if (value.length > 0) this.secrets.push(value);
  }

  info(msg: string, fields?: Record<string, unknown>): void {
    const safe: Record<string, unknown> = {};
    if (fields) {
      for (const [key, value] of Object.entries(fields)) {
        if (SECRET_KEY.test(key)) continue;
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) {
          safe[key] = value;
        }
      }
    }
    let line = JSON.stringify({ msg, ...safe });
    for (const secret of this.secrets) {
      if (secret.length < 4) continue;
      line = line.split(secret).join("[redacted]");
    }
    this.sink(line);
  }
}
