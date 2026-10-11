import { repl } from '../lib/aside.ts';
import { all, get, run, j } from '../lib/db.ts';
import { platformConfig, getSetting, setSetting } from '../lib/settings.ts';
import { scorePost } from '../lib/jev.ts';
import { draftX } from '../lib/draft.ts';
import { gate, authorBlocked, block } from '../lib/limits.ts';
import { listProducts, getProduct, type Product } from '../lib/products.ts';
import { log } from '../lib/log.ts';
import { xBrowserReplyCode, type XBrowserReply } from '../lib/x-browser.ts';

const P = 'x';

export function startRun(platform: string, kind: string): number {
  return Number(run('INSERT INTO runs(platform, kind) VALUES(?, ?)', platform, kind).lastInsertRowid);
}
export function finishRun(id: number, status: string, stats: Record<string, unknown>, logText = '') {
  run("UPDATE runs SET status = ?, finished_at = datetime('now'), stats = ?, log = ? WHERE id = ?", status, JSON.stringify(stats), logText.slice(0, 20000), id);
}

/** Looks like X pushed back (auth, rate limit, lock). Only error-ish lines are inspected: emitted JSON must never trigger this. */
export function detectPushback(raw: string): { reason: string; hours: number } | undefined {
  const lines = raw.split('\n').filter((l) => !l.includes('@@CF@@') && /error|failed|exception|navigated to|waitForSelector|\[system\]/i.test(l));
  const s = lines.join('\n').toLowerCase();
  if (!s) return undefined;
  if (/mode=login|\/i\/flow\/login|not logged in|apptabbar_profile_link|auth_token/.test(s)) return { reason: 'X session is not logged in', hours: 24 };
  if (/suspend|locked|unusual activity|verify your identity|challenge/.test(s)) return { reason: 'X account restricted', hours: 24 };
  if (/http 429|status(?:code)?[:= ]+429|\b429\b.*(rate|limit)|rate limit|too many requests/.test(s)) return { reason: 'X rate limit (search); resumes automatically', hours: 1 };
  return undefined;
}

export async function getMe(force = false): Promise<{ id: string; handle: string; name: string; followers: number; tweets?: number; desc: string; at: number } | undefined> {
  const cached = getSetting<any>('x:me', undefined);
  if (!force && cached && Date.now() - cached.at < 6 * 3600_000) return cached;
  const r = await repl(`const me = await twitter.getMe(); emit({ id: me.id, handle: me.screenName, name: me.name, followers: me.followersCount, tweets: me.tweetCount ?? null, desc: me.description || '', url: me.url || '' });`, { timeoutMs: 60_000 });
  const me = r.payloads[0];
  if (!me) return cached;
  const row = { ...me, at: Date.now() };
  setSetting('x:me', row);
  return row;
}

