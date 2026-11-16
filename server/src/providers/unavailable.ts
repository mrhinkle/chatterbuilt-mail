import { ToolError } from "../errors.js";

/** Tool calls on an account type this slice does not speak yet. */
export const ACCOUNT_TYPE_UNAVAILABLE = "This account type isn't available yet.";

export function unavailable(): never {
  throw new ToolError("tool_error", ACCOUNT_TYPE_UNAVAILABLE);
}
