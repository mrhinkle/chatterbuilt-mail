export type WakeKind = "Snooze" | "Remind";

export interface WakeLabel {
  kind: WakeKind;
  date: string;
}

/**
 * Same names the page writes. Template `labelPrefix` line 1009, snooze line 4788
 * (`LP()+"/Snooze/"+date`), remind line 4796 (`LP()+"/Remind/"+date`).
 * `wakeDue` line 4819 matches `^<prefix>/(Snooze|Remind)/YYYY-MM-DD`.
 */
export function parseWakeLabel(name: string, prefix: string): WakeLabel | null {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^${escaped}/(Snooze|Remind)/(\\d{4}-\\d{2}-\\d{2})$`).exec(name);
  if (!match || (match[1] !== "Snooze" && match[1] !== "Remind") || !match[2]) return null;
  return { kind: match[1], date: match[2] };
}

/** Template line 4822: `label:` plus the name, `/` and spaces to `-`, lowercased. */
export function labelQuery(name: string): string {
  return `label:${name.replace(/[/ ]/g, "-").toLowerCase()}`;
}

/** Wake a label dated today once the owner's morning starts. Earlier dates are already due. */
export const WAKE_AT_MINUTES = 6 * 60;

export function labelIsDue(labelDate: string, now: Date, timeZone: string): boolean {
  const zoned = zonedParts(now, timeZone);
  if (labelDate < zoned.date) return true;
  if (labelDate > zoned.date) return false;
  return zoned.minutes >= WAKE_AT_MINUTES;
}

function zonedParts(now: Date, timeZone: string): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  let hour = Number(pick("hour"));
  if (hour === 24) hour = 0;
  const minute = Number(pick("minute"));
  const month = pick("month").padStart(2, "0");
  const day = pick("day").padStart(2, "0");
  return { date: `${pick("year")}-${month}-${day}`, minutes: hour * 60 + minute };
}