/** The profile "Website" field as shown on x.com (Aside's getMe does not return it; the API only has the t.co wrapper). */
export async function profileWebsite(handle: string): Promise<string> {
  const r = await repl(`
    const p = await openTab(${JSON.stringify(`https://x.com/${handle}`)});
    await sleep(6000);
    const s = await p.evaluate(() => ({ url: [...document.querySelectorAll('[data-testid=UserUrl]')].map(a => a.innerText).join(' '), desc: (document.querySelector('[data-testid=UserDescription]') || {}).innerText || '' }));
    await closeTab(p);
    emit(s);`, { timeoutMs: 60_000 });
  const s = r.payloads[0];
  return s ? `${s.url} ${s.desc}` : '';
}

function ageMinutes(iso: string | undefined): number {
  if (!iso) return 1e9;
  return (Date.now() - new Date(iso).getTime()) / 60_000;
}

function pickQueries(key: string, list: string[], n: number): string[] {
  const qs = list.filter(Boolean);
  if (!qs.length) return [];
  const cursor = getSetting<number>(key, 0) % qs.length;
  const out: string[] = [];
  for (let i = 0; i < Math.min(n, qs.length); i++) out.push(qs[(cursor + i) % qs.length]);
  setSetting(key, (cursor + n) % qs.length);
  return out;
}

/** Search X for fresh root posts for each product, store candidates, score them with Jev. */
export async function discover(opts: { queries?: number } = {}): Promise<{ runId: number; seen: number; added: number; drafts: number; skipped: number }> {
  const cfg = platformConfig(P);
  const runId = startRun(P, 'discover');
  const stats = { seen: 0, added: 0, drafts: 0, skipped: 0, cost: 0 };
  const lines: string[] = [];
  try {
    const me = await getMe();
    if (!me) throw new Error('cannot read X account (not logged in?)');
    const products = listProducts(true, P);
    if (!products.length) throw new Error('no active product for X (Настройки → Продукт → Где использовать)');
    const per = Math.max(1, Math.round((opts.queries ?? 4) / products.length));
    const plan: { q: string; product: Product }[] = [];
    for (const pr of products) for (const q of pickQueries(`x:qc:${pr.id}`, pr.queries.length ? pr.queries : cfg.queries, per)) plan.push({ q, product: pr });
    const queries = plan.map((x) => x.q);
    const langFilter = cfg.languages.length ? ` (${cfg.languages.map((l) => `lang:${l}`).join(' OR ')})` : '';
    const neg = cfg.negative_terms.filter(Boolean).map((t) => ` -${t.replace(/\s+/g, '')}`).join('');
    const suffix = `${langFilter} -filter:replies -filter:links${neg}`;
    lines.push(`queries: ${plan.map((x) => `${x.q} [${x.product.name}]`).join(' | ')}`);
    const code = `
      const out = [];
      for (const q of ${JSON.stringify(queries)}) {
        try {
          const r = await twitter.search(q + ${JSON.stringify(suffix)}, { product: 'Latest', count: 20 });
          out.push({ q, tweets: r.tweets.map(t => ({ id: t.id, text: t.text, createdAt: t.createdAt, likes: t.likes, replies: t.replies, retweets: t.retweets, views: t.views, inReplyToId: t.inReplyToId || null, author: { id: t.author.id, sn: t.author.screenName, name: t.author.name, followers: t.author.followersCount, verified: t.author.isBlueVerified, desc: (t.author.description || '').slice(0, 160) } })) });
        } catch (e) { out.push({ q, error: String(e).slice(0, 300) }); }
        await sleep(2500 + Math.random() * 2000);
      }
      emit(out);`;
    const r = await repl(code, { timeoutMs: 160_000 });
    const results: any[] = r.payloads[0] ?? [];
    const errors = results.filter((x) => x.error).map((x) => x.error).join('\n');
    const push = detectPushback(r.raw + '\n' + errors.replace(/@@CF@@/g, ''));
    if (push && results.every((x) => x.error)) { block(P, push.hours, push.reason); throw new Error(push.reason); }
    for (const res of results) {
      if (res.error) { lines.push(`query "${res.q}": ${res.error}`); continue; }
      const product = plan.find((x) => x.q === res.q)?.product ?? products[0];
      for (const t of res.tweets) {
        stats.seen++;
        if (t.inReplyToId) continue;
        if (t.author.sn.toLowerCase() === me.handle.toLowerCase()) continue;
        if (get('SELECT 1 FROM candidates WHERE platform = ? AND post_id = ?', P, t.id)) continue;
        const age = ageMinutes(t.createdAt);
        let decision = 'new', reason = '';
        if (age > cfg.max_age_minutes) { decision = 'skip'; reason = `too old (${Math.round(age / 60)} h)`; }
        else if (t.author.followers < cfg.min_followers) { decision = 'skip'; reason = `author has ${t.author.followers} followers (< ${cfg.min_followers})`; }
        else { const ab = authorBlocked(P, t.author.sn); if (ab) { decision = 'skip'; reason = ab; } }
        run(`INSERT INTO candidates(platform, post_id, url, author, author_followers, author_verified, text, lang, query, post_created_at, run_id, metrics, decision, reason, product_id)
             VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          P, t.id, `https://x.com/${t.author.sn}/status/${t.id}`, t.author.sn, t.author.followers, t.author.verified ? 1 : 0, t.text, '', res.q, t.createdAt, runId,
          JSON.stringify({ likes: t.likes, replies: t.replies, retweets: t.retweets, views: t.views, author_name: t.author.name, author_desc: t.author.desc, age_min: Math.round(age) }), decision, reason, product.id);
        stats.added++;
        if (decision === 'skip') stats.skipped++;
      }
    }
    // Score the fresh ones with Jev, freshest first.
    const fresh = all(`SELECT * FROM candidates WHERE platform = ? AND decision = 'new' ORDER BY post_created_at DESC LIMIT 30`, P);
    for (const c of fresh) {
      const m = j(c.metrics, {});
      const product = (c.product_id && getProduct(c.product_id)) || products[0];
      try {
        const s = await scorePost(P, cfg, product, { post: c.text, author: { handle: c.author, name: m.author_name, bio: m.author_desc, followers: c.author_followers, verified: !!c.author_verified }, age_minutes: m.age_min, likes: m.likes, replies: m.replies, views: m.views, found_by_query: c.query });
        stats.cost += s.cost;
        run('UPDATE candidates SET score = ?, decision = ?, reason = ?, lang = ?, kind = ? WHERE id = ?', JSON.stringify(s.answers), s.decision, s.reason, s.lang, s.kind, c.id);
        if (s.decision === 'draft') stats.drafts++; else stats.skipped++;
      } catch (e: any) {
        lines.push(`score #${c.id}: ${e.message}`);
      }
    }
    if (errors) lines.push(errors);
    finishRun(runId, errors && !stats.seen ? 'error' : 'ok', stats, lines.join('\n'));
    log('x', 'discover done', stats);
  } catch (e: any) {
    lines.push(`ERROR ${e.message}`);
    finishRun(runId, 'error', stats, lines.join('\n'));
    log('x', 'discover failed', e.message);
  }
  return { runId, ...stats };
}

