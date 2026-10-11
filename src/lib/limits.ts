import { get, all, run } from './db.ts';
import { platformConfig } from './settings.ts';

export function localParts(tz: string, d = new Date()): { hour: number; minute: number; date: string; weekday: number } {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' });
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(d)) p[x.type] = x.value;
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  return { hour: Number(p.hour) % 24, minute: Number(p.minute), date: `${p.year}-${p.month}-${p.day}`, weekday: wd };
}

/** Start of the local day in the platform timezone, as an ISO UTC string usable against datetime('now') columns. */
export function localDayStartUtc(tz: string): string {
  const { date } = localParts(tz);
  const probe = new Date(date + 'T00:00:00Z');
  for (let off = -14; off <= 14; off++) {
    const d = new Date(probe.getTime() - off * 3600_000);
    const lp = localParts(tz, d);
    if (lp.date === date && lp.hour === 0 && lp.minute === 0) return d.toISOString().slice(0, 19).replace('T', ' ');
  }
  return probe.toISOString().slice(0, 19).replace('T', ' ');
}

export function block(platform: string, hours: number, reason: string) {
  const until = new Date(Date.now() + hours * 3600_000).toISOString().slice(0, 19).replace('T', ' ');
  run('INSERT INTO blocks(platform, until, reason) VALUES(?, ?, ?) ON CONFLICT(platform) DO UPDATE SET until = excluded.until, reason = excluded.reason', platform, until, reason);
}
export function activeBlock(platform: string): { until: string; reason: string } | undefined {
  const b = get("SELECT until, reason FROM blocks WHERE platform = ? AND until > datetime('now')", platform);
  return b as any;
}
export function unblock(platform: string) { run('DELETE FROM blocks WHERE platform = ?', platform); }

/** Comments today: our own (source = runner) or everything on the account including imported history. */
export function postedToday(platform: string, scope: 'own' | 'all' = 'own'): number {
  const cfg = platformConfig(platform);
  const r = get(`SELECT COUNT(*) AS n FROM comments WHERE platform = ? AND posted_at >= ? ${scope === 'own' ? "AND source = 'runner'" : ''}`, platform, localDayStartUtc(cfg.active_hours.tz));
  return r?.n ?? 0;
}
export function lastPostedAt(platform: string): string | undefined {
  return get("SELECT MAX(posted_at) AS t FROM comments WHERE platform = ? AND source = 'runner'", platform)?.t ?? undefined;
}

export interface Gate { ok: boolean; reason: string; remainingToday: number }

/** Can we post one more comment on this platform right now? `ignoreHours` is for a manual CLI run (`x:post --now`): limits, pauses and gaps still apply. */
export function gate(platform: string, opts: { ignoreHours?: boolean } = {}): Gate {
  const cfg = platformConfig(platform);
  const remaining = Math.max(0, cfg.daily_limit - postedToday(platform, 'own'));
  if (!cfg.enabled) return { ok: false, reason: 'platform disabled', remainingToday: remaining };
  const b = activeBlock(platform);
  if (b) return { ok: false, reason: `blocked until ${b.until} UTC: ${b.reason}`, remainingToday: remaining };
  const { hour } = localParts(cfg.active_hours.tz);
  if (!opts.ignoreHours && (hour < cfg.active_hours.start || hour >= cfg.active_hours.end)) return { ok: false, reason: `outside active hours (${cfg.active_hours.start}-${cfg.active_hours.end} ${cfg.active_hours.tz})`, remainingToday: remaining };
  if (remaining <= 0) return { ok: false, reason: `daily limit ${cfg.daily_limit} reached`, remainingToday: 0 };
  if (cfg.account_daily_cap > 0 && postedToday(platform, 'all') >= cfg.account_daily_cap) return { ok: false, reason: `account cap ${cfg.account_daily_cap}/day reached (incl. other tools)`, remainingToday: remaining };
  const last = lastPostedAt(platform);
  if (last) {
    const mins = (Date.now() - new Date(last.replace(' ', 'T') + 'Z').getTime()) / 60_000;
    if (mins < cfg.min_gap_minutes) return { ok: false, reason: `min gap ${cfg.min_gap_minutes} min (last ${Math.round(mins)} min ago)`, remainingToday: remaining };
  }
  return { ok: true, reason: '', remainingToday: remaining };
}

/** Stop-list or recently commented author (any source, so an Aside routine and com-factory never double up). */
export function authorBlocked(platform: string, author: string): string {
  const a = author.toLowerCase().replace(/^@/, '');
  if (get('SELECT 1 FROM stop_authors WHERE platform = ? AND lower(author) = ?', platform, a)) return 'stop-list';
  const cfg = platformConfig(platform);
  const recent = get(`SELECT posted_at FROM comments WHERE platform = ? AND lower(author) = ? AND posted_at >= datetime('now', ?)`, platform, a, `-${cfg.author_cooldown_days} days`);
  if (recent) return `author cooldown (${cfg.author_cooldown_days}d, last ${recent.posted_at})`;
  return '';
}
/** Already commented under this post (by any tool)? */
export function postCommented(platform: string, postKey: string): boolean {
  if (!postKey) return false;
  return !!get('SELECT 1 FROM comments WHERE platform = ? AND (post_id = ? OR post_url LIKE ?)', platform, postKey, `%${postKey}%`);
}

/** Share of product mentions / links over our last N comments; keeps the account from sounding salesy. */
/** Share of product mentions in the last N own comments. Divided by the window, not by the count: one early mention must not block the next seven. */
export function mentionShare(platform: string, lastN = 8): number {
  const rows = all("SELECT product_mentioned FROM comments WHERE platform = ? AND source = 'runner' ORDER BY posted_at DESC LIMIT ?", platform, lastN);
  return rows.filter((r) => r.product_mentioned).length / lastN;
}
export function linkShare(platform: string, lastN = 8): number {
  const rows = all("SELECT link_included FROM comments WHERE platform = ? AND source = 'runner' ORDER BY posted_at DESC LIMIT ?", platform, lastN);
  return rows.filter((r) => r.link_included).length / lastN;
}
