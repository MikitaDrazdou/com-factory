import { ask, extractJson } from './aside.ts';
import { models, platformConfig } from './settings.ts';
import { all } from './db.ts';
import { mentionShare, linkShare } from './limits.ts';
import { platformLinks, hostsOf, applyUtm, type Product } from './products.ts';
import { xDraftSystem, xDraftUser } from '../prompts/x.ts';
import { threadsDraftSystem, threadsDraftUser, threadsInboundSystem } from '../prompts/threads.ts';
import { log } from './log.ts';

export interface DraftResult { text: string; mentions_product: boolean; link_included: boolean; language: string; why: string; skip_reason?: string; model: string }

function recentOpenings(platform: string, n = 10): string[] {
  return all("SELECT text FROM comments WHERE platform = ? AND source = 'runner' ORDER BY posted_at DESC LIMIT ?", platform, n)
    .map((r) => String(r.text).split(/\s+/).slice(0, 3).join(' '))
    .filter(Boolean);
}

const URL_RE = /(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)(\/[^\s,)»"']*)?/gi;

export function validateX(text: string, o: { allowLink: boolean; hosts: string[] } = { allowLink: false, hosts: [] }): string {
  if (!text.trim()) return 'empty';
  if (text.length > 280) return `too long (${text.length})`;
  const links = [...text.matchAll(URL_RE)].map((m) => ({ host: m[1].toLowerCase(), full: m[0] })).filter((l) => /\.[a-z]{2,}$/.test(l.host) && !/^\d+\.\d+$/.test(l.host));
  if (links.length || /https?:\/\/|www\./i.test(text)) {
    if (!o.allowLink) return 'contains a link';
    if (links.length > 1) return 'more than one link';
    if (!o.hosts.includes(links[0].host)) return `link to unknown host ${links[0].host}`;
    if (!/utm_/.test(links[0].full)) return 'link without UTM';
  }
  if (HASHTAG.test(text)) return 'contains a hashtag';
  if (/(^|\s)@\w/.test(text)) return 'contains a mention';
  if (PRICE.test(text)) return 'contains a price';
  if ((text.match(/\p{Extended_Pictographic}/gu) || []).length > 1) return 'too many emojis';
  return '';
}

const HASHTAG = /(^|\s)#\p{L}/u;
const PRICE = /\d[\d\s.,]*\s?(₽|руб|р\.|\$|€|USD|BRL|R\$|₸|тг|тенге|reais|dólares|dolares|pesos)\b|(\$|€|R\$|USD|US\$)\s?\d|\d\s?(€|\$)/iu;
const HOOK = /скажи(те)? даты|напиши(те)? (мне )?(страну|даты)|подберу (объ[её]м|тариф)|ссылка выше|QR прид[её]т|пишите в личку|DM me|link above|(tell|send|share|give) me (your )?(dates|travel dates|country)|let me know (your )?dates|I('ll| will) (pick|find|suggest) (a|the|you a) plan|me (manda|envia|diga) (suas |as )?datas|dime (tus )?fechas|te (busco|recomiendo) (un|el) plan/i;

export function validateThreads(text: string, o: { allowLink: boolean; allowPrices: boolean; hosts: string[] }): string {
  if (!text.trim()) return 'empty';
  if (text.length > 480) return `too long (${text.length})`;
  if (HASHTAG.test(text)) return 'contains a hashtag';
  if ((text.match(/\p{Extended_Pictographic}/gu) || []).length > 1) return 'too many emojis';
  const links = [...text.matchAll(URL_RE)].map((m) => ({ host: m[1].toLowerCase(), full: m[0] })).filter((l) => /\.[a-z]{2,}$/.test(l.host) && !/^\d+\.\d+$/.test(l.host));
  if (links.length) {
    if (!o.allowLink) return 'contains a link';
    if (links.length > 1) return 'more than one link';
    if (!o.hosts.includes(links[0].host)) return `link to unknown host ${links[0].host}`;
    if (!/utm_/.test(links[0].full)) return 'link without UTM';
  }
  if (!o.allowPrices && PRICE.test(text)) return 'contains a price';
  if (HOOK.test(text)) return 'sales hook ending';
  return '';
}

/** Make sure every link on an allowed host carries the platform UTM (the model sometimes drops it). Trailing punctuation stays outside the link. */
export function enforceUtm(text: string, hosts: string[], utm: string): string {
  if (!utm) return text;
  return text.replace(URL_RE, (m, host) => {
    if (!hosts.includes(String(host).toLowerCase())) return m;
    const tail = m.match(/[.,;:!?)]+$/)?.[0] ?? '';
    return applyUtm(m.slice(0, m.length - tail.length), utm) + tail;
  });
}

/** Country pages may not exist: keep only links that answer 2xx/3xx, otherwise fall back to the site root with the same UTM. */
export async function verifyLinks(text: string, hosts: string[]): Promise<string> {
  let out = text;
  for (const m of [...text.matchAll(URL_RE)]) {
    const host = m[1].toLowerCase();
    if (!hosts.includes(host) || !m[2] || m[2] === '/' || m[2].startsWith('/?')) continue;
    const url = 'https://' + host + m[2];
    let ok = false;
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000);
      const r = await fetch(url, { method: 'GET', redirect: 'follow', signal: ctl.signal, headers: { 'user-agent': 'Mozilla/5.0 com-factory link check' } });
      clearTimeout(t);
      ok = r.status < 400;
    } catch {}
    if (!ok) {
      const q = m[2].includes('?') ? m[2].slice(m[2].indexOf('?')) : '';
      const repl = m[0].replace(m[2], '/' + q);
      log('draft', `link ${url} not reachable, replaced with root`);
      out = out.replace(m[0], repl);
    }
  }
  return out;
}

