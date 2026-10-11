import { spawn } from 'node:child_process';
import { env } from './env.ts';
import { log } from './log.ts';

const MARK = '@@CF@@';
const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;

function spawnAside(args: string[], timeoutMs: number): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const path = [process.env.HOME + '/.local/bin', '/opt/homebrew/bin', '/usr/local/bin', process.env.PATH || ''].join(':');
    const child = spawn(env.asideBin, args, { env: { ...process.env, PATH: path }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', (d) => (out += d.toString()));
    const timer = setTimeout(() => { child.kill('SIGKILL'); out += '\n[com-factory] aside timed out'; }, timeoutMs);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out: out.replace(ANSI, '') }); });
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, out: `[com-factory] cannot start aside: ${e.message}` }); });
  });
}

export interface ReplResult { ok: boolean; payloads: any[]; raw: string }

/** Run JavaScript in Aside's browser REPL. Emit data with `emit(x)` inside the code; it comes back in `payloads`. */
export async function repl(code: string, opts: { timeoutMs?: number } = {}): Promise<ReplResult> {
  const wrapped = `const emit = (x) => console.log(${JSON.stringify(MARK)} + JSON.stringify(x));\n${code}`;
  const { out } = await spawnAside(['repl', wrapped], opts.timeoutMs ?? 140_000);
  const payloads: any[] = [];
  for (const line of out.split('\n')) {
    const i = line.indexOf(MARK);
    if (i < 0) continue;
    try { payloads.push(JSON.parse(line.slice(i + MARK.length))); } catch {}
  }
  const ok = /\[ok \|/.test(out) && !/\[com-factory\] aside timed out/.test(out);
  if (!ok) log('aside', 'repl failed', out.slice(-1500));
  return { ok, payloads, raw: out };
}

/** Run an Aside agent session with a prompt (optionally continuing an existing session). Returns the transcript text. */
export async function exec(prompt: string, opts: { session?: string; effort?: string; timeoutMs?: number } = {}): Promise<{ ok: boolean; raw: string }> {
  const args = ['exec'];
  if (opts.session) args.push('--session', opts.session);
  if (opts.effort) args.push('--effort', opts.effort);
  args.push(prompt);
  const { code, out } = await spawnAside(args, opts.timeoutMs ?? 60 * 60 * 1000);
  return { ok: code === 0 && !/\[com-factory\] aside timed out/.test(out), raw: out };
}

export interface AskOpts { provider?: string; model?: string; effort?: string; timeoutMs?: number }

/**
 * Ask the model connected to Aside (e.g. Claude via the claude-code provider) for a plain text answer.
 * Runs `aside exec` without a browser task; the prompt must tell the model not to use tools.
 */
export async function ask(prompt: string, opts: AskOpts = {}): Promise<string> {
  const args = ['exec'];
  if (opts.provider) args.push('-p', opts.provider);
  if (opts.model) args.push('-m', opts.model);
  args.push('--effort', opts.effort || 'low');
  args.push(prompt);
  const { code, out } = await spawnAside(args, opts.timeoutMs ?? 180_000);
  if (/\[com-factory\] aside timed out/.test(out)) throw new Error('aside exec timed out');
  // Aside prints a sign-in warning block before the answer when its cloud account is paused; the provider still answers.
  const body = out.replace(/^Warning:[\s\S]*?aside exec --account <id> \.\.\.\s*/m, '').trim();
  if (!body) throw new Error(`aside exec returned nothing (exit ${code}): ${out.slice(-300)}`);
  if (code !== 0 && !/[{[]/.test(body)) throw new Error(`aside exec failed (exit ${code}): ${body.slice(-400)}`);
  return body;
}

/** The last JSON object in a model answer (tolerates "Thinking:" lines, tool chatter and ``` fences around it). */
export function extractJson(text: string): any {
  const s = text.replace(/```(?:json)?/g, '').trim();
  try { return JSON.parse(s); } catch {}
  const end = s.lastIndexOf('}');
  if (end < 0) throw new Error(`no JSON in answer: ${s.slice(0, 200)}`);
  for (let i = s.lastIndexOf('{'); i >= 0; i = s.lastIndexOf('{', i - 1)) {
    try { return JSON.parse(s.slice(i, end + 1)); } catch {}
    if (i === 0) break;
  }
  throw new Error(`cannot parse JSON in answer: ${s.slice(0, 200)}`);
}

export async function version(): Promise<string> {
  const { out } = await spawnAside(['--version'], 15_000);
  return out.trim();
}
