// Panel: overview, review queue, comments, journal, settings, voice.
// The panel only reads data and edits configuration; discovery, drafting and posting are done by the scheduler.
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { html } from 'hono/html';
import { env, PANEL_URL } from '../lib/env.ts';
import { all, get, run, j } from '../lib/db.ts';
import { platformConfig, savePlatformConfig, models, setSetting, getSetting, platformName, PLATFORMS, MODES } from '../lib/settings.ts';
import { listProducts, getProduct, saveProduct } from '../lib/products.ts';
import { gate, activeBlock, block, unblock, localDayStartUtc, postedToday } from '../lib/limits.ts';
import { ask, extractJson } from '../lib/aside.ts';
import { voiceSystem } from '../prompts/voice.ts';
import { layout, fmtDate, fmtRel, fmtN, localDate, runKind, runSummary, statusChip } from './views.ts';
import { settings } from './settings.ts';
import { lastDoctor } from '../runner/doctor.ts';
import { nextRunInfo } from '../runner/scheduler.ts';
import { log } from '../lib/log.ts';
import { createRequire } from 'node:module';

const VERSION = createRequire(import.meta.url)('../../package.json').version as string;
const app = new Hono();
const flashOf = (c: any) => c.req.query('ok') || c.req.query('err') || '';
const queueCount = () => get(`SELECT COUNT(*) n FROM drafts WHERE status = 'pending'`)?.n ?? 0;
const page = (c: any, title: string, active: string, body: unknown) => c.html(layout(title, active, body, { flash: flashOf(c), queue: queueCount(), version: `v${VERSION}` }));
const plural = (n: number, one: string, few: string, many: string) => { const a = n % 10, b = n % 100; return `${n} ${a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 10 || b >= 20) ? few : many}`; };
/** Gate reasons in the owner's language. */
const gateText = (reason: string, cfg: any) => /outside active hours/.test(reason) ? `вне активных часов, ${cfg.active_hours.start}:00–${cfg.active_hours.end}:00` : /daily limit/.test(reason) ? 'дневной лимит исчерпан' : /account cap/.test(reason) ? 'потолок аккаунта на сегодня исчерпан' : /min gap/.test(reason) ? 'пауза между комментариями' : /disabled/.test(reason) ? 'выключено' : reason;
const tags = (r: any) => html`${r.product_mentioned ? html`<span class="pill">продукт</span>` : ''}${r.link_included ? html`<span class="pill">ссылка</span>` : ''}${r.source === 'import' ? html`<span class="pill">рутина Aside</span>` : ''}`;
/** Likes/replies are shown only where they were actually collected; no zero placeholders. */
const metricsNote = (r: any) => { if (!r.metrics_at) return ''; const m = j(r.metrics, {}); const parts: string[] = []; if (m.views) parts.push(`${m.views} просм.`); if (m.likes) parts.push(`♥ ${m.likes}`); if (m.replies) parts.push(`${m.replies} отв.`); return parts.join(' · '); };

