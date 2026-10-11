import fs from 'node:fs';
import { run } from '../lib/db.ts';

const P = 'threads';

/** Import the comment log of an Aside routine MEMORY.md into the dashboard (read-only history for stats). */
export function importMemory(file?: string): { imported: number; skipped: number } {
  if (!file) throw new Error('path to MEMORY.md required');
  const text = fs.readFileSync(file, 'utf8');
  const blocks = text.split(/^### /m).slice(1);
  let imported = 0, skipped = 0;
  for (const b of blocks) {
    const head = b.split('\n')[0];
    const m = head.match(/^(\d{4}-\d{2}-\d{2})(?:\s+~?(\d{2}:\d{2}))?\s+—\s+([\w.\-_]+)\s+\((.*?)\)/);
    if (!m) { skipped++; continue; }
    const [, date, time, author, info] = m;
    const url = (b.match(/URL поста:\s*(\S+)/) || [])[1] || '';
    const txt = (b.match(/- Текст:\s*«([\s\S]*?)»\s*\n/) || [])[1] || '';
    const link = /Ссылка на продукт:\s*да/i.test(b);
    const bucket = /Корзина 1/.test(info) ? 'basket1' : /Корзина 2/.test(info) ? 'basket2' : /Корзина 3/.test(info) ? 'basket3' : /Этап 1/.test(info) ? 'inbound' : '';
    const postedAt = `${date} ${time || '12:00'}:00`;
    if (bucket === 'inbound') {
      const kindRu = (info.match(/тип ([АБВГ])/) || [])[1];
      const kind = kindRu === 'А' ? 'A' : kindRu === 'Б' ? 'B' : kindRu === 'В' ? 'C' : kindRu === 'Г' ? 'D' : '';
      const r = run('INSERT OR IGNORE INTO inbound(platform, external_id, from_user, text, kind, post_url, received_at, handled, our_reply) VALUES(?,?,?,?,?,?,?,1,?)', P, `${author}:${date}:${time || ''}`, author, '', kind, url, postedAt, txt);
      if (r.changes) imported++; else skipped++;
      continue;
    }
    const r = run(`INSERT OR IGNORE INTO comments(platform, post_id, post_url, reply_id, reply_url, author, text, bucket, product_mentioned, link_included, posted_at, source) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
      P, url.split('/post/')[1] || '', url, `import:${url || author + ':' + postedAt}`, '', author, txt, bucket, /esim|есим|симк/i.test(txt) ? 1 : 0, link ? 1 : 0, postedAt, 'import');
    if (r.changes) imported++; else skipped++;
  }
  return { imported, skipped };
}
