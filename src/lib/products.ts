import { all, get, run, j } from './db.ts';

export interface Product {
  id: number; name: string; summary: string; audience: string; facts: string;
  links: { label: string; url: string }[]; languages: string[]; platforms: string[]; queries: string[];
  voice: string; mention_rules: string; never: string; active: number;
}

export function listProducts(activeOnly = false, platform?: string): Product[] {
  return all(`SELECT * FROM products ${activeOnly ? 'WHERE active = 1' : ''} ORDER BY id`).map(rowToProduct)
    .filter((p) => !platform || p.platforms.includes(platform));
}
export function getProduct(id: number): Product | undefined {
  const r = get('SELECT * FROM products WHERE id = ?', id);
  return r ? rowToProduct(r) : undefined;
}
function rowToProduct(r: any): Product {
  return { ...r, links: j(r.links, []), languages: j(r.languages, []), platforms: j(r.platforms, ['x', 'threads']), queries: j(r.queries, []) };
}
export function saveProduct(p: Partial<Product> & { id?: number }): number {
  const links = JSON.stringify(p.links ?? []);
  const languages = JSON.stringify(p.languages ?? []);
  const platforms = JSON.stringify(p.platforms ?? ['x', 'threads']);
  const queries = JSON.stringify(p.queries ?? []);
  if (p.id) {
    run(`UPDATE products SET name=?, summary=?, audience=?, facts=?, links=?, languages=?, platforms=?, queries=?, voice=?, mention_rules=?, never=?, active=? WHERE id=?`,
      p.name ?? '', p.summary ?? '', p.audience ?? '', p.facts ?? '', links, languages, platforms, queries, p.voice ?? '', p.mention_rules ?? '', p.never ?? '', p.active ?? 1, p.id);
    return p.id;
  }
  const r = run(`INSERT INTO products(name, summary, audience, facts, links, languages, platforms, queries, voice, mention_rules, never, active) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
    p.name ?? 'Product', p.summary ?? '', p.audience ?? '', p.facts ?? '', links, languages, platforms, queries, p.voice ?? '', p.mention_rules ?? '', p.never ?? '', p.active ?? 1);
  return Number(r.lastInsertRowid);
}
export function deleteProduct(id: number) { run('DELETE FROM products WHERE id = ?', id); }

/** Prompt block for one product. */
export function productContextFor(p: Product | undefined): string {
  if (!p) return 'No product configured. Give purely helpful, neutral replies and never mention any product.';
  return [
    `### ${p.name}`,
    p.summary && `What it is: ${p.summary}`,
    p.audience && `Audience: ${p.audience}`,
    p.languages.length && `Languages this product serves: ${p.languages.join(', ')}`,
    p.facts && `Facts you may use (never invent others):\n${p.facts}`,
    p.links.length && `Links: ${p.links.map((l) => `${l.label}: ${l.url}`).join('; ')}`,
    p.voice && `Voice of the author: ${p.voice}`,
    p.mention_rules && `How to mention the product: ${p.mention_rules}`,
    p.never && `Never: ${p.never}`,
  ].filter(Boolean).join('\n');
}
/** Short one-liner for Jev instructions. */
export function productLine(p: Product | undefined): string {
  return p ? `${p.name}: ${p.summary}` : 'a helpful travel expert';
}
/** Allowed link hosts for validators. */
export function productHosts(p?: Product | Product[]): string[] {
  const hosts = new Set<string>();
  const list = Array.isArray(p) ? p : p ? [p] : listProducts(true);
  for (const pr of list) for (const l of pr.links) { try { hosts.add(new URL(l.url.startsWith('http') ? l.url : 'https://' + l.url).hostname.replace(/^www\./, '')); } catch {} }
  return [...hosts];
}

/** Append the platform UTM to a link, replacing any utm_* it already has. Keeps bare "host/path" links bare. */
export function applyUtm(url: string, utm: string): string {
  const clean = String(utm ?? '').trim().replace(/^\?/, '');
  if (!clean) return url;
  const bare = !/^https?:\/\//i.test(url);
  let u: URL;
  try { u = new URL(bare ? 'https://' + url : url); } catch { return url; }
  for (const k of [...u.searchParams.keys()]) if (k.toLowerCase().startsWith('utm_')) u.searchParams.delete(k);
  for (const [k, v] of new URLSearchParams(clean)) u.searchParams.set(k, v);
  const out = u.toString();
  return bare ? out.replace(/^https?:\/\//i, '') : out;
}
/** Links the model may use on a platform: the product's links plus the platform's own, each with the platform UTM. Empty when links are disabled there. */
export function platformLinks(product: Product | undefined, cfg: { links_enabled: boolean; utm: string; links: { label: string; url: string }[] }): { label: string; url: string }[] {
  if (!cfg.links_enabled) return [];
  return [...(product?.links ?? []), ...(cfg.links ?? [])].filter((l) => l?.url).map((l) => ({ label: l.label || l.url, url: applyUtm(l.url, cfg.utm) }));
}
/** Hostnames of a link list (for validators). */
export function hostsOf(links: { url: string }[]): string[] {
  const hosts = new Set<string>();
  for (const l of links) { try { hosts.add(new URL(l.url.startsWith('http') ? l.url : 'https://' + l.url).hostname.replace(/^www\./, '')); } catch {} }
  return [...hosts];
}
