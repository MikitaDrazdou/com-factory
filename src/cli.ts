import { env, PANEL_URL } from './lib/env.ts';
import { log } from './lib/log.ts';

const [cmd = 'help', ...rest] = process.argv.slice(2);

async function main() {
  switch (cmd) {
    case 'serve': {
      const { startServer } = await import('./server/index.ts');
      const { startScheduler } = await import('./runner/scheduler.ts');
      await startServer();
      if (process.env.CF_SCHEDULER !== '0') startScheduler();
      log('cli', `panel at ${PANEL_URL}`);
      break;
    }
    case 'doctor': {
      const { doctor } = await import('./runner/doctor.ts');
      const report = await doctor();
      for (const l of report.lines) console.log(l);
      process.exit(report.ok ? 0 : 1);
    }
    case 'x:discover': { const x = await import('./runner/x.ts'); console.log(await x.discover({ queries: Number(rest[0] || 4) })); break; }
    case 'x:rescore': { const x = await import('./runner/x.ts'); console.log(await x.rescore(Number(rest[0] || 3), Number(rest[1] || 60))); break; }
    case 'x:draft': { const x = await import('./runner/x.ts'); console.log(await x.draft(Number(rest[0] || 0) || undefined)); break; }
    case 'x:post': { const x = await import('./runner/x.ts'); const now = rest.includes('--now'); const a = rest.filter((s) => s !== '--now'); console.log(await x.post({ draftId: a[0] ? Number(a[0]) : undefined, max: Number(a[1] || 1), now })); break; }
    case 'x:stats': { const x = await import('./runner/x.ts'); console.log(await x.stats()); break; }
    case 'x:inbound': { const x = await import('./runner/x.ts'); console.log(await x.inbound()); break; }
    case 'x:tick': { const x = await import('./runner/x.ts'); console.log(await x.tick()); break; }
    case 'threads:login': { const t = await import('./runner/threads.ts'); console.log(await t.loginCheck()); break; }
    case 'threads:discover': { const t = await import('./runner/threads.ts'); console.log(await t.discover({ queriesPerProduct: Number(rest[0] || 3) })); break; }
    case 'threads:draft': { const t = await import('./runner/threads.ts'); console.log(await t.draft(Number(rest[0] || 0) || undefined)); break; }
    case 'threads:post': { const t = await import('./runner/threads.ts'); console.log(await t.post({ draftId: rest[0] ? Number(rest[0]) : undefined, max: Number(rest[1] || 1) })); break; }
    case 'threads:inbound': { const t = await import('./runner/threads.ts'); console.log(await t.inbound()); break; }
    case 'threads:insights': { const t = await import('./runner/threads.ts'); console.log(await t.insights()); break; }
    case 'threads:stats': { const t = await import('./runner/threads.ts'); console.log(await t.stats()); break; }
    case 'threads:run': { const t = await import('./runner/threads.ts'); console.log(await t.runOnce()); break; }
    case 'threads:import': { const t = await import('./runner/threads-import.ts'); console.log(t.importMemory(rest[0])); break; }
    default:
      console.log(`com-factory ${env.tz}
  serve             start panel + scheduler
  doctor            check Aside, X/Threads login, OpenRouter/Jev, database
  x:discover [n]    search X with n queries per product, score with Jev
  x:rescore [days]  re-run Jev on recent candidates it skipped (after loosening the thresholds)
  x:draft [n]       write up to n drafts
  x:post [id] [--now]  post approved drafts (or one draft by id); --now ignores active hours (limits still apply)
  x:stats           refresh metrics of our replies
  x:inbound         pull notifications
  x:tick            discover + draft + post approved
  threads:login     check the Threads session
  threads:discover [n]  search Threads with n queries per product, score with Jev
  threads:draft [n] write up to n comments
  threads:post [id] post approved comments (or one draft by id)
  threads:inbound   read replies under our comments, answer questions
  threads:stats     refresh likes/replies of our comments (+ profile insights)
  threads:insights  read profile and Insights totals (views, viewers, interactions)
  threads:run       one full run: import memory, inbound, discover, draft, post, stats
  threads:import <MEMORY.md>  import an Aside routine memory file (history + dedupe)`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