// ---------- Overview
app.get('/', (c) => {
  const cards = PLATFORMS.map((p) => {
    const cfg = platformConfig(p);
    const today = get('SELECT COUNT(*) n FROM comments WHERE platform = ? AND posted_at >= ?', p, localDayStartUtc(cfg.active_hours.tz))?.n ?? 0;
    const week = get(`SELECT COUNT(*) n FROM comments WHERE platform = ? AND posted_at >= datetime('now', '-7 days')`, p)?.n ?? 0;
    const pending = get(`SELECT COUNT(*) n FROM drafts WHERE platform = ? AND status = 'pending'`, p)?.n ?? 0;
    const approved = get(`SELECT COUNT(*) n FROM drafts WHERE platform = ? AND status = 'approved'`, p)?.n ?? 0;
    const lastRun = get(`SELECT * FROM runs WHERE platform = ? AND kind IN ('discover','tick','run') ORDER BY id DESC LIMIT 1`, p);
    const lastComment = get('SELECT posted_at FROM comments WHERE platform = ? ORDER BY posted_at DESC LIMIT 1', p);
    const todayAll = postedToday(p, 'all');
    const products = listProducts(true, p).map((x) => x.name);
    return { p, cfg, today, todayAll, week, pending, approved, g: gate(p), b: activeBlock(p), lastRun, lastComment, next: nextRunInfo(p), products, hasRunner: p === 'x' || !!cfg.handle };
  });
  // Platform totals: Threads from its profile/Insights pages, X from the account and from our replies (X analytics needs Premium).
  const xMe = getSetting<any>('x:me', undefined);
  const ti = getSetting<any>('threads:insights', undefined);
  const tme = getSetting<any>('threads:me', undefined);
  const xSum = (() => { const rows = all(`SELECT metrics FROM comments WHERE platform = 'x' AND metrics_at IS NOT NULL`).map((r) => j(r.metrics, {})); const s = (k: string) => rows.reduce((a, m) => a + (Number(m[k]) || 0), 0); return { n: rows.length, views: s('views'), likes: s('likes'), replies: s('replies') }; })();
  const n = (v: unknown) => (typeof v === 'number' ? fmtN(v) : '—');
  const tz = platformConfig('x').active_hours.tz;
  const days: string[] = [];
  for (let i = 13; i >= 0; i--) days.push(localDate(new Date(Date.now() - i * 86400_000).toISOString().slice(0, 19).replace('T', ' '), tz));
  const perDay: Record<string, Record<string, number>> = {};
  for (const r of all(`SELECT platform, posted_at FROM comments WHERE posted_at >= datetime('now', '-15 days')`)) { const d = localDate(r.posted_at, tz); ((perDay[d] ||= {})[r.platform] = (perDay[d][r.platform] || 0) + 1); }
  const max = Math.max(1, ...days.map((d) => (perDay[d]?.x || 0) + (perDay[d]?.threads || 0)));
  const total14 = days.reduce((a, d) => a + (perDay[d]?.x || 0) + (perDay[d]?.threads || 0), 0);
  const recent = all('SELECT * FROM comments ORDER BY posted_at DESC LIMIT 8');
  const runs = all(`SELECT * FROM runs WHERE kind NOT IN ('inbound','stats') ORDER BY id DESC LIMIT 6`);

  const body = html`<h1>Обзор</h1><p class="sub">Что происходит сейчас и что нужно от вас.</p>
  <div class="grid g2">${cards.map((t) => {
    const st: [string, string] = t.b ? ['bad', `пауза: ${t.b.reason}`] : !t.cfg.enabled ? ['', 'выключено'] : !t.hasRunner ? ['warn', 'нужен ник'] : t.g.ok ? ['ok', 'работает'] : ['warn', gateText(t.g.reason, t.cfg)];
    const pct = t.cfg.daily_limit ? Math.min(100, Math.round((t.today / t.cfg.daily_limit) * 100)) : 0;
    return html`<div class="card">
    <div class="row between"><div class="row" style="gap:8px"><b style="font-size:16px">${platformName(t.p)}</b><span class="pill">${MODES[t.cfg.mode].label}</span></div>
      <div class="row" style="gap:4px">${t.b ? html`<form method="post" action="/api/platforms/${t.p}/resume"><button class="btn sm ghost">Снять паузу</button></form>` : html`<form method="post" action="/api/platforms/${t.p}/pause"><button class="btn sm ghost">Пауза 24 ч</button></form>`}<a class="btn sm ghost" href="/settings?tab=${t.p}">Настроить</a></div></div>
    <div class="row top" style="margin-top:20px;gap:36px">
      <div><div class="big">${t.today}<small>/ ${t.cfg.daily_limit} сегодня</small></div><div class="bar"><i style="width:${pct}%"></i></div></div>
      <div><div class="big">${t.week}</div><div class="lbl">за 7 дней</div></div>
    </div>
    <div class="row" style="margin-top:18px;gap:6px"><span class="chip ${st[0]}">${st[1]}</span>${t.pending ? html`<a class="chip warn" href="/queue">${plural(t.pending, 'ждёт решения', 'ждут решения', 'ждут решения')}</a>` : ''}${t.approved ? html`<span class="chip">${t.approved} одобрено, ждёт окна</span>` : ''}</div>
    <div class="small muted" style="margin-top:14px;line-height:1.75">
      ${t.hasRunner ? html`Следующий запуск: ${t.next}${t.lastRun ? html` · последний <a href="/runs/${t.lastRun.id}">${fmtRel(t.lastRun.finished_at || t.lastRun.started_at)}</a>` : ''}<br>` : html`Раннер не запущен: укажите ник в <a href="/settings?tab=threads">настройках Threads</a>.<br>`}
      Последний комментарий: ${t.lastComment ? fmtRel(t.lastComment.posted_at) : '—'}${t.p === 'threads' && t.todayAll !== t.today ? ` · всего по аккаунту сегодня ${t.todayAll}${t.cfg.account_daily_cap ? ` / ${t.cfg.account_daily_cap}` : ''} вместе с рутиной Aside` : ''}<br>
      ${t.products.length ? `Продукты: ${t.products.join(', ')}` : html`<span class="warn">Нет продукта для этой площадки</span>`}
    </div>
  </div>`; })}</div>

  <div class="grid g2 mt">
    <div class="card"><div class="row between"><h2 style="margin:0">Комментарии за 14 дней</h2><span class="muted small">${total14} всего</span></div>
      <div class="bars" style="margin-top:16px">${days.map((d) => { const x = perDay[d]?.x || 0, t = perDay[d]?.threads || 0; return html`<div class="b" title="${d}: X ${x}, Threads ${t}">${x ? html`<i class="x" style="height:${Math.max(3, Math.round((x / max) * 84))}px"></i>` : ''}${t ? html`<i class="t" style="height:${Math.max(3, Math.round((t / max) * 84))}px"></i>` : ''}</div>`; })}</div>
      <div class="axis"><span>${days[0].slice(5).replace('-', '.')}</span><span class="legend"><i style="background:var(--fg)"></i>X<i style="background:var(--faint)"></i>Threads</span><span>${days[13].slice(5).replace('-', '.')}</span></div></div>
    <div class="card"><div class="row between"><h2 style="margin:0">Статистика профилей</h2><span class="muted small">${ti?.at ? `Threads ${fmtRel(new Date(ti.at).toISOString())}` : ''}</span></div>
      <div class="kv" style="margin-top:10px">
        <div class="sec">Threads${tme?.handle ? ` · @${tme.handle}` : ''}</div>
        <span>Подписчики</span><b>${n(ti?.followers ?? tme?.followers)}${typeof ti?.follower_growth === 'number' ? html` <span class="muted" style="font-weight:400">${ti.follower_growth >= 0 ? '+' : ''}${ti.follower_growth} за 30 дн</span>` : ''}</b>
        <span>Просмотры${ti?.period ? ` · ${ti.period.toLowerCase()}` : ''}</span><b>${n(ti?.views)}</b>
        <span>Зрители</span><b>${n(ti?.viewers)}</b>
        <span>Взаимодействия</span><b>${n(ti?.interactions)}</b>
        <span>Недавние просмотры профиля</span><b>${n(ti?.recent_views)}</b>
        <div class="sec">X${xMe?.handle ? ` · @${xMe.handle}` : ''}</div>
        <span>Подписчики</span><b>${n(xMe?.followers)}</b>
        <span>Постов на аккаунте</span><b>${n(xMe?.tweets)}</b>
        <span>Просмотры наших ответов</span><b>${xSum.n ? fmtN(xSum.views) : '—'}</b>
        <span>Лайки и ответы на них</span><b>${xSum.n ? `♥ ${xSum.likes} · ${xSum.replies}` : '—'}</b>
      </div>
      ${ti ? '' : html`<p class="small muted" style="margin:12px 0 0">Статистика Threads появится после первого сбора (идёт вместе с обновлением метрик).</p>`}
      <p class="small faint" style="margin:10px 0 0">Аналитика профиля X доступна только с Premium, поэтому для X считаются наши ответы.</p>
    </div>
  </div>

  <div class="card mt"><div class="row between"><h2 style="margin:0">Последние комментарии</h2><a href="/comments" class="small muted">все →</a></div>
    ${recent.length ? html`<ul class="list" style="margin-top:12px">${recent.map((r) => html`<li><div class="when">${fmtRel(r.posted_at)}</div><div class="body"><div class="meta"><span class="pill">${platformName(r.platform)}</span><a href="${r.post_url || r.reply_url}" target="_blank">@${r.author}</a>${tags(r)}</div>${r.text}</div>${metricsNote(r) ? html`<div class="side-note">${metricsNote(r)}</div>` : ''}</li>`)}</ul>` : html`<div class="empty">Пока ничего не опубликовано.</div>`}</div>

  <div class="card mt"><div class="row between"><h2 style="margin:0">Последние запуски</h2><a href="/runs" class="small muted">журнал →</a></div>
    ${runs.length ? html`<ul class="list rows" style="margin-top:10px">${runs.map((r) => html`<li><div class="when">${fmtRel(r.started_at)}</div><div class="body"><a href="/runs/${r.id}">${platformName(r.platform)} · ${runKind(r.kind)}</a> <span class="muted small">${runSummary(r.stats)}</span></div>${statusChip(r.status)}</li>`)}</ul>` : html`<div class="empty">Запусков ещё не было.</div>`}</div>`;
  return page(c, 'Обзор', '/', body);
});

