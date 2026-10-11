import { env } from './env.ts';
import { log } from './log.ts';

const BASE = 'https://openrouter.ai/api';

async function post(path: string, body: unknown, timeoutMs = 90_000): Promise<any> {
  if (!env.openrouterKey) throw new Error('OPENROUTER_API_KEY is not set');
  for (let attempt = 1; attempt <= 2; attempt++) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(BASE + path, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.openrouterKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://github.com/MikitaDrazdou/com-factory',
          'X-OpenRouter-Title': 'com-factory',
        },
        body: JSON.stringify(body),
        signal: ctl.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        if (res.status >= 500 && attempt === 1) { log('openrouter', `HTTP ${res.status}, retrying`); continue; }
        throw new Error(`OpenRouter ${res.status}: ${text.slice(0, 400)}`);
      }
      return JSON.parse(text);
    } finally {
      clearTimeout(t);
    }
  }
}

export type Question =
  | { type: 'noul'; instructions: string; criteria?: { true: string; false: string } }
  | { type: 'choice'; instructions: string; criteria: Record<string, string> }
  | { type: 'score'; instructions: string; criteria: string[] };

export interface Answer { type: string; noul?: number; choice?: string; score?: number; probabilities?: Record<string, number>; confidence?: number }

/** Jev (TypeSafe System One) via OpenRouter's decisions endpoint. */
export async function decide(model: string, state: unknown, questions: Record<string, Question>): Promise<{ answers: Record<string, Answer>; cost: number }> {
  const r = await post('/alpha/decisions', { model, state, questions }, 30_000);
  return { answers: r.answers, cost: r.usage?.cost ?? 0 };
}

export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }

/** Chat completion. Reasoning models spend tokens on thinking before answering, so the budget is generous and the effort low. */
export async function chat(model: string, messages: ChatMessage[], opts: { json?: boolean; temperature?: number; maxTokens?: number; reasoning?: 'low' | 'medium' | 'high' } = {}): Promise<string> {
  const body: any = { model, messages, temperature: opts.temperature ?? 0.7, max_tokens: opts.maxTokens ?? 2500, reasoning: { effort: opts.reasoning ?? 'low' } };
  if (opts.json) body.response_format = { type: 'json_object' };
  const r = await post('/v1/chat/completions', body);
  const choice = r.choices?.[0];
  let content = choice?.message?.content;
  if (Array.isArray(content)) content = content.map((p: any) => (typeof p === 'string' ? p : p?.text ?? '')).join('');
  if (typeof content !== 'string' || !content.trim()) {
    const why = choice?.finish_reason === 'length' ? 'the token budget was spent on reasoning' : `finish_reason=${choice?.finish_reason ?? 'none'}`;
    throw new Error(`OpenRouter: empty completion (${why})`);
  }
  if (choice?.finish_reason === 'length') log('openrouter', 'completion truncated (length)');
  return content;
}

export function parseJson(text: string): any {
  const cleaned = text.replace(/```(?:json)?/gi, '').trim();
  const m = cleaned.match(/\{[\s\S]*\}/);
  return JSON.parse(m ? m[0] : cleaned);
}
