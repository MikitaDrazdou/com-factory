import { html, raw } from 'hono/html';

export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

// One palette, light and dark. Surfaces are separated by tone and a soft shadow, not by borders.
const CSS = `
:root{--bg:#f4f4f6;--panel:#fff;--fg:#1a1b1f;--muted:#71757e;--faint:#a3a7af;--line:#ececef;--soft:#f3f3f5;--soft2:#e8e9ec;--accent:#1a1b1f;--accent-fg:#fff;--ok:#1f9d55;--ok-bg:#e7f6ed;--warn:#b8700a;--warn-bg:#fdf2df;--bad:#d4382f;--bad-bg:#fdeae8;--info:#2f6fed;--r:16px;--rs:10px;--shadow:0 1px 2px rgba(16,18,24,.04),0 12px 32px -20px rgba(16,18,24,.22)}
@media(prefers-color-scheme:dark){:root{--bg:#0d0e11;--panel:#17181c;--fg:#f2f3f5;--muted:#9a9ea8;--faint:#666a73;--line:#24262c;--soft:#1f2126;--soft2:#292c33;--accent:#f2f3f5;--accent-fg:#141518;--ok:#3ccf7a;--ok-bg:#15291e;--warn:#e3a33a;--warn-bg:#2c2313;--bad:#ef6a62;--bad-bg:#2f1917;--info:#79a6ff;--shadow:0 1px 2px rgba(0,0,0,.35),0 14px 36px -20px rgba(0,0,0,.7)}}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.55 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
a{color:inherit;text-decoration:none}a:hover{text-decoration:underline}
.shell{display:grid;grid-template-columns:232px minmax(0,1fr);min-height:100vh}
.side{position:sticky;top:0;height:100vh;padding:26px 14px;display:flex;flex-direction:column;gap:2px}
.brand{display:flex;align-items:center;gap:10px;font-weight:600;font-size:15px;padding:4px 12px 22px;letter-spacing:-.01em;line-height:1.15}
.brand .logo{width:28px;height:28px;flex:none;border-radius:9px;background:var(--accent);color:var(--accent-fg);display:inline-flex;align-items:center;justify-content:center}
.brand .logo svg{width:16px;height:16px}
.brand small{display:block;font-size:11px;font-weight:500;color:var(--faint);letter-spacing:.02em}
.side a{display:flex;align-items:center;gap:11px;padding:9px 12px;border-radius:var(--rs);color:var(--muted);font-weight:500;transition:background .15s,color .15s}
.side a:hover{background:var(--soft2);color:var(--fg);text-decoration:none}
.side a.active{background:var(--panel);color:var(--fg);box-shadow:var(--shadow)}
.side svg{width:17px;height:17px;flex:none}
.badge{margin-left:auto;background:var(--accent);color:var(--accent-fg);font-size:11px;font-weight:600;padding:1px 7px;border-radius:999px;line-height:16px}
.side .foot{margin-top:auto;font-size:12px;color:var(--faint);padding:10px 12px}
main{padding:30px 40px 80px;max-width:1060px;width:100%}
h1{font-size:24px;font-weight:600;letter-spacing:-.02em;margin:0 0 4px}h2{font-size:15px;font-weight:600;margin:0 0 12px;letter-spacing:-.01em}h3{font-size:12px;font-weight:600;margin:0 0 12px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
.sub{color:var(--muted);margin:0 0 22px}
.card{background:var(--panel);border-radius:var(--r);padding:20px 22px;box-shadow:var(--shadow)}
.grid{display:grid;gap:16px}.g2{grid-template-columns:repeat(2,minmax(0,1fr))}.g3{grid-template-columns:repeat(3,minmax(0,1fr))}.g4{grid-template-columns:repeat(4,minmax(0,1fr))}
.stack>*+*{margin-top:16px}.mt{margin-top:16px}
.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.between{justify-content:space-between}.top{align-items:flex-start}
.muted{color:var(--muted)}.faint{color:var(--faint)}.small{font-size:12.5px}.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
.ok{color:var(--ok)}.warn{color:var(--warn)}.bad{color:var(--bad)}
.chip{display:inline-flex;align-items:center;gap:7px;padding:3px 10px 3px 9px;border-radius:999px;font-size:12px;font-weight:500;background:var(--soft);color:var(--muted);white-space:nowrap;line-height:18px}
.chip:before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor;flex:none}
.chip.ok{background:var(--ok-bg);color:var(--ok)}.chip.warn{background:var(--warn-bg);color:var(--warn)}.chip.bad{background:var(--bad-bg);color:var(--bad)}
a.chip:hover{text-decoration:none;filter:brightness(.96)}
.pill{display:inline-block;background:var(--soft);border-radius:999px;padding:2px 9px;font-size:12px;white-space:nowrap;color:var(--muted);line-height:18px}
.big{font-size:34px;font-weight:600;letter-spacing:-.03em;line-height:1}.big small{font-size:14px;font-weight:400;color:var(--muted);letter-spacing:0;margin-left:5px}
.lbl{font-size:12px;color:var(--muted);margin-top:7px}
.bar{height:6px;border-radius:999px;background:var(--soft2);overflow:hidden;margin-top:12px;width:160px}.bar i{display:block;height:100%;border-radius:999px;background:var(--fg)}
.btn{display:inline-flex;align-items:center;gap:6px;border:0;background:var(--soft);color:var(--fg);padding:8px 14px;border-radius:var(--rs);cursor:pointer;font:inherit;font-weight:500;line-height:1.2;transition:background .15s,transform .05s}
.btn:hover{background:var(--soft2);text-decoration:none}.btn:active{transform:translateY(1px)}
.btn.primary{background:var(--accent);color:var(--accent-fg)}.btn.primary:hover{opacity:.9;background:var(--accent)}
.btn.ghost{background:transparent;color:var(--muted)}.btn.ghost:hover{background:var(--soft);color:var(--fg)}
.btn.danger{color:var(--bad)}.btn.danger:hover{background:var(--bad-bg)}.btn.sm{padding:6px 11px;font-size:12.5px}.btn:disabled{opacity:.5;cursor:default}
form.inline{display:inline}
.field{margin:0 0 16px}.field label.t{display:block;font-weight:500;font-size:13px;margin-bottom:6px}
.hint{color:var(--muted);font-size:12px;margin-top:5px;line-height:1.45}
input[type=text],input[type=number],input[type=time],select,textarea{width:100%;padding:9px 12px;border:1px solid transparent;border-radius:var(--rs);background:var(--soft);color:var(--fg);font:inherit;transition:background .15s,box-shadow .15s}
input[type=text]:hover,input[type=number]:hover,select:hover,textarea:hover{background:var(--soft2)}
input:focus,select:focus,textarea:focus{outline:0;background:var(--panel);box-shadow:0 0 0 2px var(--info)}
textarea{min-height:88px;resize:vertical;line-height:1.5}textarea.mono{font-size:12.5px}
.seg{display:inline-flex;background:var(--soft);border-radius:var(--rs);padding:3px;gap:2px}.seg label{position:relative}.seg input{position:absolute;opacity:0;width:0;height:0}
.seg span{display:block;padding:6px 13px;border-radius:8px;cursor:pointer;font-size:13px;color:var(--muted);transition:.15s}.seg input:checked+span{background:var(--panel);box-shadow:0 1px 3px rgba(0,0,0,.12);color:var(--fg);font-weight:500}
.switch{display:inline-flex;align-items:center;gap:10px;cursor:pointer;font-weight:500;font-size:13px}.switch input{position:absolute;opacity:0;width:0;height:0}
.switch .tr{width:38px;height:22px;border-radius:999px;background:var(--soft2);position:relative;transition:.2s;flex:none}.switch .tr:after{content:"";position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#fff;transition:.2s;box-shadow:0 1px 3px rgba(0,0,0,.25)}
.switch input:checked+.tr{background:var(--ok)}.switch input:checked+.tr:after{transform:translateX(16px)}
.tabs{display:flex;width:max-content;max-width:100%;gap:2px;background:var(--soft2);border-radius:var(--rs);padding:3px;margin:0 0 20px}.tabs a{padding:6px 14px;border-radius:8px;color:var(--muted);font-weight:500;font-size:13px;transition:.15s;white-space:nowrap}.tabs a.active{background:var(--panel);color:var(--fg);box-shadow:0 1px 3px rgba(0,0,0,.1)}.tabs a:hover{text-decoration:none;color:var(--fg)}
.list{margin:0;padding:0;list-style:none}.list>li{display:flex;gap:14px;align-items:flex-start;padding:12px 0;border-top:1px solid var(--line)}.list>li:first-child{border-top:0;padding-top:2px}.list>li:last-child{padding-bottom:2px}
.list .when{flex:none;width:96px;color:var(--faint);font-size:12.5px;padding-top:2px}.list .body{min-width:0;flex:1;overflow-wrap:anywhere}.list .meta{color:var(--muted);font-size:12.5px;margin-bottom:3px;display:flex;gap:8px;flex-wrap:wrap;align-items:center}.list .side-note{flex:none;color:var(--faint);font-size:12.5px;padding-top:2px;white-space:nowrap}
.list.rows>li{align-items:center;padding:9px 0}
.quote{white-space:pre-wrap;background:var(--soft);border-radius:12px;padding:12px 14px;margin:10px 0;line-height:1.5;overflow-wrap:anywhere}
.flash{background:var(--ok-bg);color:var(--ok);border-radius:12px;padding:10px 14px;margin:0 0 18px;font-size:13px;font-weight:500}
.bars{display:flex;align-items:flex-end;gap:5px;height:96px}.bars .b{flex:1;display:flex;flex-direction:column;justify-content:flex-end;gap:2px;min-width:6px;border-radius:5px;padding:0 1px;transition:background .15s}.bars .b:hover{background:var(--soft)}
.bars .b i{display:block;border-radius:3px}.bars .b i.x{background:var(--fg)}.bars .b i.t{background:var(--faint)}
.axis{display:flex;justify-content:space-between;font-size:11.5px;color:var(--faint);margin-top:8px}
.legend i{display:inline-block;width:8px;height:8px;border-radius:2px;margin:0 5px 0 10px}
.check ul{padding:0;margin:0;list-style:none}.check li{display:flex;gap:12px;padding:9px 0;align-items:flex-start}.check li+li{border-top:1px solid var(--line)}
.check .ic{flex:none;width:20px;height:20px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:12px;background:var(--soft2);color:transparent;margin-top:1px}.check .done .ic{background:var(--ok);color:#fff}.check .done>div{color:var(--muted)}
details>summary{cursor:pointer;color:var(--muted);font-weight:500;margin:6px 0;list-style:none;display:inline-flex;align-items:center;gap:8px;font-size:13px}details>summary::-webkit-details-marker{display:none}details>summary:before{content:"";width:6px;height:6px;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:rotate(-45deg);transition:.15s}details[open]>summary:before{transform:rotate(45deg)}
.cmd{display:flex;align-items:center;gap:6px;margin:0 0 24px;background:var(--panel);border-radius:14px;padding:5px 5px 5px 16px;box-shadow:var(--shadow)}
.cmd input{flex:1;border:0;background:transparent;padding:8px 0;font:inherit;color:var(--fg);min-width:0}.cmd input:focus,.cmd input:hover{outline:0;box-shadow:none;background:transparent}
.cmd .mic{width:36px;height:36px;border-radius:10px;flex:none;display:inline-flex;align-items:center;justify-content:center;padding:0}
.cmd .mic.rec{background:var(--bad);color:#fff}
#cmd-out{margin:-12px 0 24px}#cmd-out .chg{font-family:ui-monospace,Menlo,monospace;font-size:12px;background:var(--soft);padding:10px 12px;border-radius:10px;margin:10px 0;white-space:pre-wrap}
.savebar{position:sticky;bottom:0;background:var(--panel);margin:18px -22px -20px;padding:14px 22px;border-radius:0 0 var(--r) var(--r);display:flex;gap:10px;align-items:center;border-top:1px solid var(--line)}
.section{padding:18px 0}.section+.section{border-top:1px solid var(--line)}.section:first-child{padding-top:0}
pre{white-space:pre-wrap;word-break:break-word;background:var(--soft);padding:14px;border-radius:12px;font-size:12px;max-height:460px;overflow:auto;line-height:1.5;margin:0}
.empty{color:var(--muted);text-align:center;padding:26px 0}
.kv{display:grid;grid-template-columns:1fr auto;gap:7px 16px;font-size:13px;align-items:baseline}.kv span{color:var(--muted)}.kv b{font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap}
.kv .sec{grid-column:1/-1;font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-top:6px}
table{width:100%;border-collapse:collapse}th{font-size:12px;color:var(--muted);font-weight:500;text-align:left;padding:4px 10px 8px;border-bottom:1px solid var(--line)}
td{padding:10px;border-top:1px solid var(--line);vertical-align:top}tr:first-child td{border-top:0}
@media(max-width:860px){.shell{grid-template-columns:1fr}.side{position:static;height:auto;flex-direction:row;flex-wrap:wrap;padding:10px 12px 6px}.brand{padding:6px 10px 8px;width:100%}.side .foot{display:none}.badge{margin-left:4px}main{padding:16px 16px 60px}.g2,.g3,.g4{grid-template-columns:1fr}.savebar{margin:18px -16px -16px;padding:12px 16px}.list .when{width:70px}.card{padding:16px}}
`;

