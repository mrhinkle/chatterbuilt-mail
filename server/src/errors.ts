export type ErrorCode = "tool_error" | "rate_limited" | "needs_reauth" | "upstream_error";

export class ToolError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;

  constructor(code: ErrorCode, message: string, retryable = false) {
    super(message);
    this.name = "ToolError";
    this.code = code;
    this.retryable = retryable;
  }
}

/** The page treats a message that contains both of these, and none of the ignore words, as gone mail. */
export function notFound(): ToolError {
  return new ToolError("tool_error", "404 Requested entity was not found.");
}
