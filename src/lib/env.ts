import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DATA_DIR = path.join(ROOT, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

// Tiny .env loader: KEY=VALUE lines, # comments, no interpolation. Values already in the environment win.
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
  for (const raw of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 0) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

export const env = {
  openrouterKey: process.env.OPENROUTER_API_KEY || '',
  host: process.env.PANEL_HOST || '127.0.0.1',
  port: Number(process.env.PANEL_PORT || 4777),
  asideBin: process.env.ASIDE_BIN || 'aside',
  tz: process.env.TZ || 'UTC',
};
export const PANEL_URL = `http://${env.host}:${env.port}`;