/** Re-run Jev on recent candidates it skipped (after the thresholds or the instructions were loosened). */
export async function rescore(days = 3, limit = 60): Promise<{ runId: number; rescored: number; drafts: number }> {
  const cfg = platformConfig(P);
  const runId = startRun(P, 'rescore');
  const stats = { rescored: 0, drafts: 0, cost: 0 };
  const lines: string[] = [];
  try {
    const rows = all(`SELECT * FROM candidates WHERE platform = ? AND decision = 'skip'
        AND (reason LIKE 'relevance%' OR reason LIKE 'kind=%' OR reason LIKE 'fit %' OR reason LIKE 'risk %' OR reason LIKE 'author has%')
        AND post_created_at >= datetime('now', ?) ORDER BY post_created_at DESC LIMIT ?`, P, `-${days} days`, limit);
    const products = listProducts(true, P);
    for (const c of rows) {
      if (c.author_followers < cfg.min_followers) continue;
      if (authorBlocked(P, c.author)) continue;
      const m = j(c.metrics, {});
      const product = (c.product_id && getProduct(c.product_id)) || products[0];
      try {
        const s = await scorePost(P, cfg, product, { post: c.text, author: { handle: c.author, name: m.author_name, bio: m.author_desc, followers: c.author_followers, verified: !!c.author_verified }, age_minutes: Math.round(ageMinutes(c.post_created_at)), likes: m.likes, replies: m.replies, views: m.views, found_by_query: c.query });
        stats.cost += s.cost;
        stats.rescored++;
        run('UPDATE candidates SET score = ?, decision = ?, reason = ?, lang = ?, kind = ? WHERE id = ?', JSON.stringify(s.answers), s.decision, s.reason, s.lang, s.kind, c.id);
        if (s.decision === 'draft') { stats.drafts++; lines.push(`#${c.id} @${c.author}: ${s.reason}`); }
      } catch (e: any) {
        lines.push(`score #${c.id}: ${e.message}`);
      }
    }
    finishRun(runId, 'ok', stats, lines.join('\n'));
    log('x', 'rescore done', stats);
  } catch (e: any) {
    lines.push(`ERROR ${e.message}`);
    finishRun(runId, 'error', stats, lines.join('\n'));
  }
  return { runId, ...stats };
}

