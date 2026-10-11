// Settings pages: product, X, Threads, system. Pure configuration, no platform actions.
import { Hono } from 'hono';
import { html } from 'hono/html';
import { env, PANEL_URL } from '../lib/env.ts';
import { all, run } from '../lib/db.ts';
import { platformConfig, savePlatformConfig, models, setSetting, platformName, PLATFORMS, MODES, EFFORTS, type PlatformConfig, type Mode } from '../lib/settings.ts';
import { listProducts, saveProduct, deleteProduct } from '../lib/products.ts';
import { activeBlock, unblock, block } from '../lib/limits.ts';
import { lastDoctor } from '../runner/doctor.ts';
import { layout, field, toggle, segmented, fmtDate } from './views.ts';

export const settings = new Hono();
const TZS = ['America/Sao_Paulo', 'America/Argentina/Buenos_Aires', 'America/Mexico_City', 'America/Bogota', 'America/Lima', 'America/Santiago', 'Europe/Moscow', 'Europe/Lisbon', 'Europe/Madrid', 'Europe/Berlin', 'Asia/Almaty', 'Asia/Dubai', 'UTC'];
const flashOf = (c: any) => c.req.query('ok') || c.req.query('err') || '';
const queueCount = () => all(`SELECT COUNT(*) n FROM drafts WHERE status = 'pending'`)[0]?.n ?? 0;

function tabs(active: string) {
  const t: [string, string][] = [['product', 'Продукт'], ['x', 'X'], ['threads', 'Threads'], ['system', 'Система']];
  return html`<div class="tabs">${t.map(([k, l]) => html`<a href="/settings?tab=${k}" class="${k === active ? 'active' : ''}">${l}</a>`)}</div>`;
}

