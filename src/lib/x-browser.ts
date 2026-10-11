// X (Twitter) actions done in a real x.com tab in Aside Browser.
// Posting goes through the genuine web client: Aside's `twitter.reply` sends a bare GraphQL request and X answers
// error 226 ("this request looks like it might be automated") to fresh accounts. Typing into the page does not.

export interface XBrowserReply { ok: boolean; id?: string; text?: string; login: boolean; sent: boolean; typedLen?: number; step: string; error?: string; toast?: string; liked: boolean; check?: any }

// Page-side snippets. They run through `new Function` like the Threads helpers, so constants are inlined as JSON.
const PAGE_INFO = `(() => ({ url: location.href, login: /\\/i\\/flow\\/login|\\/login/.test(location.href) || !!document.querySelector('input[name="text"][autocomplete="username"]'), box: !!document.querySelector('[data-testid="tweetTextarea_0"]'), articles: document.querySelectorAll('article').length }))()`;
const OPEN_REPLY = `(() => { const a = document.querySelector('article'); const b = a && a.querySelector('[data-testid="reply"]'); if (b) b.click(); return !!b; })()`;
const TYPED = `(() => (document.querySelector('[data-testid="tweetTextarea_0"]') || {}).innerText || '')()`;
const SEND_BTN = `(() => { const b = document.querySelector('[data-testid="tweetButtonInline"]') || document.querySelector('[data-testid="tweetButton"]'); return b ? { testid: b.getAttribute('data-testid'), disabled: b.getAttribute('aria-disabled') === 'true' || !!b.disabled } : null; })()`;
const findOurs = (handle: string) => `(() => { const h = ${JSON.stringify(handle.toLowerCase())};
  for (const a of document.querySelectorAll('article')) {
    const links = [...a.querySelectorAll('a[role=link]')].map(x => x.getAttribute('href') || '');
    if (!links.some(x => x.toLowerCase() === '/' + h)) continue;
    const st = links.find(x => x.toLowerCase().startsWith('/' + h + '/status/'));
    if (st) return { id: st.split('/status/')[1].split(/[?/]/)[0], text: ((a.querySelector('[data-testid="tweetText"]') || {}).innerText || '').slice(0, 200) };
  }
  const box = (document.querySelector('[data-testid="tweetTextarea_0"]') || {}).innerText || '';
  const toast = [...document.querySelectorAll('[data-testid="toast"], [role="alert"]')].map(d => d.innerText).join(' | ');
  return { id: null, boxLeft: box.length, toast: toast.slice(0, 300) }; })()`;

/**
 * REPL code: open the post, type the reply into the inline composer, send, verify that our reply appeared.
 * Emits an XBrowserReply. `sent` is true when the composer emptied after the click (X accepted it) even if the
 * reply could not be located on the page afterwards.
 */
export function xBrowserReplyCode(author: string, postId: string, text: string, handle: string, like: boolean): string {
  const url = `https://x.com/${author}/status/${postId}`;
  return `
const TEXT = ${JSON.stringify(text)};
let res = { ok: false, login: false, sent: false, step: 'open', liked: false };
const p = await openTab(${JSON.stringify(url)});
const ev = (src) => p.evaluate(new Function('return (' + src + ');'));
try {
  await sleep(7000);
  const info = await ev(${JSON.stringify(PAGE_INFO)});
  if (info.login) { res.login = true; throw new Error('X is not logged in (login page)'); }
  if (!info.articles) throw new Error('post page did not load: ' + info.url);
  res.step = 'composer';
  if (!info.box) { await ev(${JSON.stringify(OPEN_REPLY)}); await sleep(3000); }
  await p.locator('[data-testid="tweetTextarea_0"]').click();
  await sleep(700);
  await p.locator('[data-testid="tweetTextarea_0"]').pressSequentially(TEXT, { delay: 28 });
  await sleep(1500);
  const typed = await ev(${JSON.stringify(TYPED)});
  res.typedLen = typed.length;
  if (typed.length < TEXT.length - 8) throw new Error('typed ' + typed.length + ' of ' + TEXT.length + ' chars');
  res.step = 'send';
  const btn = await ev(${JSON.stringify(SEND_BTN)});
  if (!btn) throw new Error('send button not found');
  if (btn.disabled) throw new Error('send button is disabled');
  await p.locator('[data-testid="' + btn.testid + '"]').click();
  res.step = 'verify';
  await sleep(8000);
  let found = await ev(${JSON.stringify(findOurs(handle))});
  if (!found.id) {
    res.toast = found.toast || '';
    res.sent = found.boxLeft === 0 && !/wrong|error|ошибк|couldn|unable|try again/i.test(found.toast || '');
    // The new reply is not always rendered in place: reload the conversation once and look again.
    await p.goto(${JSON.stringify(url)});
    await sleep(7000);
    found = await ev(${JSON.stringify(findOurs(handle))});
  }
  if (found.id) { res.ok = true; res.sent = true; res.id = found.id; res.text = found.text; }
  else if (!res.sent) throw new Error('reply not sent' + (res.toast ? ': ' + res.toast : '') + ' (composer still has ' + found.boxLeft + ' chars)');
} catch (e) { res.error = String(e).slice(0, 300); }
try { await closeTab(p); } catch (e) {}
if (res.ok && ${like ? 'true' : 'false'}) { try { await twitter.like(${JSON.stringify(postId)}); res.liked = true; } catch (e) {} }
if (res.ok && res.id) { try { const t = await twitter.getTweet(res.id); res.check = { id: t.id, text: t.text.slice(0, 120) }; } catch (e) { res.check = { error: String(e).slice(0, 160) }; } }
emit(res);`;
}
