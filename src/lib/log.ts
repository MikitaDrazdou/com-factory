import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './env.ts';

const file = path.join(DATA_DIR, 'com-factory.log');

export function log(scope: string, msg: string, extra?: unknown) {
  const line = `${new Date().toISOString()} [${scope}] ${msg}${extra === undefined ? '' : ' ' + safe(extra)}`;
  console.log(line);
  try { fs.appendFileSync(file, line + '\n'); } catch {}
}

function safe(x: unknown): string {
  try { return typeof x === 'string' ? x : JSON.stringify(x); } catch { return String(x); }
}