// ---------- Product
function productForm(p: any) {
  const isNew = !p;
  return html`<form method="post" action="/api/products/${p?.id ?? 'new'}" class="card">
    <div class="grid g2">
      ${field('Название', html`<input type="text" name="name" value="${p?.name ?? ''}" required placeholder="eSIM для поездок">`)}
      ${field('Где использовать', html`<div class="row" style="padding-top:6px">${PLATFORMS.map((pl) => html`<label class="switch"><input type="checkbox" name="platforms" value="${pl}" ${!p || (p.platforms ?? []).includes(pl) ? 'checked' : ''}><span class="tr"></span><span>${platformName(pl)}</span></label>`)}</div>`, 'Агент берёт контекст только тех продуктов, которые включены для платформы.')}
    </div>
    ${field('Что это (1–3 предложения)', html`<textarea name="summary" placeholder="Сервис eSIM для путешествий: профиль ставится дома, интернет есть сразу после посадки…">${p?.summary ?? ''}</textarea>`)}
    ${field('Для кого', html`<textarea name="audience" style="min-height:56px">${p?.audience ?? ''}</textarea>`)}
    ${field('Факты, которые можно называть', html`<textarea name="facts" rows="7" class="mono">${p?.facts ?? ''}</textarea>`, 'Страны, оплата, как работает, что важно знать. Агент не выдумывает ничего сверх этого списка. Цены сюда тоже — но в первые комментарии они не попадают.')}
    ${field('Ссылки', html`<textarea name="links" style="min-height:56px" class="mono" placeholder="esimrules.com | https://esimrules.com/?utm_source=x&utm_medium=comment">${(p?.links ?? []).map((l: any) => `${l.label} | ${l.url}`).join('\n')}</textarea>`, 'По одной в строке: название | url. На X ссылки живут только в профиле; в Threads они попадают в комментарии с заданной долей.')}
    ${field('Поисковые запросы этого продукта', html`<textarea name="queries" rows="6" class="mono" placeholder="which esim&#10;esim for japan&#10;roaming charges">${(p?.queries ?? []).join('\n')}</textarea>`, 'По одному в строке. Если пусто, берётся общий список платформы (Настройки → X / Threads). Каждый продукт ищется по своим запросам, так на одной площадке живут несколько продуктов.')}
    <div class="grid g2">
      ${field('Языки', html`<input type="text" name="languages" value="${(p?.languages ?? []).join(', ')}" placeholder="pt, es">`, 'ISO-коды через запятую.')}
      ${field('Активен', html`<select name="active"><option value="1" ${p?.active !== 0 ? 'selected' : ''}>да</option><option value="0" ${p?.active === 0 ? 'selected' : ''}>нет</option></select>`)}
    </div>
    ${field('Голос автора', html`<textarea name="voice" style="min-height:56px" placeholder="Спокойный, конкретный, без восклицаний. На «ты», если автор пишет неформально.">${p?.voice ?? ''}</textarea>`, 'Как человек обычно пишет: тон, длина, обращение.')}
    ${field('Как упоминать продукт', html`<textarea name="mention_rules" style="min-height:56px">${p?.mention_rules ?? ''}</textarea>`, 'Например: одной фразой «я сам делаю eSIM для поездок», только если тема касается связи.')}
    ${field('Чего никогда не писать', html`<textarea name="never" style="min-height:56px">${p?.never ?? ''}</textarea>`)}
    <div class="row"><button class="btn primary">${isNew ? 'Добавить продукт' : 'Сохранить'}</button>${p?.id ? html`<button formaction="/api/products/${p.id}/delete" class="btn danger" onclick="return confirm('Удалить продукт?')">Удалить</button>` : ''}</div>
  </form>`;
}
function productTab() {
  const ps = listProducts();
  return html`<p class="sub">Контекст для агента: что продаём, кому и какие факты можно называть. Всё, чего здесь нет, агент не придумает.</p>
  <div class="stack">${ps.map(productForm)}
  <details ${ps.length ? '' : 'open'}><summary>Добавить ещё один продукт</summary>${productForm(null)}</details></div>`;
}
settings.post('/api/products/:id', async (c) => {
  const f = await c.req.parseBody({ all: true });
  const idp = c.req.param('id');
  const s = (k: string) => String((Array.isArray(f[k]) ? (f[k] as any)[0] : f[k]) ?? '');
  const links = s('links').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [label, url] = l.split('|').map((x) => x.trim()); return { label: label || url, url: url || label }; });
  const languages = s('languages').split(',').map((x) => x.trim()).filter(Boolean);
  const platforms = ([] as string[]).concat((f.platforms as any) ?? []).map(String);
  const queries = s('queries').split('\n').map((x) => x.trim()).filter(Boolean);
  saveProduct({ id: idp === 'new' ? undefined : Number(idp), name: s('name') || 'Продукт', summary: s('summary'), audience: s('audience'), facts: s('facts'), links, languages, platforms, queries, voice: s('voice'), mention_rules: s('mention_rules'), never: s('never'), active: Number(s('active') || 1) });
  return c.redirect('/settings?tab=product&ok=Продукт сохранён');
});
settings.post('/api/products/:id/delete', (c) => { deleteProduct(Number(c.req.param('id'))); return c.redirect('/settings?tab=product&ok=Продукт удалён'); });