/** Write drafts for candidates Jev approved. review -> pending; auto -> approved; dry -> dry. */
export async function draft(limit?: number): Promise<{ runId: number; drafted: number; declined: number }> {
  const cfg = platformConfig(P);
  const runId = startRun(P, 'draft');
  const stats = { drafted: 0, declined: 0 };
  const lines: string[] = [];
  try {
    const me = await getMe();
    if (!me) throw new Error('cannot read X account');
    const inFlight = get(`SELECT COUNT(*) n FROM drafts WHERE platform = ? AND status IN ('pending','approved','posted') AND created_at >= datetime('now','-1 day')`, P)?.n ?? 0;
    const want = Math.min(limit ?? cfg.per_run_limit, Math.max(0, cfg.daily_limit - inFlight));
    const cands = all(`SELECT c.* FROM candidates c LEFT JOIN drafts d ON d.candidate_id = c.id WHERE c.platform = ? AND c.decision = 'draft' AND d.id IS NULL ORDER BY c.post_created_at DESC LIMIT 12`, P);
    for (const c of cands) {
      if (stats.drafted >= want) break;
      const score = j(c.score, {});
      const m = j(c.metrics, {});
      const product = (c.product_id && getProduct(c.product_id)) || listProducts(true, P)[0];
      const lang = c.lang || score.lang?.choice || product?.languages[0] || cfg.languages[0] || 'pt';
      try {
        const d = await draftX({ ...c, author_name: m.author_name, metrics: { likes: m.likes, replies: m.replies, views: m.views } }, lang, { name: me.name, handle: me.handle }, product);
        if (!d.text) {
          run('UPDATE candidates SET decision = ?, reason = ? WHERE id = ?', 'skip', `draft: ${d.skip_reason}`, c.id);
          stats.declined++;
          continue;
        }
        const status = cfg.mode === 'auto' ? 'approved' : cfg.mode === 'dry' ? 'dry' : 'pending';
        run('INSERT INTO drafts(candidate_id, platform, text, model, mentions_product, link_included, product_id, status) VALUES(?,?,?,?,?,?,?,?)', c.id, P, d.text, d.model, d.mentions_product ? 1 : 0, d.link_included ? 1 : 0, product?.id ?? null, status);
        run('UPDATE candidates SET decision = ? WHERE id = ?', 'drafted', c.id);
        stats.drafted++;
      } catch (e: any) {
        lines.push(`draft #${c.id}: ${e.message}`);
      }
    }
    finishRun(runId, 'ok', stats, lines.join('\n'));
  } catch (e: any) {
    lines.push(`ERROR ${e.message}`);
    finishRun(runId, 'error', stats, lines.join('\n'));
  }
  return { runId, ...stats };
}