const NO_TOOLS = 'You are answering a text task inside a terminal session: do NOT use any tools, do not open or read pages, do not browse. Answer with the JSON object only: no prose before or after it, no markdown fences.';

/** Text model label stored with drafts, e.g. "claude-code/claude-opus-5". */
export const textModel = () => { const m = models(); return `${m.text_provider}/${m.text_model}`; };

async function askJson(prompt: string): Promise<any> {
  const m = models();
  return extractJson(await ask(prompt, { provider: m.text_provider, model: m.text_model, effort: m.text_effort }));
}

/** Draft with the model connected to Aside, one repair pass if the validator rejects the text. */
async function generate(sys: string, user: string, validate: (t: string) => string, fix: (t: string) => string = (t) => t): Promise<{ out: any; text: string; problem: string }> {
  const prompt = `${NO_TOOLS}\n\n${sys}\n\n## Input\n${user}`;
  let out = await askJson(prompt);
  let text = fix(String(out.text ?? '').trim());
  let problem = text ? validate(text) : '';
  if (text && problem) {
    out = await askJson(`${prompt}\n\n## Your previous answer\n${JSON.stringify(out)}\n\nRejected: ${problem}. Rewrite following every hard rule. JSON only.`);
    text = fix(String(out.text ?? '').trim());
    problem = text ? validate(text) : '';
  }
  return { out, text, problem };
}

export async function draftX(cand: any, lang: string, account: { name: string; handle: string }, product?: Product): Promise<DraftResult> {
  const cfg = platformConfig('x');
  const allowMention = mentionShare('x') < cfg.product_mention_ratio;
  const links = platformLinks(product, cfg);
  const allowLink = allowMention && links.length > 0 && linkShare('x') < cfg.link_ratio;
  const hosts = hostsOf(links);
  const pr = product ? { ...product, links } : product;
  const model = textModel();
  const sys = xDraftSystem({ accountName: account.name, handle: account.handle, allowMention, allowLink, recentOpenings: recentOpenings('x'), lang, product: pr });
  const user = xDraftUser({ text: cand.text, author: cand.author, author_name: cand.author_name, author_followers: cand.author_followers, post_created_at: cand.post_created_at, metrics: cand.metrics, parent_text: cand.parent_text });
  const { out, text, problem } = await generate(sys, user, (t) => validateX(t, { allowLink, hosts }), (t) => enforceUtm(t, hosts, cfg.utm));
  if (!text) return { text: '', mentions_product: false, link_included: false, language: lang, why: String(out.why ?? ''), skip_reason: String(out.skip_reason ?? 'model declined'), model };
  if (problem) return { text: '', mentions_product: false, link_included: false, language: lang, why: '', skip_reason: `validation: ${problem}`, model };
  const hasLink = [...text.matchAll(URL_RE)].some((m) => hosts.includes(m[1].toLowerCase()));
  return { text, mentions_product: Boolean(out.mentions_product) || hasLink || /esim/i.test(text), link_included: hasLink, language: String(out.language ?? lang), why: String(out.why ?? ''), model };
}

