import type { VideoPair } from "../api";

export const RECORDING_DISPLAY_TIME_ZONE = "Europe/Berlin";

const dateTimeFormatter = new Intl.DateTimeFormat("sv-SE", {
  timeZone: RECORDING_DISPLAY_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

const dateFormatter = new Intl.DateTimeFormat("sv-SE", {
  timeZone: RECORDING_DISPLAY_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Parse the fixed UTC+2 clock encoded in a Viofo pair ID. */
export function parsePairIdTime(id: string): number | null {
  const match = /^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/.exec(id);
  if (!match) return null;

  const [, year, month, day, hour, minute, second] = match;
  const timestamp =
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
    ) -
    2 * 60 * 60 * 1000;

  return Number.isFinite(timestamp) ? timestamp : null;
}

export function getPairStartTime(
  pair: Pick<VideoPair, "id" | "startTime">,
): number | null {
  if (pair.startTime) {
    const timestamp = Date.parse(pair.startTime);
    if (Number.isFinite(timestamp)) return timestamp;
  }
  return parsePairIdTime(pair.id);
}

export function formatRecordingTime(value: string | number | Date): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? dateTimeFormatter.format(date)
    : String(value);
}

export function formatPairTime(
  pair: Pick<VideoPair, "id" | "startTime">,
): string {
  const timestamp = getPairStartTime(pair);
  return timestamp === null ? pair.id : formatRecordingTime(timestamp);
}

export function getPairDisplayDate(
  pair: Pick<VideoPair, "id" | "startTime">,
): string | null {
  const timestamp = getPairStartTime(pair);
  return timestamp === null ? null : dateFormatter.format(timestamp);
}