/** Post approved drafts (oldest first), one at a time, respecting the gate. */
export async function post(opts: { draftId?: number; max?: number; now?: boolean } = {}): Promise<{ runId: number; posted: number; reason: string }> {
  const cfg = platformConfig(P);
  const drafts = opts.draftId
    ? all('SELECT d.*, c.post_id, c.author, c.url FROM drafts d JOIN candidates c ON c.id = d.candidate_id WHERE d.id = ? AND d.status IN (?, ?)', opts.draftId, 'approved', 'pending')
    : all(`SELECT d.*, c.post_id, c.author, c.url FROM drafts d JOIN candidates c ON c.id = d.candidate_id WHERE d.platform = ? AND d.status = 'approved' ORDER BY d.created_at ASC`, P);
  if (!drafts.length) return { runId: 0, posted: 0, reason: 'nothing approved' };
  // One poster at a time across processes (scheduler and CLI): a parallel run would send the same draft twice.
  const lockAt = getSetting<number>('x:post_lock', 0);
  if (Date.now() - lockAt < 3 * 60_000) return { runId: 0, posted: 0, reason: 'another post run is in progress' };
  setSetting('x:post_lock', Date.now());
  const runId = startRun(P, 'post');
  const lines: string[] = [];
  let posted = 0; let reason = '';
  try {
    const me = await getMe();
    if (!me) throw new Error('cannot read X account');
    for (const d of drafts) {
      if (posted >= (opts.max ?? 1)) break;
      const g = gate(P, { ignoreHours: !!opts.now });
      if (!g.ok) { reason = g.reason; lines.push(`gate: ${g.reason}`); break; }
      const ab = authorBlocked(P, d.author);
      if (ab) { run('UPDATE drafts SET status = ?, error = ? WHERE id = ?', 'rejected', ab, d.id); lines.push(`#${d.id} ${ab}`); continue; }
      // Reply from a real x.com tab: the API path (twitter.reply) gets "226 automated" on young accounts.
      const r = await repl(xBrowserReplyCode(d.author, d.post_id, d.text, me.handle, cfg.like_post), { timeoutMs: 150_000 });
      const push = detectPushback(r.raw);
      const res = r.payloads[0] as XBrowserReply | undefined;
      if (!res) {
        const err = push?.reason || r.raw.split('\n').filter((l) => /error|Error/.test(l)).slice(-3).join(' | ').slice(0, 500) || 'no answer from Aside';
        run('UPDATE drafts SET status = ?, error = ? WHERE id = ?', 'failed', err, d.id);
        lines.push(`#${d.id} failed: ${err}`);
        if (push) { block(P, push.hours, push.reason); reason = push.reason; }
        break;
      }
      if (res.login) { block(P, 24, 'X session in Aside Browser is not logged in: open x.com in Aside and sign in'); reason = 'X is not logged in'; lines.push(`#${d.id}: ${res.error}`); break; }
      if (!res.sent) {
        // The page did not accept the reply (X error toast, selector change…): keep the draft for the owner to see, stop this run.
        run('UPDATE drafts SET status = ?, error = ? WHERE id = ?', 'failed', `${res.step}: ${res.error ?? 'unknown'}`, d.id);
        lines.push(`#${d.id} failed at ${res.step}: ${res.error}${res.toast ? ` (toast: ${res.toast})` : ''}`);
        reason = `X: ${res.error}`;
        break;
      }
      // Sent. If the reply could not be located on the page, record it as pending; stats resolves it later by text.
      const replyId = res.id || `pending:${Date.now()}`;
      const url = res.id ? `https://x.com/${me.handle}/status/${res.id}` : d.url;
      run("UPDATE drafts SET status = 'posted', posted_at = datetime('now'), reply_id = ?, reply_url = ? WHERE id = ?", replyId, url, d.id);
      run(`INSERT INTO comments(platform, post_id, post_url, reply_id, reply_url, author, text, bucket, product_mentioned, link_included, run_id, product_id, source) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'runner')`,
        P, d.post_id, d.url, replyId, url, d.author, d.text, 'x', d.mentions_product, d.link_included ?? 0, runId, d.product_id ?? null);
      run('UPDATE candidates SET decision = ? WHERE id = ?', 'posted', d.candidate_id);
      posted++;
      lines.push(`#${d.id} posted ${url}${res.id ? '' : ' (sent, reply id pending)'}${res.liked ? ' (liked)' : ''}${res.check?.error ? ' check: ' + res.check.error : ''}`);
      log('x', 'posted', url);
    }
    finishRun(runId, 'ok', { posted, reason }, lines.join('\n'));
  } catch (e: any) {
    lines.push(`ERROR ${e.message}`);
    finishRun(runId, 'error', { posted }, lines.join('\n'));
    reason = e.message;
  } finally {
    setSetting('x:post_lock', 0);
  }
  return { runId, posted, reason };
}