// ---------- Queue (review): edit, approve, reject. The scheduler posts approved drafts within limits.
app.get('/queue', (c) => {
  const drafts = all(`SELECT d.*, c.text AS post_text, c.author AS c_author, c.author_followers, c.url AS c_url, c.post_created_at, c.score, c.reason, c.kind,
      i.from_user AS i_user, i.text AS i_text, i.context AS i_context, i.post_url AS i_url, i.received_at AS i_at, p.name AS product_name
    FROM drafts d LEFT JOIN candidates c ON c.id = d.candidate_id LEFT JOIN inbound i ON i.id = d.inbound_id LEFT JOIN products p ON p.id = d.product_id
    WHERE d.status IN ('pending','approved','dry','failed') ORDER BY CASE d.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 WHEN 'failed' THEN 2 ELSE 3 END, d.created_at DESC LIMIT 60`);
  const cands = all(`SELECT * FROM candidates WHERE decision IN ('skip','draft','drafted') ORDER BY discovered_at DESC LIMIT 30`);
  const stat: Record<string, [string, string]> = { pending: ['warn', 'ждёт решения'], approved: ['ok', 'одобрено, уйдёт в ближайшее окно'], dry: ['', 'черновик, режим «только черновики»'], failed: ['bad', 'не отправилось'] };
  const xcfg = platformConfig('x');
  const body = html`<h1>Очередь</h1><p class="sub">Черновики, которые ждут вашего решения. Текст можно поправить перед одобрением; одобренное раннер публикует сам, как только позволят лимиты и активные часы.</p>
  ${drafts.length ? '' : html`<div class="card"><div class="empty">Очередь пуста. Новые черновики появляются после поиска: X каждые ${xcfg.run_every_minutes} мин в активные часы, Threads по расписанию.</div></div>`}
  <div class="stack">${drafts.map((d) => { const s = j(d.score, {}); const inb = !!d.inbound_id; const [cls, label] = stat[d.status] ?? ['', d.status]; return html`<div class="card">
    <div class="row between"><div class="row small muted" style="gap:8px"><span class="pill">${platformName(d.platform)}</span>${d.product_name ? html`<span class="pill">${d.product_name}</span>` : ''}${inb ? html`<span>ответ на входящее от <a href="${d.i_url}" target="_blank">@${d.i_user}</a> · ${fmtRel(d.i_at)}</span>` : html`<span><a href="${d.c_url}" target="_blank">@${d.c_author}</a>${d.platform === 'x' ? ` · ${d.author_followers} подп.` : ''} · пост ${fmtRel(d.post_created_at)} · польза ${typeof s.fit?.score === 'number' ? s.fit.score.toFixed(1) : '?'} из 3${d.kind === 'intro' ? ' · ветка-знакомство' : ''}</span>`}</div><span class="chip ${cls}">${label}</span></div>
    ${d.error ? html`<div class="small bad" style="margin-top:6px">${d.error}</div>` : ''}
    ${inb ? html`<div class="quote muted small">Наш комментарий: ${d.i_context}</div><div class="quote">${d.i_text}</div>` : html`<div class="quote">${d.post_text}</div>`}
    <form method="post" action="/api/drafts/${d.id}/save"><textarea name="text" rows="3">${d.text}</textarea>
      <div class="row between" style="margin-top:12px"><div class="row">
        ${d.status !== 'dry' && d.status !== 'approved' ? html`<button formaction="/api/drafts/${d.id}/approve" class="btn primary">Одобрить</button>` : ''}
        <button class="btn">Сохранить текст</button>
        <button formaction="/api/drafts/${d.id}/reject" class="btn ghost danger">Отклонить</button></div>
        <span class="small faint">${d.mentions_product ? 'упоминает продукт' : 'без продукта'} · ${d.model}</span>
      </div></form></div>`; })}</div>
  <details class="mt"><summary>Последние кандидаты и решения Jev (${cands.length})</summary>
  <div class="card" style="margin-top:10px"><ul class="list">
  ${cands.map((k) => html`<li><div class="when">${fmtRel(k.post_created_at)}</div><div class="body"><div class="meta"><span class="pill">${platformName(k.platform)}</span><a href="${k.url}" target="_blank">@${k.author}</a>${k.platform === 'x' ? html`<span>${k.author_followers} подп.</span>` : ''}<span class="${k.decision === 'skip' ? '' : 'ok'}">${k.decision === 'skip' ? 'пропуск' : k.decision === 'draft' ? 'одобрен' : k.decision === 'drafted' ? 'черновик написан' : k.decision}: ${k.reason}</span></div><span class="muted">${String(k.text).slice(0, 220)}</span></div></li>`)}</ul></div></details>`;
  return page(c, 'Очередь', '/queue', body);
});
app.post('/api/drafts/:id/save', async (c) => {
  const id = Number(c.req.param('id'));
  const f = await c.req.parseBody();
  const text = String(f.text ?? '').trim();
  if (text) run('UPDATE drafts SET text = ? WHERE id = ?', text, id);
  return c.redirect('/queue?ok=Текст сохранён');
});
app.post('/api/drafts/:id/approve', async (c) => {
  const id = Number(c.req.param('id'));
  const f = await c.req.parseBody();
  const text = String(f.text ?? '').trim();
  if (text) run('UPDATE drafts SET text = ? WHERE id = ?', text, id);
  run("UPDATE drafts SET status = 'approved', error = '' WHERE id = ?", id);
  return c.redirect('/queue?ok=Одобрено: уйдёт в ближайшее окно публикации');
});
app.post('/api/drafts/:id/reject', async (c) => {
  const id = Number(c.req.param('id'));
  run("UPDATE drafts SET status = 'rejected' WHERE id = ?", id);
  const d = get('SELECT candidate_id FROM drafts WHERE id = ?', id);
  if (d) run("UPDATE candidates SET decision = 'skip', reason = 'rejected by owner' WHERE id = ?", d.candidate_id);
  return c.redirect('/queue?ok=Отклонено');
});

