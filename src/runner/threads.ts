// Threads runner: works per product, side by side with any Aside routine on the same account.
// Dedupe with the routine: its MEMORY.md is imported into `comments`, and authorBlocked/postCommented look at every source.
import { repl } from '../lib/aside.ts';
import { all, get, run, j } from '../lib/db.ts';
import { platformConfig, getSetting, setSetting } from '../lib/settings.ts';
import { scorePost, classifyInbound } from '../lib/jev.ts';
import { draftThreads, draftThreadsInbound } from '../lib/draft.ts';
import { gate, authorBlocked, block, postCommented } from '../lib/limits.ts';
import { listProducts, getProduct, type Product } from '../lib/products.ts';
import { searchCode, replyCode, likeCode, activityCode, repliesCode, insightsCode } from '../lib/threads-browser.ts';
import { startRun, finishRun } from './x.ts';
import { importMemory } from './threads-import.ts';
import { log } from '../lib/log.ts';

const P = 'threads';
const BASE = 'https://www.threads.com';
const norm = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
const sqlNow = (d = new Date()) => d.toISOString().slice(0, 19).replace('T', ' ');

function handle(): string {
  const h = platformConfig(P).handle;
  if (!h) throw new Error('Threads handle is not set (Настройки → Threads → Ваш ник)');
  return h;
}
function ageMinutes(iso: string | undefined | null): number {
  if (!iso) return 1e9;
  return (Date.now() - new Date(iso).getTime()) / 60_000;
}
function pick(key: string, list: string[], n: number): string[] {
  const qs = list.filter(Boolean);
  if (!qs.length) return [];
  const cursor = getSetting<number>(key, 0) % qs.length;
  const out: string[] = [];
  for (let i = 0; i < Math.min(n, qs.length); i++) out.push(qs[(cursor + i) % qs.length]);
  setSetting(key, (cursor + n) % qs.length);
  return out;
}
/** May we join an intro thread today? Counts intro threads done by any tool (the routine logs them as basket1). */
function selfpromoDue(): boolean {
  const cfg = platformConfig(P);
  if (cfg.selfpromo_every_days <= 0) return false;
  const last = get(`SELECT MAX(posted_at) t FROM comments WHERE platform = ? AND bucket IN ('intro', 'basket1')`, P)?.t;
  if (!last) return true;
  return Date.now() - new Date(String(last).replace(' ', 'T') + 'Z').getTime() >= cfg.selfpromo_every_days * 86400_000;
}
function pathOf(url: string): string {
  try { return new URL(url).pathname; } catch { return url; }
}
function pushbackOf(err: string, raw: string): { reason: string; hours: number } | undefined {
  const s = (err + '\n' + raw.split('\n').filter((l) => !l.includes('@@CF@@')).join('\n')).toLowerCase();
  if (/^login$|not logged in|\/login/.test(s)) return { reason: 'Threads session is not logged in', hours: 24 };
  if (/заблокирован|действие заблокировано|action blocked|captcha|ограничен|restricted|suspend|try again later|попробуйте позже/.test(s)) return { reason: 'Threads restricted the action', hours: 24 };
  return undefined;
}

