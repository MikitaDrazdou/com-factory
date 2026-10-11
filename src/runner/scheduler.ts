import { platformConfig, getSetting, setSetting } from '../lib/settings.ts';
import { localParts, gate } from '../lib/limits.ts';
import { get } from '../lib/db.ts';
import { log } from '../lib/log.ts';

let busy = false;
export const isBusy = () => busy;

async function guarded(name: string, fn: () => Promise<unknown>): Promise<boolean> {
  if (busy) return false;
  busy = true;
  try { const r = await fn(); log('scheduler', `${name}: ${typeof r === 'string' ? r : JSON.stringify(r)}`); }
  catch (e: any) { log('scheduler', `${name} failed: ${e.message}`); }
  finally { busy = false; }
  return true;
}

export function inActiveHours(platform: string): boolean {
  const cfg = platformConfig(platform);
  const { hour } = localParts(cfg.active_hours.tz);
  return hour >= cfg.active_hours.start && hour < cfg.active_hours.end;
}

const fmt = (t: number) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
function slotTimes(platform: string): number[] {
  return platformConfig(platform).schedule_times.map((t) => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); }).filter((t) => !Number.isNaN(t)).sort((a, b) => a - b);
}

/** Next planned run for the panel ("через 7 мин", "сегодня в 19:00"). */
export function nextRunInfo(platform: string): string {
  const cfg = platformConfig(platform);
  if (!cfg.enabled) return 'выключено';
  if (cfg.run_every_minutes > 0) {
    if (!inActiveHours(platform)) return `вне активных часов (${cfg.active_hours.start}:00–${cfg.active_hours.end}:00)`;
    const last = getSetting<number>(`${platform}:last_tick`, 0);
    const mins = Math.max(0, Math.round((last + cfg.run_every_minutes * 60_000 - Date.now()) / 60_000));
    return mins <= 0 ? 'сейчас' : `через ${mins} мин`;
  }
  const times = slotTimes(platform);
  if (!times.length) return 'расписание не задано';
  const { hour, minute } = localParts(cfg.active_hours.tz);
  const now = hour * 60 + minute;
  const next = times.find((t) => t > now);
  return next !== undefined ? `сегодня в ${fmt(next)}` : `завтра в ${fmt(times[0])}`;
}

/** A schedule slot is due when local time passed it within the last 40 minutes and it has not run today. */
function dueSlot(platform: string): string | undefined {
  const cfg = platformConfig(platform);
  const { hour, minute, date } = localParts(cfg.active_hours.tz);
  const now = hour * 60 + minute;
  for (const t of slotTimes(platform)) {
    if (now < t || now - t > 40) continue;
    const key = `${date} ${fmt(t)}`;
    if (getSetting<string>(`${platform}:last_slot`, '') === key) continue;
    return key;
  }
  return undefined;
}

async function tickX(now: number) {
  const x = platformConfig('x');
  if (!x.enabled) return;
  const xr = await import('./x.ts');
  const last = getSetting<number>('x:last_tick', 0);
  if (inActiveHours('x') && x.run_every_minutes > 0 && now - last >= x.run_every_minutes * 60_000) {
    setSetting('x:last_tick', now);
    await guarded('x tick', () => xr.tick());
  } else if (x.mode !== 'dry' && inActiveHours('x')) {
    const approved = get(`SELECT COUNT(*) n FROM drafts WHERE platform = 'x' AND status = 'approved'`)?.n ?? 0;
    if (approved && gate('x').ok) await guarded('x post', () => xr.post({ max: 1 }));
  }
  const lastStats = getSetting<number>('x:last_stats', 0);
  if (x.stats_every_minutes > 0 && now - lastStats >= x.stats_every_minutes * 60_000) {
    setSetting('x:last_stats', now);
    await guarded('x stats', () => xr.stats());
  }
  const lastIn = getSetting<number>('x:last_inbound', 0);
  if (now - lastIn >= 60 * 60_000) {
    setSetting('x:last_inbound', now);
    await guarded('x inbound', () => xr.inbound());
  }
}

async function tickThreads(now: number) {
  const t = platformConfig('threads');
  if (!t.enabled || !t.handle) return;
  const tr = await import('./threads.ts');
  const slot = dueSlot('threads');
  const lastTick = getSetting<number>('threads:last_tick', 0);
  if (slot) {
    setSetting('threads:last_slot', slot);
    setSetting('threads:last_tick', now);
    await guarded(`threads run ${slot}`, () => tr.runOnce());
  } else if (t.run_every_minutes > 0 && inActiveHours('threads') && now - lastTick >= t.run_every_minutes * 60_000) {
    setSetting('threads:last_tick', now);
    await guarded('threads run', () => tr.runOnce());
  } else if (t.mode !== 'dry' && inActiveHours('threads')) {
    // Drafts approved in the queue go out between runs.
    const approved = get(`SELECT COUNT(*) n FROM drafts WHERE platform = 'threads' AND status = 'approved'`)?.n ?? 0;
    if (approved && gate('threads').ok) await guarded('threads post', () => tr.post({ max: 1 }));
  }
  const lastImport = getSetting<number>('threads:last_import', 0);
  if (t.memory_import_path && now - lastImport >= 60 * 60_000) {
    setSetting('threads:last_import', now);
    try { const { importMemory } = await import('./threads-import.ts'); const r = importMemory(t.memory_import_path); if (r.imported) log('threads', `imported ${r.imported} from routine memory`); }
    catch (e: any) { log('threads', `memory import failed: ${e.message}`); }
  }
  const lastStats = getSetting<number>('threads:last_stats', 0);
  if (t.stats_every_minutes > 0 && now - lastStats >= t.stats_every_minutes * 60_000 && inActiveHours('threads')) {
    setSetting('threads:last_stats', now);
    await guarded('threads stats', () => tr.stats());
  }
}

/** One scheduler pass. */
export async function tickOnce() {
  const now = Date.now();
  await tickX(now);
  await tickThreads(now);
  const lastDoctor = getSetting<number>('doctor:at', 0);
  if (now - lastDoctor >= 6 * 3600_000 && !busy) {
    setSetting('doctor:at', now);
    const { doctor } = await import('./doctor.ts');
    await guarded('doctor', () => doctor());
  }
}

export function startScheduler() {
  log('scheduler', 'started (60s tick)');
  setTimeout(() => { tickOnce().catch((e) => log('scheduler', 'tick error', e.message)); }, 5_000);
  setInterval(() => { tickOnce().catch((e) => log('scheduler', 'tick error', e.message)); }, 60_000);
}