// ---------- Comments (+ inbox tab)
app.get('/comments', (c) => {
  const tab = c.req.query('tab') || 'all';
  const tabs: [string, string][] = [['all', 'Все'], ['x', 'X'], ['threads', 'Threads'], ['inbox', 'Входящие']];
  let list;
  if (tab === 'inbox') {
    const rows = all('SELECT * FROM inbound ORDER BY received_at DESC LIMIT 150');
    const kinds: Record<string, string> = { A: 'вопрос', B: 'интерес', C: 'спасибо', D: 'прочее', routine: 'под комментарием рутины' };
    list = rows.length ? html`<ul class="list">${rows.map((r) => html`<li><div class="when">${fmtRel(r.received_at)}</div><div class="body"><div class="meta"><span class="pill">${platformName(r.platform)}</span><span>${r.from_user}${r.post_url ? html` <a href="${r.post_url}" target="_blank">↗</a>` : ''}</span>${r.kind ? html`<span class="pill">${kinds[r.kind] ?? r.kind}</span>` : ''}</div>${r.text}${r.our_reply ? html`<div class="quote small muted" style="margin:8px 0 0">Наш ответ: ${r.our_reply}</div>` : ''}</div></li>`)}</ul>` : html`<div class="empty">Ответов под нашими комментариями пока нет.</div>`;
  } else {
    const rows = all(`SELECT * FROM comments ${tab !== 'all' ? 'WHERE platform = ?' : ''} ORDER BY posted_at DESC LIMIT 200`, ...(tab !== 'all' ? [tab] : []));
    list = rows.length ? html`<ul class="list">${rows.map((r) => html`<li><div class="when" title="${fmtDate(r.posted_at)} UTC">${fmtRel(r.posted_at)}</div><div class="body"><div class="meta"><span class="pill">${platformName(r.platform)}</span><a href="${r.post_url || r.reply_url}" target="_blank">@${r.author}</a>${r.reply_url ? html`<a class="faint" href="${r.reply_url}" target="_blank">наш ответ ↗</a>` : ''}${tags(r)}</div>${r.text}</div>${metricsNote(r) ? html`<div class="side-note">${metricsNote(r)}</div>` : ''}</li>`)}</ul>` : html`<div class="empty">Пока пусто.</div>`;
  }
  const body = html`<h1>Комментарии</h1><p class="sub">Всё, что опубликовано с аккаунтов, включая комментарии рутины Aside.</p>
  <div class="tabs">${tabs.map(([k, l]) => html`<a href="/comments?tab=${k}" class="${k === tab ? 'active' : ''}">${l}</a>`)}</div><div class="card">${list}</div>`;
  return page(c, 'Комментарии', '/comments', body);
});

