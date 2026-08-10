import { DateTime, IANAZone } from "luxon";

// This dashcam is configured to a fixed UTC+2 clock and does not adjust for DST.
// IANA Etc/GMT signs are intentionally reversed: Etc/GMT-2 means UTC+2.
export const DEFAULT_DASHCAM_TIME_ZONE = "Etc/GMT-2";

export function getDashcamTimeZone(): string {
  const configured = process.env.DASHCAM_TIME_ZONE?.trim();
  if (!configured) return DEFAULT_DASHCAM_TIME_ZONE;
  if (!IANAZone.isValidZone(configured)) {
    throw new Error(
      `DASHCAM_TIME_ZONE must be a valid IANA time zone, received: ${configured}`,
    );
  }
  return configured;
}

export function parseDashcamFilenameTimeIso(
  parsed: { date?: string; time?: string },
  timeZone: string,
): string | undefined {
  if (!parsed.date || !parsed.time) return undefined;
  if (!/^\d{8}$/.test(parsed.date) || !/^\d{6}/.test(parsed.time)) {
    return undefined;
  }

  const value = DateTime.fromObject(
    {
      year: Number(parsed.date.slice(0, 4)),
      month: Number(parsed.date.slice(4, 6)),
      day: Number(parsed.date.slice(6, 8)),
      hour: Number(parsed.time.slice(0, 2)),
      minute: Number(parsed.time.slice(2, 4)),
      second: Number(parsed.time.slice(4, 6)),
    },
    { zone: timeZone },
  );

  if (!value.isValid) return undefined;
  return value.toUTC().toISO({ suppressMilliseconds: true }) || undefined;
}