export async function draftThreads(cand: any, lang: string, handle: string, product: Product | undefined, kind: string): Promise<DraftResult> {
  const cfg = platformConfig('threads');
  const allowMention = kind === 'intro' || mentionShare('threads') < cfg.product_mention_ratio;
  const links = platformLinks(product, cfg);
  const allowLink = allowMention && links.length > 0 && linkShare('threads') < cfg.link_ratio;
  const hosts = hostsOf(links);
  const pr = product ? { ...product, links } : product;
  const model = textModel();
  const sys = threadsDraftSystem({ handle, lang, kind, allowMention, allowLink, allowPrices: cfg.prices_allowed, recentOpenings: recentOpenings('threads'), product: pr });
  const user = threadsDraftUser({ text: cand.text, author: cand.author, post_created_at: cand.post_created_at, metrics: cand.metrics, kind });
  const validate = (t: string) => validateThreads(t, { allowLink, allowPrices: cfg.prices_allowed, hosts });
  let { out, text, problem } = await generate(sys, user, validate, (t) => enforceUtm(t, hosts, cfg.utm));
  if (!text) return { text: '', mentions_product: false, link_included: false, language: lang, why: String(out.why ?? ''), skip_reason: String(out.skip_reason ?? 'model declined'), model };
  if (problem) return { text: '', mentions_product: false, link_included: false, language: lang, why: '', skip_reason: `validation: ${problem}`, model };
  text = await verifyLinks(text, hosts);
  const hasLink = [...text.matchAll(URL_RE)].some((m) => hosts.includes(m[1].toLowerCase()));
  return { text, mentions_product: Boolean(out.mentions_product) || hasLink, link_included: hasLink, language: String(out.language ?? lang), why: String(out.why ?? ''), model };
}

export async function draftThreadsInbound(inb: { text: string; context: string; from_user: string }, kind: 'A' | 'B', lang: string, handle: string, product: Product | undefined, turn: number): Promise<DraftResult> {
  const cfg = platformConfig('threads');
  const links = platformLinks(product, cfg);
  const hosts = hostsOf(links);
  const allowLink = kind === 'A' && links.length > 0;
  const pr = product ? { ...product, links } : product;
  const model = textModel();
  const sys = threadsInboundSystem({ handle, lang, kind, allowLink, recentOpenings: recentOpenings('threads', 6), turn, product: pr });
  const user = `Our comment:\n"""${inb.context}"""\n\n@${inb.from_user} replied:\n"""${inb.text}"""\n\nWrite our reply.`;
  const validate = (t: string) => validateThreads(t, { allowLink, allowPrices: true, hosts });
  let { out, text, problem } = await generate(sys, user, validate, (t) => enforceUtm(t, hosts, cfg.utm));
  if (!text) return { text: '', mentions_product: false, link_included: false, language: lang, why: '', skip_reason: 'model declined', model };
  if (problem) return { text: '', mentions_product: false, link_included: false, language: lang, why: '', skip_reason: `validation: ${problem}`, model };
  text = await verifyLinks(text, hosts);
  const hasLink = [...text.matchAll(URL_RE)].some((m) => hosts.includes(m[1].toLowerCase()));
  return { text, mentions_product: true, link_included: hasLink, language: String(out.language ?? lang), why: '', model };
}