// ---------- Journal
app.get('/runs', (c) => {
  const rows = all('SELECT * FROM runs ORDER BY id DESC LIMIT 100');
  const body = html`<h1>Журнал</h1><p class="sub">Каждый запуск раннера: что искали, что нашли, что опубликовали, что сломалось.</p><div class="card">
  ${rows.length ? html`<ul class="list rows">${rows.map((r) => html`<li><div class="when" title="${fmtDate(r.started_at)} UTC">${fmtRel(r.started_at)}</div><div class="body"><a href="/runs/${r.id}">${platformName(r.platform)} · ${runKind(r.kind)}</a> <span class="muted small">${runSummary(r.stats)}</span></div>${statusChip(r.status)}</li>`)}</ul>` : html`<div class="empty">Запусков ещё не было.</div>`}</div>`;
  return page(c, 'Журнал', '/runs', body);
});
app.get('/runs/:id', (c) => {
  const r = get('SELECT * FROM runs WHERE id = ?', Number(c.req.param('id')));
  if (!r) return c.notFound();
  const body = html`<div class="row" style="gap:12px;margin-bottom:4px"><h1 style="margin:0">${platformName(r.platform)} · ${runKind(r.kind)}</h1>${statusChip(r.status)}</div><p class="sub">Запуск #${r.id} · ${fmtDate(r.started_at)} → ${fmtDate(r.finished_at)} UTC${runSummary(r.stats) ? ` · ${runSummary(r.stats)}` : ''}</p>
  <div class="card"><h2>Лог</h2><pre>${r.log || '(пусто)'}</pre></div>`;
  return page(c, `Запуск #${r.id}`, '/runs', body);
});

