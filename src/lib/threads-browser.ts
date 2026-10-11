// Threads has no API. These builders return JavaScript for Aside's REPL (Playwright-style `page` proxy,
// `openTab`/`closeTab`/`sleep` globals, `emit` injected by lib/aside.ts). Threads' DOM, as of Oct 2026:
// posts live in div[data-pressable-container], the time link carries the canonical /@user/post/ID href,
// icon buttons name themselves through <svg><title>, the reply composer is [role=textbox].

const HELPERS = String.raw`
function cfLab(b){var s=b.querySelector('svg');if(!s)return '';return s.getAttribute('aria-label')||((s.querySelector('title')||{}).textContent||'');}
function cfLogin(){return !!document.querySelector('input[name="username"],input[name="password"]')||/\/login/.test(location.pathname);}
function cfPosts(){var out=[];var seen={};var cs=document.querySelectorAll('div[data-pressable-container="true"]');
for(var i=0;i<cs.length;i++){var c=cs[i];var as=Array.prototype.slice.call(c.querySelectorAll('a[href*="/post/"]'));var postA=null;
for(var k=0;k<as.length;k++){if(as[k].querySelector('time')){postA=as[k];break;}}if(!postA)postA=as[0];if(!postA)continue;
var href=(postA.getAttribute('href')||'').split('?')[0];var m=href.match(/^\/@([^/]+)\/post\/([^/?#]+)/);if(!m||seen[href])continue;seen[href]=1;
var time=postA.querySelector('time')||c.querySelector('time');var timeText=time?(time.innerText||'').trim():'';
var blocks=Array.prototype.slice.call(c.querySelectorAll('div[dir="auto"],span[dir="auto"]')).map(function(e){return (e.innerText||'').trim();}).filter(function(t){return t&&t!==m[1]&&t!==timeText&&!/^\d+$/.test(t);});
var uniq=[];blocks.forEach(function(t){if(uniq.indexOf(t)<0)uniq.push(t);});uniq.sort(function(a,b){return b.length-a.length;});
var likes=0,replies=0,liked=false;var bs=c.querySelectorAll('button');
for(var q=0;q<bs.length;q++){var l=cfLab(bs[q]);if(!l)continue;var mm=(bs[q].innerText||'').match(/\d[\d\s]*/);var n=mm?(parseInt(mm[0].replace(/\s/g,''),10)||0):0;
if(/Нравится|Like/i.test(l)){likes=n;liked=/Не нравится|Unlike/i.test(l);}else if(/^Ответ$|^Reply$|ответили|replied/i.test(l))replies=n;}
out.push({href:href,id:m[2],author:m[1],createdAt:time?time.getAttribute('datetime'):null,text:uniq[0]||'',likes:likes,liked:liked,replies:replies});}
return out;}
function cfComposer(){var t=document.querySelector('[role="textbox"]');return t?(t.getAttribute('aria-placeholder')||t.getAttribute('placeholder')||t.getAttribute('aria-label')||''):'';}
function cfComposerText(){var t=document.querySelector('[role="textbox"]');return t?(t.innerText||t.textContent||''):'';}
function cfMarkLike(path){var cs=Array.prototype.slice.call(document.querySelectorAll('div[data-pressable-container="true"]'));var c=null;
for(var i=0;i<cs.length;i++){var as=cs[i].querySelectorAll('a[href*="/post/"]');for(var k=0;k<as.length;k++){if((as[k].getAttribute('href')||'').split('?')[0]===path){c=cs[i];break;}}if(c)break;}
if(!c)return 'no-container';var bs=c.querySelectorAll('button');for(var q=0;q<bs.length;q++){var l=cfLab(bs[q]);if(/Не нравится|Unlike/i.test(l))return 'already';if(/Поставить|^Like$/i.test(l)){bs[q].setAttribute('data-cf','like');return 'marked';}}return 'no-button';}
function cfMarkSend(){var tb=document.querySelector('[role="textbox"]');if(!tb)return '';var cont=tb.closest('div[data-pressable-container="true"]');
var all=Array.prototype.slice.call(document.querySelectorAll('button,[role="button"]'));
for(var i=0;i<all.length;i++){var b=all[i];if(!(tb.compareDocumentPosition(b)&Node.DOCUMENT_POSITION_FOLLOWING))continue;if(b.closest('div[data-pressable-container="true"]')!==cont)continue;
var l=cfLab(b).trim();var t=(b.innerText||'').trim();if(/^(Ответ|Reply|Опубликовать|Post)$/i.test(l)||/^(Опубликовать|Post)$/i.test(t)){b.setAttribute('data-cf','send');return l||t||'send';}}return '';}
function cfActivity(H){var out=[];var cs=document.querySelectorAll('div[data-pressable-container="true"]');
for(var i=0;i<cs.length;i++){var c=cs[i];var links=Array.prototype.slice.call(c.querySelectorAll('a[href]'));var author='';
for(var k=0;k<links.length;k++){var h=links[k].getAttribute('href')||'';if(/^\/@[^/]+$/.test(h)){author=h.slice(2);break;}}
var theirs=null,ours=null;for(var k2=0;k2<links.length;k2++){var h2=links[k2].getAttribute('href')||'';if(h2.indexOf('/post/')<0)continue;if(h2.indexOf('/@'+H+'/')===0){if(!ours)ours=links[k2];}else if(!theirs)theirs=links[k2];}
var time=c.querySelector('time');var hasButtons=false;var bs=c.querySelectorAll('button');for(var q=0;q<bs.length;q++){if(/Нравится|Like/i.test(cfLab(bs[q]))){hasButtons=true;break;}}
var full=(c.innerText||'').replace(/\s+/g,' ').trim();
out.push({author:author,full:full.slice(0,800),theirs:theirs?(theirs.getAttribute('href')||'').split('?')[0]:null,theirsText:theirs?(theirs.innerText||'').replace(/\s+/g,' ').trim():'',ours:ours?(ours.getAttribute('href')||'').split('?')[0]:null,oursText:ours?(ours.innerText||'').replace(/\s+/g,' ').trim():'',time:time?time.getAttribute('datetime'):null,hasButtons:hasButtons});}
return out;}
function cfProfile(){var bs=document.querySelectorAll('button,a,div[role="button"]');var edit=false;for(var i=0;i<bs.length;i++){if(/Редактировать профиль|Edit profile/i.test(bs[i].innerText||'')){edit=true;break;}}
var m=(document.body.innerText||'').match(/(\d[\d\s]*)\s*(подписчик|followers)/i);return {edit:edit,followers:m?(parseInt(m[1].replace(/\s/g,''),10)||null):null};}
`;