const JS = `
(function(){
  const inp=document.getElementById('cmd-in'),mic=document.getElementById('cmd-mic'),form=document.getElementById('cmd'),out=document.getElementById('cmd-out');
  if(!form)return;const SR=window.SpeechRecognition||window.webkitSpeechRecognition;let rec=null,pending=null;
  const e=s=>String(s==null?'':s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
  function show(h){out.innerHTML='<div class="card">'+h+'</div>';}
  function describe(ch){const t=ch.target||'';const p=ch.patch;if(Array.isArray(p))return t+': '+p.join(', ');if(p&&typeof p==='object')return t+'\\n'+Object.entries(p).map(([k,v])=>'  '+k+' → '+(typeof v==='object'?JSON.stringify(v):v)).join('\\n');return t+': '+JSON.stringify(p);}
  async function send(t){show('<span class="muted">Разбираю: «'+e(t)+'»…</span>');
    const r=await fetch('/api/voice',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({transcript:t,page:location.pathname})});
    const d=await r.json();pending=d;let h='<div><b>'+e(d.summary)+'</b></div>';
    if(d.changes&&d.changes.length){h+='<div class="chg">'+e(d.changes.map(describe).join('\\n\\n'))+'</div><div class="row"><button class="btn primary" id="v-apply">Применить</button><button class="btn" id="v-close">Отмена</button></div>';}
    else h+='<div class="row" style="margin-top:8px"><button class="btn" id="v-close">Закрыть</button></div>';
    show(h);document.getElementById('v-close').onclick=()=>{out.innerHTML='';};
    const a=document.getElementById('v-apply');if(a)a.onclick=async()=>{a.disabled=true;const rr=await fetch('/api/voice/apply',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(pending)});const dd=await rr.json();show('<span class="ok">'+e(dd.message||'Применено')+'</span>');setTimeout(()=>location.reload(),700);};}
  form.onsubmit=ev=>{ev.preventDefault();const t=inp.value.trim();if(t){send(t);inp.value='';}};
  mic.onclick=()=>{if(!SR){inp.focus();inp.placeholder='Голос недоступен в этом браузере — напишите команду';return;}
    if(rec){rec.stop();return;}rec=new SR();rec.lang='ru-RU';rec.interimResults=false;rec.maxAlternatives=1;mic.classList.add('rec');inp.placeholder='Слушаю…';
    rec.onresult=x=>{const t=x.results[0][0].transcript;inp.value=t;send(t);};rec.onerror=x=>{show('<span class="bad">Ошибка распознавания: '+e(x.error)+'</span>');};
    rec.onend=()=>{mic.classList.remove('rec');rec=null;inp.placeholder='Скажите или напишите, что изменить…';};rec.start();};
})();`;