/** Refresh views/likes/replies for our recent replies. */
export async function stats(days = 14): Promise<{ runId: number; updated: number }> {
  const rows = all(`SELECT id, reply_id FROM comments WHERE platform = ? AND reply_id <> '' AND reply_id NOT LIKE 'import:%' AND reply_id NOT LIKE 'pending:%' AND posted_at >= datetime('now', ?) ORDER BY posted_at DESC LIMIT 60`, P, `-${days} days`);
  setSetting('x:last_stats', Date.now());
  if (!rows.length) return { runId: 0, updated: 0 };
  const runId = startRun(P, 'stats');
  let updated = 0;
  const lines: string[] = [];
  try {
    for (let i = 0; i < rows.length; i += 20) {
      const chunk = rows.slice(i, i + 20);
      const code = `
        const out = [];
        for (const id of ${JSON.stringify(chunk.map((r) => r.reply_id))}) {
          try { const t = await twitter.getTweet(id); out.push({ id, likes: t.likes, replies: t.replies, retweets: t.retweets, views: t.views, bookmarks: t.bookmarks }); }
          catch (e) { out.push({ id, error: String(e).slice(0, 120) }); }
          await sleep(700);
        }
        emit(out);`;
      const r = await repl(code, { timeoutMs: 140_000 });
      for (const m of r.payloads[0] ?? []) {
        if (m.error) { lines.push(`${m.id}: ${m.error}`); continue; }
        const row = chunk.find((x) => x.reply_id === m.id);
        if (!row) continue;
        run("UPDATE comments SET metrics = ?, metrics_at = datetime('now') WHERE id = ?", JSON.stringify({ likes: m.likes, replies: m.replies, retweets: m.retweets, views: m.views, bookmarks: m.bookmarks }), row.id);
        updated++;
      }
    }
    finishRun(runId, 'ok', { updated }, lines.join('\n'));
  } catch (e: any) {
    finishRun(runId, 'error', { updated }, `ERROR ${e.message}`);
  }
  return { runId, updated };
}

/** Pull notifications (replies, mentions) into the inbox. */
export async function inbound(): Promise<{ runId: number; added: number }> {
  const runId = startRun(P, 'inbound');
  let added = 0;
  try {
    const r = await repl(`const n = await twitter.getNotifications({ count: 30 }); emit(n.notifications.map(x => ({ id: x.id, type: x.type, timestamp: x.timestamp, message: x.message })));`, { timeoutMs: 60_000 });
    for (const n of r.payloads[0] ?? []) {
      const res = run('INSERT OR IGNORE INTO inbound(platform, external_id, from_user, text, kind, received_at, handled) VALUES(?,?,?,?,?,?,1)', P, String(n.id), '', String(n.message ?? ''), String(n.type ?? ''), n.timestamp ? new Date(n.timestamp).toISOString().slice(0, 19).replace('T', ' ') : new Date().toISOString().slice(0, 19).replace('T', ' '));
      if (res.changes) added++;
    }
    setSetting('x:last_inbound', Date.now());
    finishRun(runId, 'ok', { added });
  } catch (e: any) {
    finishRun(runId, 'error', { added }, `ERROR ${e.message}`);
  }
  return { runId, added };
}

/** One scheduler tick for X: discover -> draft -> post approved drafts (auto mode approves them itself). */
export async function tick(): Promise<string> {
  const cfg = platformConfig(P);
  if (!cfg.enabled) return 'disabled';
  const d = await discover();
  const dr = await draft();
  let p = { posted: 0, reason: '' };
  if (cfg.mode !== 'dry') p = await post({ max: 1 });
  return `discover seen=${d.seen} added=${d.added} jev-draft=${d.drafts}; drafts=${dr.drafted}; posted=${p.posted}${p.reason ? ' (' + p.reason + ')' : ''}`;
}
