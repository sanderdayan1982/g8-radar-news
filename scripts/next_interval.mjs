// Seconds until the next sync: 60 s within ±15 min of a High-impact event, otherwise 300 s.
import { readFileSync } from 'node:fs';
export function nextInterval(calendar = [], now = Date.now()) {
  const near = calendar.some((e) => e?.impact === 'High' && Math.abs(Date.parse(e.event_at) - now) <= 15 * 60_000);
  return near ? 60 : 300;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  let calendar = [];
  try { calendar = JSON.parse(readFileSync(new URL('../public/data/radar_news_full.json', import.meta.url), 'utf8')).calendar || []; } catch { /* default cadence */ }
  process.stdout.write(String(nextInterval(calendar)));
}