const ICONS: Record<string, string> = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-8 9 8v9a2 2 0 0 1-2 2h-4v-6H9v6H5a2 2 0 0 1-2-2z"/></svg>',
  inbox: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5h13l3.5 7v7H2v-7z"/></svg>',
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  sliders: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/></svg>',
  list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>',
  mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8"/></svg>',
  // Speech bubble with a spark: comments that are made, not just posted.
  logo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.5a7.5 7.5 0 0 1-7.5 7.5H9l-5 3v-4.6A7.5 7.5 0 0 1 10.5 4h3A7.5 7.5 0 0 1 21 12.5z"/><path d="M12 8.5v2.2l1.8 1.1"/><path d="M12 8.5 10.2 9.6"/></svg>',
};
export const APP_NAME = 'Comments Factory';
const FAVICON = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="9" fill="#1a1b1f"/><g transform="translate(4 4)" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.5a7.5 7.5 0 0 1-7.5 7.5H9l-5 3v-4.6A7.5 7.5 0 0 1 10.5 4h3A7.5 7.5 0 0 1 21 12.5z"/><path d="M12 8.5v2.2l1.8 1.1"/><path d="M12 8.5 10.2 9.6"/></g></svg>');

export interface LayoutOpts { flash?: string; queue?: number; version?: string }

