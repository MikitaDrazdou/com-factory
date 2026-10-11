import { env } from '../lib/env.ts';
import { version, ask } from '../lib/aside.ts';
import { decide } from '../lib/openrouter.ts';
import { models, setSetting, getSetting, platformConfig } from '../lib/settings.ts';
import { get } from '../lib/db.ts';
import { listProducts, productHosts } from '../lib/products.ts';

export interface DoctorReport { ok: boolean; at: number; lines: string[]; facts: Record<string, any> }

/** Environment check. Results are cached in settings (doctor:last) for the panel checklist. */
export async function doctor(): Promise<DoctorReport> {
  const lines: string[] = [];
  const facts: Record<string, any> = {};
  let ok = true;
  facts.node = process.versions.node;
  lines.push(`Node ${facts.node}`);
  try { get('SELECT 1'); lines.push('✓ SQLite database ready'); facts.db = true; } catch (e: any) { ok = false; lines.push(`✗ database: ${e.message}`); }
  const v = await version();
  if (/^\d/.test(v)) { lines.push(`✓ Aside CLI ${v}`); facts.aside = v; } else { ok = false; lines.push(`✗ Aside CLI not found (${env.asideBin}): install from https://releases.aside.com/install.sh`); }
  if (facts.aside) {
    if (platformConfig('x').enabled) {
      const { getMe, profileWebsite } = await import('./x.ts');
      const me = await getMe(true).catch(() => undefined);
      if (me?.handle) {
        const hosts = productHosts(listProducts(true, 'x'));
        let bioHasLink = hosts.some((h) => (me.desc + ' ' + (me as any).url).toLowerCase().includes(h));
        if (!bioHasLink && hosts.length) { const site = await profileWebsite(me.handle).catch(() => ''); bioHasLink = hosts.some((h) => site.toLowerCase().includes(h)); }
        facts.x = { ok: true, handle: me.handle, followers: me.followers, bioHasLink, hosts };
        lines.push(`✓ X logged in as @${me.handle} (${me.followers} followers)${hosts.length ? (bioHasLink ? ', bio has the product link' : ', bio has NO product link yet') : ''}`);
      } else { facts.x = { ok: false }; lines.push('✗ X: not logged in in Aside Browser. Open x.com in Aside and sign in.'); }
    }
    const tcfg = platformConfig('threads');
    if (tcfg.enabled && tcfg.handle) {
      const { loginCheck } = await import('./threads.ts');
      const t = await loginCheck();
      facts.threads = { ok: t.ok, handle: tcfg.handle, followers: t.followers ?? null };
      lines.push(t.ok ? `✓ Threads logged in as @${tcfg.handle}${typeof t.followers === 'number' ? ` (${t.followers} followers)` : ''}` : `✗ Threads: ${t.error}. Open threads.com in Aside and sign in.`);
    } else {
      facts.threads = { ok: false, handle: tcfg.handle, checked: false };
      lines.push(tcfg.enabled ? '· Threads: handle not set (Настройки → Threads)' : '· Threads disabled');
    }
  }
  if (!env.openrouterKey) { ok = false; lines.push('✗ OPENROUTER_API_KEY missing in .env'); facts.openrouter = false; }
  else {
    try {
      const t = Date.now();
      const r = await decide(models().jev, { text: 'Which eSIM should I buy for Portugal?' }, { q: { type: 'noul', instructions: 'Is this a question about travel connectivity?' } });
      lines.push(`✓ OpenRouter + Jev (${models().jev}) answered in ${Date.now() - t} ms (noul=${r.answers.q.noul})`);
      facts.openrouter = true;
    } catch (e: any) { ok = false; lines.push(`✗ OpenRouter/Jev: ${e.message}`); facts.openrouter = false; }
  }
  if (facts.aside) {
    const m = models();
    try {
      const t = Date.now();
      const a = await ask('Do not use any tools. Reply with exactly this text and nothing else: {"ok":true}', { provider: m.text_provider, model: m.text_model, effort: 'off', timeoutMs: 90_000 });
      facts.text = /"ok"\s*:\s*true/.test(a);
      lines.push(facts.text ? `✓ Text model via Aside (${m.text_provider}/${m.text_model}) answered in ${Date.now() - t} ms` : `✗ Text model via Aside answered unexpectedly: ${a.slice(0, 120)}`);
      if (!facts.text) ok = false;
    } catch (e: any) { ok = false; facts.text = false; lines.push(`✗ Text model via Aside (${m.text_provider}/${m.text_model}): ${e.message}. Connect the provider in Aside → Settings → Models.`); }
  }
  facts.products = listProducts(true).length;
  lines.push(`Products configured: ${facts.products}; timezone ${env.tz}`);
  const report: DoctorReport = { ok, at: Date.now(), lines, facts };
  setSetting('doctor:last', report);
  return report;
}

export function lastDoctor(): DoctorReport | undefined {
  return getSetting<DoctorReport | undefined>('doctor:last', undefined);
}