/** `await p.evaluate(...)` snippet that runs `expr` in the page with the helpers in scope. */
const EV = (expr: string) => `await p.evaluate(new Function(${JSON.stringify(HELPERS + '\nreturn (' + expr + ');')}))`;
const NORM = `const norm = (s) => String(s || '').replace(/\\s+/g, ' ').trim().toLowerCase();`;

export function searchCode(queries: string[]): string {
  return `
const out = []; let login = false;
for (const q of ${JSON.stringify(queries)}) {
  const p = await openTab('https://www.threads.com/search?q=' + encodeURIComponent(q) + '&filter=recent');
  try {
    await sleep(6000 + Math.random() * 2000);
    login = ${EV('cfLogin()')};
    if (login) { out.push({ q, error: 'login' }); break; }
    ${EV('(window.scrollBy(0, 1600), true)')};
    await sleep(2500);
    const posts = ${EV('cfPosts()')};
    out.push({ q, posts });
  } catch (e) { out.push({ q, error: String(e).slice(0, 300) }); }
  finally { try { await closeTab(p); } catch (e) {} }
  await sleep(3000 + Math.random() * 3000);
}
emit({ login, results: out });`;
}

/** Open a post (or someone's reply), optionally like it, type the comment, send, verify on reload. */
export function replyCode(o: { path: string; text: string; like: boolean; handle: string }): string {
  return `
${NORM}
const PATH = ${JSON.stringify(o.path)}; const TEXT = ${JSON.stringify(o.text)}; const HANDLE = ${JSON.stringify(o.handle)};
const p = await openTab('https://www.threads.com' + PATH);
let res = { ok: false, error: 'not started' };
try {
  await sleep(6000 + Math.random() * 1500);
  if (${EV('cfLogin()')}) { res = { ok: false, error: 'login' }; }
  else {
    const posts = ${EV('cfPosts()')};
    const target = posts.find(x => x.href === PATH);
    if (!target) { res = { ok: false, error: 'post not found on page', found: posts.slice(0, 3).map(x => x.href) }; }
    else {
      const ph = ${EV('cfComposer()')};
      if (!ph) { res = { ok: false, error: 'composer not found' }; }
      else if (ph.indexOf(target.author) < 0 && !/новую публикацию|new post|Reply/i.test(ph)) { res = { ok: false, error: 'composer targets someone else: ' + ph }; }
      else {
        let liked = false;
        if (${o.like ? 'true' : 'false'} && !target.liked) {
          const marked = ${EV(`cfMarkLike(${JSON.stringify(o.path)})`)};
          if (marked === 'marked') { try { await p.locator('[data-cf="like"]').first().click(); liked = true; } catch (e) {} await sleep(2000 + Math.random() * 1500); }
        }
        const tb = p.locator('[role="textbox"]').first();
        await tb.click(); await sleep(800 + Math.random() * 500);
        await tb.pressSequentially(TEXT, { delay: 25 + Math.floor(Math.random() * 15) });
        await sleep(1500);
        const typed = ${EV('cfComposerText()')};
        if (norm(typed) !== norm(TEXT)) {
          try { await tb.press('Meta+a'); await tb.press('Backspace'); } catch (e) {}
          res = { ok: false, error: 'typed text mismatch', typed: String(typed).slice(0, 200) };
        } else {
          const sendLabel = ${EV('cfMarkSend()')};
          if (!sendLabel) {
            try { await tb.press('Meta+a'); await tb.press('Backspace'); } catch (e) {}
            res = { ok: false, error: 'send button not found' };
          } else {
            await p.locator('[data-cf="send"]').first().click();
            await sleep(8000);
            const after = ${EV('cfComposerText()')};
            let mine = null;
            try { await p.goto('https://www.threads.com' + PATH); await sleep(6000); const posts2 = ${EV('cfPosts()')}; mine = posts2.find(x => x.author === HANDLE && norm(x.text).indexOf(norm(TEXT).slice(0, 40)) === 0) || null; } catch (e) {}
            res = { ok: !!mine || norm(after) === '', replyHref: mine ? mine.href : null, verified: !!mine, sent: sendLabel, liked, after: String(after).slice(0, 100) };
          }
        }
      }
    }
  }
} catch (e) { res = { ok: false, error: String(e).slice(0, 400) }; }
finally { try { await closeTab(p); } catch (e) {} }
emit(res);`;
}