export function layout(title: string, active: string, body: unknown, opts: LayoutOpts = {}) {
  const nav: [string, string, string][] = [['/', 'Обзор', 'home'], ['/queue', 'Очередь', 'inbox'], ['/comments', 'Комментарии', 'chat'], ['/settings', 'Настройки', 'sliders'], ['/runs', 'Журнал', 'list']];
  return html`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · ${APP_NAME}</title><link rel="icon" href="${FAVICON}"><style>${raw(CSS)}</style></head>
<body><div class="shell"><aside class="side"><div class="brand"><span class="logo">${raw(ICONS.logo)}</span><span>${APP_NAME}<small>комментарии, которые помогают</small></span></div>
${nav.map(([h, l, ic]) => html`<a href="${h}" class="${h === active ? 'active' : ''}">${raw(ICONS[ic])}${l}${h === '/queue' && opts.queue ? html`<span class="badge">${opts.queue}</span>` : ''}</a>`)}
<div class="foot">${opts.version ?? ''}</div></aside>
<main>
<form id="cmd" class="cmd" autocomplete="off"><input id="cmd-in" type="text" placeholder="Скажите или напишите, что изменить… например: «поставь для X лимит 6 в день»"><button type="button" id="cmd-mic" class="btn mic" title="Голосовая команда">${raw(ICONS.mic)}</button></form><div id="cmd-out"></div>
${opts.flash ? html`<div class="flash">${opts.flash}</div>` : ''}
${body}
</main></div><script>${raw(JS)}</script></body></html>`;
}

