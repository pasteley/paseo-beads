// No npm dependency here on purpose: `paseo plugin add` installs plugins by `git clone` +
// `git checkout` only (packages/server/src/server/plugins/managed-source.ts) — it never runs
// `npm install`, so any real npm package (date-fns included) would be missing at runtime for
// every git-installed user. Hand-rolled, matching date-fns's own `formatDistanceToNowStrict`
// phrasing ("2 hours ago", "5 days ago", "2 months ago").
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function formatRelativeDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;

  const elapsedMs = Date.now() - date.getTime();
  if (elapsedMs < MINUTE) return "just now";
  if (elapsedMs < HOUR) return pluralUnit(Math.floor(elapsedMs / MINUTE), "minute");
  if (elapsedMs < DAY) return pluralUnit(Math.floor(elapsedMs / HOUR), "hour");
  if (elapsedMs < 30 * DAY) return pluralUnit(Math.floor(elapsedMs / DAY), "day");
  if (elapsedMs < 365 * DAY) return pluralUnit(Math.floor(elapsedMs / (30 * DAY)), "month");
  return pluralUnit(Math.floor(elapsedMs / (365 * DAY)), "year");
}

function pluralUnit(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"} ago`;
}