export function likeCode(path: string): string {
  return `
const p = await openTab('https://www.threads.com' + ${JSON.stringify(path)});
let res = { ok: false };
try {
  await sleep(6000);
  if (${EV('cfLogin()')}) res = { ok: false, error: 'login' };
  else { const marked = ${EV(`cfMarkLike(${JSON.stringify(path)})`)}; if (marked === 'marked') { await p.locator('[data-cf="like"]').first().click(); await sleep(2000); res = { ok: true }; } else res = { ok: marked === 'already', marked }; }
} catch (e) { res = { ok: false, error: String(e).slice(0, 300) }; }
finally { try { await closeTab(p); } catch (e) {} }
emit(res);`;
}

export function activityCode(handle: string): string {
  return `
const p = await openTab('https://www.threads.com/activity');
let res = { items: [], login: false };
try {
  await sleep(7000);
  res.login = ${EV('cfLogin()')};
  if (!res.login) { ${EV('(window.scrollBy(0, 1200), true)')}; await sleep(2000); res.items = ${EV(`cfActivity(${JSON.stringify(handle)})`)}; }
} catch (e) { res.error = String(e).slice(0, 300); }
finally { try { await closeTab(p); } catch (e) {} }
emit(res);`;
}

/** Our replies page: parent posts and our replies in order, plus login state and follower count. */
export function repliesCode(handle: string): string {
  return `
const p = await openTab('https://www.threads.com/@' + ${JSON.stringify(handle)} + '/replies');
let res = { posts: [], login: false, loggedIn: false, followers: null };
try {
  await sleep(7000);
  res.login = ${EV('cfLogin()')};
  if (!res.login) {
    const prof = ${EV('cfProfile()')}; res.loggedIn = !!prof.edit; res.followers = prof.followers;
    for (let i = 0; i < 3; i++) { ${EV('(window.scrollBy(0, 2500), true)')}; await sleep(1800); }
    res.posts = ${EV('cfPosts()')};
  }
} catch (e) { res.error = String(e).slice(0, 300); }
finally { try { await closeTab(p); } catch (e) {} }
emit(res);`;
}

/** Profile + Insights pages as plain text (numbers are parsed in the runner; works for the Russian and English UI). */
export function insightsCode(handle: string): string {
  return `
let res = { profile: '', insights: '', login: false };
try {
  const p = await openTab(${JSON.stringify('https://www.threads.com/@' + handle)});
  await sleep(6000);
  res.login = ${EV('cfLogin()')};
  res.profile = await p.evaluate(() => (document.body.innerText || '').slice(0, 1500));
  await p.goto('https://www.threads.com/insights');
  await sleep(8000);
  res.insights = await p.evaluate(() => (document.body.innerText || '').slice(0, 3000));
  await closeTab(p);
} catch (e) { res.error = String(e).slice(0, 300); }
emit(res);`;
}