// ---------- Platform
function platformForm(p: string, cfg: PlatformConfig) {
  const stop = all('SELECT author FROM stop_authors WHERE platform = ?', p).map((r) => r.author).join('\n');
  const isX = p === 'x';
  const num = (name: string, value: number, extra = '') => html`<input type="number" name="${name}" value="${value}" ${extra}>`;
  return html`<form method="post" action="/api/platforms/${p}" class="card">
    <div class="section">
      <div class="row between"><div>${toggle('enabled', `${platformName(p)} включён`, cfg.enabled)}</div></div>
      ${field('Режим', segmented('mode', cfg.mode, (Object.keys(MODES) as Mode[]).map((m) => [m, MODES[m].label])), (Object.keys(MODES) as Mode[]).map((m) => `${MODES[m].label} — ${MODES[m].hint}`).join(' '))}
      ${isX ? '' : field('Ваш ник в Threads', html`<input type="text" name="handle" value="${cfg.handle}" placeholder="yourname">`, 'Без @. Нужен, чтобы проверять вход и считать статистику ответов.')}
    </div>
    <div class="section"><h3>Сколько и когда</h3>
      <div class="grid g3">
        ${field('Комментариев в день', num('daily_limit', cfg.daily_limit, 'min="0"'), isX ? 'Новый аккаунт: 3–4. Обжитый: до 8.' : 'Только комментарии com-factory. Рутина Aside считается отдельно (потолок ниже).')}
        ${field('За один запуск', num('per_run_limit', cfg.per_run_limit, 'min="0"'))}
        ${field('Пауза между комментариями, мин', num('min_gap_minutes', cfg.min_gap_minutes, 'min="0"'))}
      </div>
      ${isX ? '' : html`<div class="grid g2">
        ${field('Потолок на аккаунт в день', num('account_daily_cap', cfg.account_daily_cap, 'min="0"'), 'Все комментарии аккаунта за день, включая рутину Aside. 0 — без потолка.')}
        ${field('Память рутины Aside (MEMORY.md)', html`<input type="text" name="memory_import_path" value="${cfg.memory_import_path}" placeholder="/Users/you/.aside/u/0/memory/routines/<id>/MEMORY.md">`, 'Импортируется раз в час: авторы и посты рутины не получат второй комментарий от com-factory.')}
      </div>`}
      <div class="grid g3">
        ${field('Активные часы: с', num('hours_start', cfg.active_hours.start, 'min="0" max="23"'))}
        ${field('до', num('hours_end', cfg.active_hours.end, 'min="1" max="24"'))}
        ${field('Часовой пояс', html`<select name="tz">${[...new Set([cfg.active_hours.tz, ...TZS])].map((z) => html`<option ${z === cfg.active_hours.tz ? 'selected' : ''}>${z}</option>`)}</select>`, 'Пояс аудитории, а не ваш.')}
      </div>
      ${isX
        ? field('Искать новые посты каждые, мин', num('run_every_minutes', cfg.run_every_minutes, 'min="0"'), 'Каждый поиск — 4 запроса. 15 мин = безопасно для лимитов X.')
        : field('Время запусков', html`<input type="text" name="schedule_times" value="${cfg.schedule_times.join(', ')}" placeholder="11:00, 19:00">`, 'Через запятую, по часовому поясу выше. За запуск: импорт памяти рутины, входящие, поиск, черновики, публикация. Ставьте не в те же минуты, что рутина Aside.')}
    </div>
    <div class="section"><h3>Что искать</h3>
      ${field('Поисковые запросы', html`<textarea name="queries" rows="8" class="mono">${cfg.queries.join('\n')}</textarea>`, isX ? 'По одному в строке. Запросы чередуются по кругу; фильтр по языку добавляется сам. Короткие точные фразы работают лучше длинных.' : 'По одному в строке. За запуск берётся 5–6 запросов по кругу.')}
      ${isX
        ? field('Исключать слова', html`<input type="text" name="negative_terms" value="${cfg.negative_terms.join(', ')}">`, 'Через запятую: реклама, купоны, конкуренты. Срезает мусор до оценки.')
        : field('Ветки-знакомства', html`<textarea name="intro_queries" rows="3" class="mono">${cfg.intro_queries.join('\n')}</textarea>`, 'Посты, где люди представляются. Заходим туда не чаще, чем раз в N дней (ниже).')}
      <div class="grid g3">
        ${field('Языки', html`<input type="text" name="languages" value="${cfg.languages.join(', ')}">`, 'ISO-коды. Посты на других языках пропускаются.')}
        ${field('Пост не старше, часов', num('max_age_hours', Math.round(cfg.max_age_minutes / 60), 'min="1"'), isX ? 'Живых вопросов про eSIM мало, поэтому окно в днях. Свежие всё равно идут первыми.' : 'Свежие посты идут первыми.')}
        ${isX ? field('Минимум подписчиков у автора', num('min_followers', cfg.min_followers, 'min="0"'), 'Отсекает пустые и свежесозданные аккаунты.') : field('Ветка-знакомство раз в N дней', num('selfpromo_every_days', cfg.selfpromo_every_days, 'min="0"'), '0 — никогда.')}
      </div>
    </div>
    <div class="section"><h3>Как писать</h3>
      <div class="grid g3">
        ${field('Упоминать продукт, % комментариев', num('product_mention_pct', Math.round(cfg.product_mention_ratio * 100), 'min="0" max="100"'), 'Остальные — чистая польза без продукта. Так аккаунт не выглядит продающим.')}
        ${field('Не повторять автора, дней', num('author_cooldown_days', cfg.author_cooldown_days, 'min="0"'))}
      </div>
      ${toggle('like_post', 'Лайкать пост перед ответом', cfg.like_post)}
      ${isX ? '' : toggle('prices_allowed', 'Разрешить цены в первом комментарии', cfg.prices_allowed, 'В ответах на входящие вопросы про тариф цены разрешены всегда.')}
      ${isX ? '' : html`<div class="grid g2">${toggle('inbound_reply', 'Отвечать на входящие', cfg.inbound_reply, 'Вопросы и интерес под нашими комментариями.')}${field('Ответов на входящие за запуск', num('inbound_limit', cfg.inbound_limit, 'min="0"'))}</div>`}
      ${field('Стоп-лист авторов', html`<textarea name="stop_authors" rows="3" class="mono" placeholder="по одному нику в строке">${stop}</textarea>`, 'Им не отвечаем никогда.')}
    </div>
    <div class="section"><h3>Ссылки в комментариях</h3>
      ${toggle('links_enabled', 'Добавлять ссылку в комментарии', cfg.links_enabled, isX ? 'На X ссылки в ответах режут охват и выглядят как спам; обычно продукт находят через ссылку в профиле.' : 'Ссылка попадает только в комментарии с упоминанием продукта и не чаще заданной доли. Ссылки продукта берутся из Настройки → Продукт.')}
      <div class="grid g2">
        ${field('UTM для этой площадки', html`<input type="text" name="utm" value="${cfg.utm}" placeholder="utm_source=${p}&utm_medium=comment">`, 'Подставляется в каждую ссылку автоматически, даже если модель её забыла; чужие utm_* заменяются.')}
        ${field('Ссылка, % комментариев', num('link_pct', Math.round(cfg.link_ratio * 100), 'min="0" max="100"'), 'Доля комментариев со ссылкой среди последних восьми.')}
      </div>
      ${field('Дополнительные ссылки площадки', html`<textarea name="links" style="min-height:56px" class="mono" placeholder="Страница для этой аудитории | https://example.com/page/">${(cfg.links ?? []).map((l) => `${l.label} | ${l.url}`).join('\n')}</textarea>`, 'По одной в строке: название | url. Только для этой площадки, в дополнение к ссылкам продукта. UTM добавится сам.')}
    </div>
    <div class="section"><details><summary>Расширенные</summary>
      <div class="grid g4" style="margin-top:12px">
        ${field('Релевантность, от', html`<input type="number" name="min_relevance" step="0.05" min="0" max="1" value="${cfg.min_relevance}">`, 'Jev, 0–1: насколько пост по теме. Ниже — больше кандидатов.')}
        ${field('Польза ответа, от', html`<input type="number" name="min_fit" step="0.1" min="0" max="3" value="${cfg.min_fit}">`, 'Jev, 0–3: 1 — слабый повод, 2 — хороший, 3 — отличный.')}
        ${field('Риск, до', html`<input type="number" name="max_risk" step="0.05" min="0" max="1" value="${cfg.max_risk}">`, 'Jev, 0–1: политика, трагедии, бренды, боты. Выше — терпимее.')}
        ${field('Обновлять метрики каждые, мин', num('stats_every_minutes', cfg.stats_every_minutes, 'min="0"'), '0 — не собирать.')}
      </div></details></div>
    <div class="savebar"><button class="btn primary">Сохранить</button><button formaction="/api/platforms/${p}/reset" class="btn" onclick="return confirm('Вернуть значения по умолчанию?')">Сбросить к умолчаниям</button>
      ${activeBlock(p) ? html`<form class="inline" method="post" action="/api/platforms/${p}/resume"><button class="btn">Снять паузу</button></form>` : html`<form class="inline" method="post" action="/api/platforms/${p}/pause"><button class="btn">Пауза на 24 ч</button></form>`}
    </div>
  </form>`;
}
settings.post('/api/platforms/:p', async (c) => {
  const p = c.req.param('p');
  if (!(PLATFORMS as readonly string[]).includes(p)) return c.text('unknown platform', 404);
  const f = await c.req.parseBody();
  const num = (k: string) => (f[k] === undefined || f[k] === '' ? undefined : Number(f[k]));
  const list = (k: string, sep: RegExp) => (f[k] === undefined ? undefined : String(f[k]).split(sep).map((s) => s.trim()).filter(Boolean));
  const bool = (k: string) => f[k] === '1';
  const patch: Partial<PlatformConfig> = {
    enabled: bool('enabled'), like_post: bool('like_post'), links_enabled: bool('links_enabled'),
    utm: f.utm === undefined ? undefined : String(f.utm).trim().replace(/^\?/, ''),
    links: f.links === undefined ? undefined : String(f.links).split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [label, url] = l.split('|').map((x) => x.trim()); return { label: label || url, url: url || label }; }),
    mode: f.mode ? (String(f.mode) as Mode) : undefined,
    handle: f.handle === undefined ? undefined : String(f.handle).trim().replace(/^@/, ''),
    daily_limit: num('daily_limit'), per_run_limit: num('per_run_limit'), min_gap_minutes: num('min_gap_minutes'),
    run_every_minutes: num('run_every_minutes'), min_followers: num('min_followers'), selfpromo_every_days: num('selfpromo_every_days'),
    author_cooldown_days: num('author_cooldown_days'), inbound_limit: num('inbound_limit'), account_daily_cap: num('account_daily_cap'),
    memory_import_path: f.memory_import_path === undefined ? undefined : String(f.memory_import_path).trim(),
    min_relevance: num('min_relevance'), min_fit: num('min_fit'), max_risk: num('max_risk'), stats_every_minutes: num('stats_every_minutes'),
    languages: list('languages', /,/), queries: list('queries', /\n/), intro_queries: list('intro_queries', /\n/), negative_terms: list('negative_terms', /,/), schedule_times: list('schedule_times', /,/),
  };
  if (num('max_age_hours') !== undefined) patch.max_age_minutes = Math.max(1, num('max_age_hours')!) * 60;
  if (num('product_mention_pct') !== undefined) patch.product_mention_ratio = Math.min(100, Math.max(0, num('product_mention_pct')!)) / 100;
  if (num('link_pct') !== undefined) patch.link_ratio = Math.min(100, Math.max(0, num('link_pct')!)) / 100;
  if (p === 'threads') { patch.prices_allowed = bool('prices_allowed'); patch.inbound_reply = bool('inbound_reply'); }
  if (f.hours_start !== undefined || f.tz !== undefined) {
    const cur = platformConfig(p).active_hours;
    patch.active_hours = { start: num('hours_start') ?? cur.start, end: num('hours_end') ?? cur.end, tz: String(f.tz || cur.tz) };
  }
  for (const k of Object.keys(patch)) if ((patch as any)[k] === undefined) delete (patch as any)[k];
  savePlatformConfig(p, patch);
  if (f.stop_authors !== undefined) {
    run('DELETE FROM stop_authors WHERE platform = ?', p);
    for (const a of String(f.stop_authors).split('\n').map((s) => s.trim().replace(/^@/, '')).filter(Boolean)) run('INSERT OR IGNORE INTO stop_authors(platform, author) VALUES(?, ?)', p, a);
  }
  return c.redirect(`/settings?tab=${p}&ok=Настройки ${platformName(p)} сохранены`);
});
settings.post('/api/platforms/:p/reset', (c) => { const p = c.req.param('p'); setSetting(`platform:${p}`, {}); return c.redirect(`/settings?tab=${p}&ok=Сброшено к умолчаниям`); });
settings.post('/api/platforms/:p/pause', (c) => { const p = c.req.param('p'); block(p, 24, 'пауза вручную'); return c.redirect(`${c.req.header('referer')?.includes('/settings') ? '/settings?tab=' + p + '&' : '/?'}ok=${platformName(p)}: пауза на 24 часа`); });
settings.post('/api/platforms/:p/resume', (c) => { const p = c.req.param('p'); unblock(p); return c.redirect(`${c.req.header('referer')?.includes('/settings') ? '/settings?tab=' + p + '&' : '/?'}ok=${platformName(p)}: пауза снята`); });