app.route('/', settings);

// ---------- JSON API (read-only state for agents and scripts)
app.get('/api/state', (c) => c.json({ platforms: Object.fromEntries(PLATFORMS.map((p) => [p, platformConfig(p)])), products: listProducts(), models: models(), gates: Object.fromEntries(PLATFORMS.map((p) => [p, gate(p)])), doctor: lastDoctor() }));
app.get('/api/health', (c) => c.json({ ok: true, version: VERSION, time: new Date().toISOString() }));

// ---------- Voice / text command → settings patch the owner confirms
app.post('/api/voice', async (c) => {
  const { transcript } = await c.req.json();
  const ctx = { platforms: Object.fromEntries(PLATFORMS.map((p) => [p, platformConfig(p)])), products: listProducts(), models: models(), stop_authors: Object.fromEntries(PLATFORMS.map((p) => [p, all('SELECT author FROM stop_authors WHERE platform = ?', p).map((r) => r.author)])), paused: Object.fromEntries(PLATFORMS.map((p) => [p, activeBlock(p) ?? null])) };
  try {
    const m = models();
    const out = extractJson(await ask(`You are answering a text task inside a terminal session: do NOT use any tools, do not open pages. Answer with the JSON object only, no prose, no fences.\n\n${voiceSystem(ctx)}\n\n## Command\n${String(transcript)}`, { provider: m.text_provider, model: m.text_model, effort: 'low', timeoutMs: 120_000 }));
    return c.json({ summary: out.summary ?? '', changes: Array.isArray(out.changes) ? out.changes : [] });
  } catch (e: any) {
    return c.json({ summary: `Не получилось разобрать команду: ${e.message}`, changes: [] });
  }
});
app.post('/api/voice/apply', async (c) => {
  const { changes } = await c.req.json();
  const done: string[] = [];
  for (const ch of changes ?? []) {
    const t = String(ch.target ?? '');
    if (t.startsWith('platform:')) { const p = t.slice(9); if ((PLATFORMS as readonly string[]).includes(p)) { savePlatformConfig(p, ch.patch ?? {}); done.push(platformName(p)); } }
    else if (t === 'models') { setSetting('models', { ...models(), ...(ch.patch ?? {}) }); done.push('модели'); }
    else if (t === 'product:new') { saveProduct(ch.patch ?? {}); done.push('новый продукт'); }
    else if (t.startsWith('product:')) { const id = Number(t.slice(8)); const cur = getProduct(id); if (cur) { saveProduct({ ...cur, ...(ch.patch ?? {}), id }); done.push(`продукт ${cur.name}`); } }
    else if (t.startsWith('stop_authors:')) { const p = t.slice(13); if ((PLATFORMS as readonly string[]).includes(p) && Array.isArray(ch.patch)) { run('DELETE FROM stop_authors WHERE platform = ?', p); for (const a of ch.patch) run('INSERT OR IGNORE INTO stop_authors(platform, author) VALUES(?, ?)', p, String(a).replace(/^@/, '')); done.push(`стоп-лист ${platformName(p)}`); } }
    else if (t === 'pause') { const p = String(ch.patch?.platform ?? ''); const h = Number(ch.patch?.hours ?? 0); if ((PLATFORMS as readonly string[]).includes(p)) { if (h > 0) block(p, h, 'пауза голосом'); else unblock(p); done.push(`${h > 0 ? 'пауза' : 'снята пауза'} ${platformName(p)}`); } }
  }
  log('voice', 'applied', done);
  return c.json({ ok: true, message: done.length ? `Применено: ${done.join(', ')}` : 'Нечего применять' });
});

export async function startServer() {
  await new Promise<void>((resolve) => serve({ fetch: app.fetch, hostname: env.host, port: env.port }, () => resolve()));
  log('server', `listening on ${PANEL_URL}`);
}
export { app };