/** Search Threads for each product's queries, store candidates, score them with Jev. */
export async function discover(opts: { queriesPerProduct?: number } = {}): Promise<{ runId: number; seen: number; added: number; drafts: number; skipped: number }> {
  const cfg = platformConfig(P);
  const runId = startRun(P, 'discover');
  const stats = { seen: 0, added: 0, drafts: 0, skipped: 0, cost: 0 };
  const lines: string[] = [];
  try {
    const h = handle();
    const products = listProducts(true, P);
    if (!products.length) throw new Error('no active product for Threads (Настройки → Продукт → Где использовать)');
    const introDue = selfpromoDue();
    const plan: { q: string; product: Product; intro: boolean }[] = [];
    for (const pr of products) {
      const pool = pr.queries.length ? pr.queries : cfg.queries;
      for (const q of pick(`threads:qc:${pr.id}`, pool, opts.queriesPerProduct ?? 3)) plan.push({ q, product: pr, intro: false });
    }
    if (introDue && cfg.intro_queries.length) plan.push({ q: pick('threads:qc:intro', cfg.intro_queries, 1)[0], product: products[0], intro: true });
    lines.push(`queries: ${plan.map((x) => `${x.q} [${x.product.name}${x.intro ? ', intro' : ''}]`).join(' | ')}`);
    const results: any[] = [];
    for (let i = 0; i < plan.length; i += 4) {
      const chunk = plan.slice(i, i + 4);
      const r = await repl(searchCode(chunk.map((x) => x.q)), { timeoutMs: 170_000 });
      const payload = r.payloads[0];
      if (!payload) { lines.push(`no payload: ${r.raw.slice(-400)}`); continue; }
      if (payload.login) { block(P, 24, 'Threads session is not logged in'); throw new Error('Threads is not logged in'); }
      for (const res of payload.results) { const pl = chunk.find((x) => x.q === res.q); results.push({ ...res, product: pl?.product, intro: !!pl?.intro }); }
    }
    for (const res of results) {
      if (res.error) { lines.push(`query "${res.q}": ${res.error}`); continue; }
      for (const t of res.posts ?? []) {
        stats.seen++;
        if (!t.author || !t.id || t.author.toLowerCase() === h.toLowerCase()) continue;
        if (get('SELECT 1 FROM candidates WHERE platform = ? AND post_id = ?', P, t.id)) continue;
        const age = ageMinutes(t.createdAt);
        let decision = 'new', reason = '';
        if (!t.text) { decision = 'skip'; reason = 'no text'; }
        else if (age > cfg.max_age_minutes) { decision = 'skip'; reason = `too old (${Math.round(age / 60)} h)`; }
        else if (postCommented(P, t.id)) { decision = 'skip'; reason = 'already commented (any tool)'; }
        else { const ab = authorBlocked(P, t.author); if (ab) { decision = 'skip'; reason = ab; } }
        run(`INSERT INTO candidates(platform, post_id, url, author, author_followers, author_verified, text, lang, query, post_created_at, run_id, metrics, decision, reason, product_id)
             VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          P, t.id, BASE + t.href, t.author, 0, 0, t.text, '', res.q, t.createdAt, runId,
          JSON.stringify({ likes: t.likes, replies: t.replies, age_min: Math.round(age), intro: res.intro }), decision, reason, res.product?.id ?? null);
        stats.added++;
        if (decision === 'skip') stats.skipped++;
      }
    }
    const fresh = all(`SELECT * FROM candidates WHERE platform = ? AND decision = 'new' ORDER BY post_created_at DESC LIMIT 80`, P);
    for (const c of fresh) {
      const m = j(c.metrics, {});
      const product = (c.product_id && getProduct(c.product_id)) || products[0];
      try {
        const s = await scorePost(P, cfg, product, { post: c.text, author: c.author, age_minutes: m.age_min, likes: m.likes, replies: m.replies, found_by_query: c.query, found_via_intro_query: !!m.intro });
        stats.cost += s.cost;
        let { decision, reason } = s;
        if (decision === 'draft' && s.kind === 'intro' && !introDue) { decision = 'skip'; reason = 'intro thread, not due yet'; }
        run('UPDATE candidates SET score = ?, decision = ?, reason = ?, lang = ?, kind = ? WHERE id = ?', JSON.stringify(s.answers), decision, reason, s.lang, s.kind, c.id);
        if (decision === 'draft') stats.drafts++; else stats.skipped++;
      } catch (e: any) { lines.push(`score #${c.id}: ${e.message}`); }
    }
    finishRun(runId, 'ok', stats, lines.join('\n'));
    log('threads', 'discover done', stats);
  } catch (e: any) {
    lines.push(`ERROR ${e.message}`);
    finishRun(runId, 'error', stats, lines.join('\n'));
    log('threads', 'discover failed', e.message);
  }
  return { runId, ...stats };
}

/** Write comments for candidates Jev approved. review -> pending; auto -> approved; dry -> dry. */
export async function draft(limit?: number): Promise<{ runId: number; drafted: number; declined: number }> {
  const cfg = platformConfig(P);
  const runId = startRun(P, 'draft');
  const stats = { drafted: 0, declined: 0 };
  const lines: string[] = [];
  try {
    const h = handle();
    const inFlight = get(`SELECT COUNT(*) n FROM drafts WHERE platform = ? AND inbound_id IS NULL AND status IN ('pending','approved','posted') AND created_at >= datetime('now','-1 day')`, P)?.n ?? 0;
    const want = Math.min(limit ?? cfg.per_run_limit, Math.max(0, cfg.daily_limit - inFlight));
    const cands = all(`SELECT c.* FROM candidates c LEFT JOIN drafts d ON d.candidate_id = c.id WHERE c.platform = ? AND c.decision = 'draft' AND d.id IS NULL ORDER BY c.post_created_at DESC LIMIT 12`, P);
    for (const c of cands) {
      if (stats.drafted >= want) break;
      const m = j(c.metrics, {});
      const product = (c.product_id && getProduct(c.product_id)) || listProducts(true, P)[0];
      const lang = c.lang || product?.languages[0] || cfg.languages[0] || 'en';
      try {
        const d = await draftThreads({ ...c, metrics: { likes: m.likes, replies: m.replies } }, lang, h, product, c.kind || 'question');
        if (!d.text) { run('UPDATE candidates SET decision = ?, reason = ? WHERE id = ?', 'skip', `draft: ${d.skip_reason}`, c.id); stats.declined++; continue; }
        const status = cfg.mode === 'auto' ? 'approved' : cfg.mode === 'dry' ? 'dry' : 'pending';
        run('INSERT INTO drafts(candidate_id, platform, text, model, mentions_product, link_included, product_id, status) VALUES(?,?,?,?,?,?,?,?)', c.id, P, d.text, d.model, d.mentions_product ? 1 : 0, d.link_included ? 1 : 0, product?.id ?? null, status);
        run('UPDATE candidates SET decision = ? WHERE id = ?', 'drafted', c.id);
        stats.drafted++;
      } catch (e: any) { lines.push(`draft #${c.id}: ${e.message}`); }
    }
    finishRun(runId, 'ok', stats, lines.join('\n'));
  } catch (e: any) {
    lines.push(`ERROR ${e.message}`);
    finishRun(runId, 'error', stats, lines.join('\n'));
  }
  return { runId, ...stats };
}

/** Post approved drafts (comments and inbound replies), respecting the gate. */
export async function post(opts: { draftId?: number; max?: number } = {}): Promise<{ runId: number; posted: number; reason: string }> {
  const cfg = platformConfig(P);
  const sel = `SELECT d.*, c.url AS c_url, c.author AS c_author, c.post_id AS c_post_id, c.kind AS c_kind, i.post_url AS i_url, i.from_user AS i_user FROM drafts d LEFT JOIN candidates c ON c.id = d.candidate_id LEFT JOIN inbound i ON i.id = d.inbound_id`;
  const drafts = opts.draftId
    ? all(`${sel} WHERE d.id = ? AND d.platform = ? AND d.status IN ('approved','pending')`, opts.draftId, P)
    : all(`${sel} WHERE d.platform = ? AND d.status = 'approved' ORDER BY d.inbound_id IS NULL, d.created_at ASC`, P);
  if (!drafts.length) return { runId: 0, posted: 0, reason: 'nothing approved' };
  const runId = startRun(P, 'post');
  const lines: string[] = [];
  let posted = 0; let reason = '';
  try {
    const h = handle();
    for (const d of drafts) {
      if (posted >= (opts.max ?? 1)) break;
      const g = gate(P);
      if (!g.ok && !(d.inbound_id && g.reason.startsWith('daily limit'))) { reason = g.reason; lines.push(`gate: ${g.reason}`); break; }
      const targetUrl = d.inbound_id ? d.i_url : d.c_url;
      const author = d.inbound_id ? d.i_user : d.c_author;
      if (!targetUrl) { run("UPDATE drafts SET status = 'failed', error = 'no target url' WHERE id = ?", d.id); continue; }
      if (!d.inbound_id) {
        const ab = authorBlocked(P, author);
        if (ab) { run("UPDATE drafts SET status = 'rejected', error = ? WHERE id = ?", ab, d.id); lines.push(`#${d.id} ${ab}`); continue; }
        if (postCommented(P, d.c_post_id)) { run("UPDATE drafts SET status = 'rejected', error = 'already commented' WHERE id = ?", d.id); lines.push(`#${d.id} already commented`); continue; }
      }
      const r = await repl(replyCode({ path: pathOf(targetUrl), text: d.text, like: cfg.like_post && !d.inbound_id, handle: h }), { timeoutMs: 150_000 });
      const res = r.payloads[0];
      if (!res?.ok) {
        const err = String(res?.error ?? (r.raw.split('\n').filter((l) => /error/i.test(l)).slice(-2).join(' | ') || 'no result')).slice(0, 400);
        run("UPDATE drafts SET status = 'failed', error = ? WHERE id = ?", err, d.id);
        lines.push(`#${d.id} failed: ${err}`);
        const push = pushbackOf(err, r.raw);
        if (push) { block(P, push.hours, push.reason); reason = push.reason; break; }
        continue;
      }
      const replyUrl = res.replyHref ? BASE + res.replyHref : '';
      const replyId = res.replyHref ? String(res.replyHref).split('/post/')[1] : `pending:${d.id}`;
      run("UPDATE drafts SET status = 'posted', posted_at = datetime('now'), reply_id = ?, reply_url = ? WHERE id = ?", replyId, replyUrl, d.id);
      run(`INSERT INTO comments(platform, post_id, post_url, reply_id, reply_url, author, text, bucket, product_mentioned, link_included, run_id, product_id, source) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'runner')`,
        P, d.inbound_id ? pathOf(targetUrl).split('/post/')[1] || '' : d.c_post_id, targetUrl, replyId, replyUrl, author, d.text, d.inbound_id ? 'inbound' : d.c_kind === 'intro' ? 'intro' : 'comment', d.mentions_product, d.link_included, runId, d.product_id ?? null);
      if (d.candidate_id) run("UPDATE candidates SET decision = 'posted' WHERE id = ?", d.candidate_id);
      if (d.inbound_id) run('UPDATE inbound SET handled = 1, our_reply = ?, turns = turns + 1 WHERE id = ?', d.text, d.inbound_id);
      posted++;
      lines.push(`#${d.id} posted ${replyUrl || '(url pending, see stats)'}${res.liked ? ' (liked)' : ''}${res.verified ? '' : ' (not verified on reload)'}`);
      log('threads', 'posted', replyUrl || targetUrl);
      if (posted < (opts.max ?? 1)) await new Promise((r) => setTimeout(r, Math.min(cfg.min_gap_minutes, 4) * 60_000 + Math.random() * 20_000));
    }
    finishRun(runId, 'ok', { posted, reason }, lines.join('\n'));
  } catch (e: any) {
    lines.push(`ERROR ${e.message}`);
    finishRun(runId, 'error', { posted }, lines.join('\n'));
    reason = e.message;
  }
  return { runId, posted, reason };
}

/** Activity page -> inbound replies under OUR comments (the routine's threads are stored but left to the routine). Then answer A/B. */
export async function inbound(): Promise<{ runId: number; found: number; ours: number; replied: number; liked: number }> {
  const cfg = platformConfig(P);
  const runId = startRun(P, 'inbound');
  const stats = { found: 0, ours: 0, replied: 0, liked: 0, cost: 0 };
  const lines: string[] = [];
  try {
    const h = handle();
    const r = await repl(activityCode(h), { timeoutMs: 90_000 });
    const payload = r.payloads[0];
    if (!payload) throw new Error(`no payload: ${r.raw.slice(-300)}`);
    if (payload.login) { block(P, 24, 'Threads session is not logged in'); throw new Error('Threads is not logged in'); }
    // Replies under the imported Aside-routine comments are ours to answer as well (the routine is paused; com-factory took over).
    const ourComments = all("SELECT id, product_id, text FROM comments WHERE platform = ? AND source IN ('runner', 'import') ORDER BY posted_at DESC LIMIT 300", P);
    for (const it of payload.items ?? []) {
      // A foreign /post/ link inside an activity item = someone's reply (likes and follows only link to our own post).
      if (!it.theirs || !it.author) continue;
      stats.found++;
      if (get('SELECT 1 FROM inbound WHERE platform = ? AND external_id = ?', P, it.theirs)) continue;
      let ctx = String(it.full || '');
      if (it.theirsText) ctx = ctx.replace(it.theirsText, '');
      ctx = ctx.replace(/^\S+\s+/, '').replace(/^(\d+\s*(ч|час[а-я]*|мин[а-я]*|дн[а-я]*|день|д|сек[а-я]*|нед[а-я]*|h|hours?|m|min[a-z]*|d|days?|w|weeks?)\.?\s*(назад|ago)?\s*)+/i, '').replace(/^(около|about)\s+\S+\s+(назад|ago)\s*/i, '').replace(/\s+/g, ' ').trim();
      const ours = ourComments.find((c) => c.text.length >= 20 && norm(ctx).includes(norm(c.text).slice(0, 40)));
      const received = it.time ? sqlNow(new Date(it.time)) : sqlNow();
      if (!ours) { run('INSERT OR IGNORE INTO inbound(platform, external_id, from_user, text, kind, post_url, received_at, handled, context) VALUES(?,?,?,?,?,?,?,1,?)', P, it.theirs, it.author, it.theirsText || '', 'routine', BASE + it.theirs, received, ctx.slice(0, 300)); continue; }
      stats.ours++;
      run('INSERT OR IGNORE INTO inbound(platform, external_id, from_user, text, kind, post_url, received_at, handled, context, product_id, comment_id) VALUES(?,?,?,?,?,?,?,0,?,?,?)', P, it.theirs, it.author, it.theirsText || '', '', BASE + it.theirs, received, ctx.slice(0, 500), ours.product_id ?? null, ours.id);
    }
    if (cfg.inbound_reply) {
      const todo = all('SELECT * FROM inbound WHERE platform = ? AND handled = 0 AND comment_id IS NOT NULL ORDER BY received_at ASC LIMIT 20', P);
      for (const inb of todo) {
        const turns = get("SELECT COUNT(*) n FROM comments WHERE platform = ? AND bucket = 'inbound' AND lower(author) = ?", P, String(inb.from_user).toLowerCase())?.n ?? 0;
        const cls = await classifyInbound({ their_reply: inb.text, our_comment: inb.context, author: inb.from_user });
        stats.cost += cls.cost;
        run('UPDATE inbound SET kind = ?, confidence = ? WHERE id = ?', cls.kind, cls.confidence, inb.id);
        if (cls.kind === 'C') {
          if (cfg.like_post) { const lr = await repl(likeCode(pathOf(inb.post_url)), { timeoutMs: 60_000 }); if (lr.payloads[0]?.ok) stats.liked++; }
          run("UPDATE inbound SET handled = 1, our_reply = '(like)' WHERE id = ?", inb.id); continue;
        }
        if (cls.kind === 'D') { run('UPDATE inbound SET handled = 1 WHERE id = ?', inb.id); continue; }
        if (turns >= 3) { run("UPDATE inbound SET handled = 1, our_reply = '(dialog limit)' WHERE id = ?", inb.id); continue; }
        if (stats.replied >= cfg.inbound_limit) break;
        const product = inb.product_id ? getProduct(inb.product_id) : listProducts(true, P)[0];
        const d = await draftThreadsInbound(inb as any, cls.kind, cls.lang, h, product, turns + 1);
        if (!d.text) { run('UPDATE inbound SET handled = 1, our_reply = ? WHERE id = ?', `(skipped: ${d.skip_reason})`, inb.id); continue; }
        if (cfg.mode === 'auto') {
          const g = gate(P);
          if (!g.ok && !g.reason.startsWith('daily limit')) { lines.push(`inbound gate: ${g.reason}`); break; }
          const pr = await repl(replyCode({ path: pathOf(inb.post_url), text: d.text, like: false, handle: h }), { timeoutMs: 150_000 });
          const res = pr.payloads[0];
          if (!res?.ok) {
            const err = String(res?.error ?? 'no result').slice(0, 300);
            run('UPDATE inbound SET handled = 1, our_reply = ? WHERE id = ?', `(failed: ${err})`, inb.id); lines.push(`inbound #${inb.id} failed: ${err}`);
            const push = pushbackOf(err, pr.raw); if (push) { block(P, push.hours, push.reason); break; }
            continue;
          }
          const replyUrl = res.replyHref ? BASE + res.replyHref : '';
          run(`INSERT INTO comments(platform, post_id, post_url, reply_id, reply_url, author, text, bucket, product_mentioned, link_included, run_id, product_id, source) VALUES(?,?,?,?,?,?,?,'inbound',?,?,?,?,'runner')`,
            P, pathOf(inb.post_url).split('/post/')[1] || '', inb.post_url, res.replyHref ? String(res.replyHref).split('/post/')[1] : `inbound:${inb.id}`, replyUrl, inb.from_user, d.text, 1, d.link_included ? 1 : 0, runId, product?.id ?? null);
          run('UPDATE inbound SET handled = 1, our_reply = ?, turns = turns + 1 WHERE id = ?', d.text, inb.id);
          stats.replied++;
          await new Promise((r) => setTimeout(r, 60_000 + Math.random() * 30_000));
        } else {
          run('INSERT INTO drafts(candidate_id, platform, text, model, mentions_product, link_included, inbound_id, product_id, status) VALUES(NULL,?,?,?,?,?,?,?,?)', P, d.text, d.model, 1, d.link_included ? 1 : 0, inb.id, product?.id ?? null, cfg.mode === 'dry' ? 'dry' : 'pending');
          run("UPDATE inbound SET handled = 1, our_reply = '(draft in queue)' WHERE id = ?", inb.id);
          stats.replied++;
        }
      }
    }
    setSetting('threads:last_inbound', Date.now());
    finishRun(runId, 'ok', stats, lines.join('\n'));
  } catch (e: any) {
    lines.push(`ERROR ${e.message}`);
    finishRun(runId, 'error', stats, lines.join('\n'));
  }
  return { runId, ...stats };
}

/** Our replies page -> likes/replies for our comments (including imported routine history, matched by parent post). */
export async function stats(): Promise<{ runId: number; updated: number }> {
  const runId = startRun(P, 'stats');
  let updated = 0;
  try {
    const h = handle();
    const r = await repl(repliesCode(h), { timeoutMs: 90_000 });
    const payload = r.payloads[0];
    if (!payload) throw new Error(`no payload: ${r.raw.slice(-300)}`);
    if (payload.login) { block(P, 24, 'Threads session is not logged in'); throw new Error('Threads is not logged in'); }
    if (typeof payload.followers === 'number') setSetting('threads:me', { handle: h, followers: payload.followers, at: Date.now() });
    let parent: any = null;
    for (const p of payload.posts ?? []) {
      if (p.author.toLowerCase() !== h.toLowerCase()) { parent = p; continue; }
      const metrics = JSON.stringify({ likes: p.likes, replies: p.replies });
      let row = get('SELECT id FROM comments WHERE platform = ? AND reply_url LIKE ?', P, `%${p.href}`);
      if (!row && parent) row = get("SELECT id FROM comments WHERE platform = ? AND (reply_url = '' OR reply_id LIKE 'pending:%' OR reply_id LIKE 'import:%') AND post_url LIKE ?", P, `%${parent.href}%`);
      if (!row) row = get("SELECT id FROM comments WHERE platform = ? AND substr(lower(text), 1, 40) = ? AND reply_url = ''", P, norm(p.text).slice(0, 40));
      if (!row) continue;
      run("UPDATE comments SET metrics = ?, metrics_at = datetime('now'), reply_url = CASE WHEN reply_url = '' THEN ? ELSE reply_url END, reply_id = CASE WHEN reply_id LIKE 'pending:%' THEN ? ELSE reply_id END WHERE id = ?", metrics, BASE + p.href, p.id, row.id);
      updated++;
    }
    setSetting('threads:last_stats', Date.now());
    try { await insights(); } catch (e: any) { log('threads', `insights failed: ${e.message}`); }
    finishRun(runId, 'ok', { updated });
  } catch (e: any) {
    finishRun(runId, 'error', { updated }, `ERROR ${e.message}`);
  }
  return { runId, updated };
}

export interface ThreadsInsights { followers: number | null; recent_views: number | null; views: number | null; viewers: number | null; interactions: number | null; follower_growth: number | null; period: string; at: number }

const num = (s: string | undefined): number | null => {
  if (!s) return null;
  const t = s.replace(/[\s  ]/g, '');
  const m = t.match(/^([+\-−]?)([\d.,]+)(тыс|K|M|млн)?/i);
  if (!m) return null;
  let v = parseFloat(m[2].replace(',', '.').replace(/\.(?=\d{3}\b)/g, ''));
  if (/тыс|K/i.test(m[3] || '')) v *= 1000;
  if (/M|млн/i.test(m[3] || '')) v *= 1_000_000;
  if (m[1] === '-' || m[1] === '−') v = -v;
  return Number.isFinite(v) ? Math.round(v) : null;
};
/** Numbers from the profile header ("58 подписчиков · 17 388 недавних просмотров") and the Insights overview (last 30 days). */
export function parseInsights(profile: string, insights: string): Omit<ThreadsInsights, 'at'> {
  const pick = (text: string, labels: string[]) => {
    for (const l of labels) { const m = text.match(new RegExp(`${l}\\n([+\\-−]?[\\d\\s\\u00a0\\u202f.,]+(?:тыс\\.?|K|M|млн)?)\\n`, 'i')); if (m) return num(m[1]); }
    return null;
  };
  const followers = num(profile.match(/([\d\s  .,]+(?:тыс\.?|K)?)\s*(?:подписчик|followers)/i)?.[1]);
  const recent = num(profile.match(/([\d\s  .,]+(?:тыс\.?|K|M|млн)?)\s*(?:недавних просмотров|recent views)/i)?.[1]);
  const period = insights.match(/(Последние \d+ [а-яё]+|Last \d+ days)/i)?.[1] ?? '';
  return {
    followers, recent_views: recent, period,
    views: pick(insights, ['Просмотры', 'Views']),
    viewers: pick(insights, ['Зрители', 'Viewers']),
    interactions: pick(insights, ['Взаимодействия', 'Interactions']),
    follower_growth: pick(insights, ['Чистый прирост подписчиков', 'Net follower growth', 'Follower growth', 'New followers']),
  };
}

/** Profile and Insights totals -> setting threads:insights (shown on the overview). */
export async function insights(): Promise<ThreadsInsights> {
  const h = handle();
  const r = await repl(insightsCode(h), { timeoutMs: 90_000 });
  const p = r.payloads[0];
  if (!p) throw new Error(`no payload: ${r.raw.slice(-300)}`);
  if (p.login) throw new Error('Threads is not logged in');
  if (p.error) throw new Error(p.error);
  const row: ThreadsInsights = { ...parseInsights(p.profile || '', p.insights || ''), at: Date.now() };
  setSetting('threads:insights', row);
  if (typeof row.followers === 'number') setSetting('threads:me', { handle: h, followers: row.followers, at: Date.now() });
  log('threads', 'insights', row);
  return row;
}

export async function loginCheck(): Promise<{ ok: boolean; followers?: number | null; error?: string }> {
  try {
    const h = handle();
    const r = await repl(repliesCode(h), { timeoutMs: 90_000 });
    const p = r.payloads[0];
    if (!p) return { ok: false, error: 'no answer from Aside' };
    if (p.login || !p.loggedIn) return { ok: false, error: 'not logged in as @' + h };
    if (typeof p.followers === 'number') setSetting('threads:me', { handle: h, followers: p.followers, at: Date.now() });
    return { ok: true, followers: p.followers };
  } catch (e: any) { return { ok: false, error: e.message }; }
}

/** One scheduled run: import routine memory -> inbound -> discover -> draft -> post (auto) -> stats. */
export async function runOnce(): Promise<string> {
  const cfg = platformConfig(P);
  if (!cfg.enabled) return 'disabled';
  const parts: string[] = [];
  if (cfg.memory_import_path) { try { const r = importMemory(cfg.memory_import_path); parts.push(`import +${r.imported}`); } catch (e: any) { parts.push(`import failed: ${e.message}`); } }
  const inb = await inbound(); parts.push(`inbound found=${inb.found} ours=${inb.ours} replied=${inb.replied}`);
  const d = await discover(); parts.push(`discover seen=${d.seen} jev-draft=${d.drafts}`);
  const dr = await draft(); parts.push(`drafts=${dr.drafted}`);
  if (cfg.mode !== 'dry') { const p = await post({ max: cfg.per_run_limit }); parts.push(`posted=${p.posted}${p.reason ? ' (' + p.reason + ')' : ''}`); }
  await stats().catch(() => {});
  return parts.join('; ');
}