// ---------- System
function systemTab() {
  const m = models();
  const d = lastDoctor();
  return html`<div class="stack">
  <form method="post" action="/api/models" class="card"><h2>Модели</h2>
    <p class="small muted" style="margin:-6px 0 14px">Отбор постов делает Jev через OpenRouter. Все тексты (комментарии, ответы, голосовые команды) пишет модель, подключённая к Aside, без сторонних LLM.</p>
    <div class="grid g4">
      ${field('Отбор постов (Jev, OpenRouter)', html`<input type="text" name="jev" value="${m.jev}">`, 'Быстрые решения: релевантность, тип, риск.')}
      ${field('Провайдер в Aside', html`<input type="text" name="text_provider" value="${m.text_provider}">`, 'Как в Aside → Settings → Models, например claude-code или anthropic.')}
      ${field('Модель', html`<input type="text" name="text_model" value="${m.text_model}">`, 'Например claude-opus-5.')}
      ${field('Глубина размышления', html`<select name="text_effort">${EFFORTS.map((e) => html`<option ${e === m.text_effort ? 'selected' : ''}>${e}</option>`)}</select>`, 'low хватает для коротких комментариев.')}
    </div>
    <button class="btn primary">Сохранить</button></form>
  <div class="card"><div class="row between"><h2 style="margin:0">Проверка окружения</h2><form method="post" action="/api/doctor"><button class="btn sm">Проверить сейчас</button></form></div>
    ${d ? html`<div class="small muted" style="margin:6px 0 10px">Последняя проверка: ${fmtDate(new Date(d.at).toISOString())} UTC</div><pre>${d.lines.join('\n')}</pre>` : html`<p class="muted">Ещё не запускалась.</p>`}
  </div>
  <div class="card"><h2>Окружение</h2>
    <table><tr><td class="muted">Панель</td><td class="mono">${PANEL_URL}</td></tr><tr><td class="muted">Ключ OpenRouter</td><td>${env.openrouterKey ? html`<span class="ok">задан</span>` : html`<span class="bad">не задан</span>`} <span class="muted small">(файл .env)</span></td></tr><tr><td class="muted">Aside CLI</td><td class="mono">${env.asideBin}</td></tr><tr><td class="muted">Таймзона сервера</td><td class="mono">${env.tz}</td></tr></table>
    <p class="small muted" style="margin:12px 0 0">Команды в папке проекта: <span class="mono">npm run doctor</span> — проверка; <span class="mono">npm run cf x:tick</span> — поиск, черновики и публикация одобренного; <span class="mono">npm run cf threads:import &lt;MEMORY.md&gt;</span> — импорт истории Threads из рутины Aside.</p>
  </div></div>`;
}
settings.post('/api/models', async (c) => { const f = await c.req.parseBody(); setSetting('models', { jev: String(f.jev).trim(), text_provider: String(f.text_provider).trim(), text_model: String(f.text_model).trim(), text_effort: EFFORTS.includes(String(f.text_effort)) ? String(f.text_effort) : 'low' }); return c.redirect('/settings?tab=system&ok=Модели сохранены'); });

settings.get('/settings', (c) => {
  const tab = c.req.query('tab') || 'product';
  const body = tab === 'x' || tab === 'threads' ? platformForm(tab, platformConfig(tab)) : tab === 'system' ? systemTab() : productTab();
  return c.html(layout('Настройки', '/settings', html`<h1>Настройки</h1><p class="sub">Продукт, лимиты по платформам и модели. Любое поле можно поменять голосом или текстом в строке сверху.</p>${tabs(tab)}${body}`, { flash: flashOf(c), queue: queueCount() }));
});