export const fmtDate = (s: unknown) => (s ? String(s).replace('T', ' ').slice(0, 16) : '');
export const fmtN = (n: unknown) => { const v = Number(n) || 0; return v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1) + 'k' : String(v); };
export function fmtRel(s: unknown): string {
  if (!s) return '';
  const t = new Date(String(s).replace(' ', 'T') + (String(s).endsWith('Z') ? '' : 'Z')).getTime();
  if (!t) return String(s);
  const m = Math.round((Date.now() - t) / 60_000);
  if (m < 1) return 'только что';
  if (m < 60) return `${m} мин назад`;
  if (m < 36 * 60) return `${Math.round(m / 60)} ч назад`;
  return `${Math.round(m / 1440)} дн назад`;
}
/** Local date (YYYY-MM-DD) of an SQLite UTC timestamp in a timezone. */
export function localDate(s: string, tz: string): string {
  const d = new Date(String(s).replace(' ', 'T') + 'Z');
  const p: Record<string, string> = {};
  for (const x of new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d)) p[x.type] = x.value;
  return `${p.year}-${p.month}-${p.day}`;
}

const RUN_KIND: Record<string, string> = { discover: 'поиск', draft: 'черновики', post: 'публикация', stats: 'метрики', inbound: 'входящие', run: 'полный цикл', tick: 'цикл', rescore: 'пересчёт Jev', import: 'импорт памяти', doctor: 'проверка' };
const STAT_LABEL: Record<string, string> = { seen: 'просмотрено', added: 'новых', drafts: 'Jev одобрил', skipped: 'пропущено', drafted: 'черновиков', declined: 'отказов модели', posted: 'опубликовано', updated: 'обновлено', imported: 'импортировано', rescored: 'пересчитано', found: 'найдено', ours: 'наших', replied: 'ответов', liked: 'лайков', answered: 'ответов', reason: '' };
export const runKind = (k: string) => RUN_KIND[k] ?? k;
/** Human line out of a run's stats JSON: "просмотрено 80 · новых 3 · Jev одобрил 1". */
export function runSummary(stats: unknown): string {
  let o: Record<string, unknown>;
  try { o = typeof stats === 'string' ? JSON.parse(stats) : (stats as any) ?? {}; } catch { return String(stats ?? ''); }
  const parts: string[] = [];
  for (const [k, v] of Object.entries(o)) {
    if (k === 'cost' || v === undefined || v === null || v === '') continue;
    if (k === 'reason') { if (v) parts.push(String(v)); continue; }
    if (typeof v === 'object') continue;
    parts.push(`${STAT_LABEL[k] ?? k} ${v}`);
  }
  return parts.join(' · ');
}
export const statusChip = (s: string) => html`<span class="chip ${s === 'ok' ? 'ok' : s === 'error' ? 'bad' : 'warn'}">${s === 'ok' ? 'ок' : s === 'error' ? 'ошибка' : s === 'running' ? 'идёт' : s}</span>`;

export const field = (label: string, control: unknown, hint?: string) => html`<div class="field"><label class="t">${label}</label>${control}${hint ? html`<div class="hint">${hint}</div>` : ''}</div>`;
export const toggle = (name: string, label: string, on: boolean, hint?: string) => html`<div class="field"><label class="switch"><input type="checkbox" name="${name}" value="1" ${on ? 'checked' : ''}><span class="tr"></span><span>${label}</span></label>${hint ? html`<div class="hint">${hint}</div>` : ''}</div>`;
export const segmented = (name: string, value: string, options: [string, string][]) => html`<div class="seg">${options.map(([v, l]) => html`<label><input type="radio" name="${name}" value="${v}" ${v === value ? 'checked' : ''}><span>${l}</span></label>`)}</div>`;
