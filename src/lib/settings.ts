import { get, run, j } from './db.ts';

export type Mode = 'dry' | 'review' | 'auto';
export const MODES: Record<Mode, { label: string; hint: string }> = {
  dry: { label: 'Только черновики', hint: 'Ищет посты и пишет черновики, ничего не публикует.' },
  review: { label: 'С подтверждением', hint: 'Черновики ждут вашего «Одобрить» в очереди.' },
  auto: { label: 'Автоматически', hint: 'Публикует сам в пределах лимитов и активных часов.' },
};

export interface PlatformConfig {
  enabled: boolean;
  mode: Mode;
  /** Our username on the platform (Threads needs it for login checks and stats; X reads it from the session). */
  handle: string;
  /** Our own comments per day (comments made by other tools, e.g. an Aside routine, are not counted here). */
  daily_limit: number;
  per_run_limit: number;
  min_gap_minutes: number;
  /** Total comments per day on the account including imported ones (Aside routine). 0 = no cap. */
  account_daily_cap: number;
  active_hours: { start: number; end: number; tz: string };
  /** Search cadence in minutes (X). 0 = never. */
  run_every_minutes: number;
  /** Run times HH:MM in active_hours.tz (Threads). */
  schedule_times: string[];
  /** General query pool, used by products that have no queries of their own. */
  queries: string[];
  /** Threads: "introduce yourself" threads where a short self-presentation is welcome. */
  intro_queries: string[];
  /** X: words excluded from search results (ads, coupons). */
  negative_terms: string[];
  languages: string[];
  max_age_minutes: number;
  min_followers: number;
  author_cooldown_days: number;
  like_post: boolean;
  product_mention_ratio: number;
  /** Share of our comments that may carry a product link (only when links_enabled). */
  link_ratio: number;
  /** Whether comments on this platform may carry a link at all. */
  links_enabled: boolean;
  /** UTM query appended to every link on this platform (replaces any utm_* the link already has), e.g. "utm_source=threads&utm_medium=comment". */
  utm: string;
  /** Extra links for this platform, on top of the product links. */
  links: { label: string; url: string }[];
  /** Threads: allow prices in first comments (inbound answers may always quote prices). */
  prices_allowed: boolean;
  /** Threads: how often (days) we may join an intro thread. 0 = never. */
  selfpromo_every_days: number;
  /** Threads: max replies to inbound comments per run. */
  inbound_limit: number;
  inbound_reply: boolean;
  /** Threads: path to an Aside routine MEMORY.md; imported hourly so both tools never hit the same post or author. */
  memory_import_path: string;
  min_relevance: number;
  min_fit: number;
  /** Jev: skip posts whose risk score (politics, tragedies, brand accounts, bots) is at or above this. */
  max_risk: number;
  stats_every_minutes: number;
}

export const DEFAULTS: Record<string, PlatformConfig> = {
  x: {
    enabled: true,
    mode: 'auto',
    handle: '',
    daily_limit: 4,
    per_run_limit: 2,
    min_gap_minutes: 60,
    account_daily_cap: 0,
    active_hours: { start: 9, end: 22, tz: 'America/Sao_Paulo' },
    run_every_minutes: 15,
    schedule_times: [],
    // Genuine "which eSIM / roaming bill" posts in pt/es are rare on X: specific queries return weeks-old posts,
    // so the pool mixes specific and medium-width queries and the freshness window is two weeks. Jev does the narrowing.
    queries: [
      'esim', 'roaming', 'chip internacional', 'chip de viagem', 'internet no exterior', 'internet na europa', 'internet na viagem',
      'qual esim', 'melhor esim', 'esim europa', 'cobrada por roaming', 'roaming vivo', 'roaming claro', 'esim ou chip',
      'chip para viajar', 'internet en el extranjero', 'datos en el extranjero', 'internet en europa viaje', 'roaming movistar',
      'mejor esim', 'qué esim', 'esim europa', 'esim estados unidos', 'sin señal en el extranjero',
    ],
    intro_queries: [],
    negative_terms: ['holafly', 'airalo', 'cupom', 'cupón', 'desconto', 'descuento', 'promo', 'código', 'codigo', 'sorteio', 'giveaway', 'venda', 'vendo', 'iphone'],
    languages: ['pt', 'es'],
    max_age_minutes: 14 * 24 * 60,
    min_followers: 50,
    author_cooldown_days: 30,
    like_post: true,
    product_mention_ratio: 0.25,
    link_ratio: 0,
    links_enabled: false,
    utm: 'utm_source=x&utm_medium=comment',
    links: [],
    prices_allowed: false,
    selfpromo_every_days: 0,
    inbound_limit: 0,
    inbound_reply: false,
    memory_import_path: '',
    // Loose on purpose: the pt/es eSIM niche on X is thin, so a carrier complaint or a short rant about eSIM also qualifies.
    min_relevance: 0.5,
    min_fit: 1.2,
    max_risk: 0.5,
    stats_every_minutes: 120,
  },
  threads: {
    enabled: true,
    mode: 'review',
    handle: '',
    daily_limit: 4,
    per_run_limit: 2,
    min_gap_minutes: 3,
    account_daily_cap: 14,
    active_hours: { start: 8, end: 23, tz: 'Europe/Moscow' },
    run_every_minutes: 0,
    schedule_times: ['11:00', '19:00'],
    queries: [
      'which esim', 'esim recommendation', 'esim for europe', 'esim for japan', 'going to China which esim', 'roaming charges', 'data abroad',
      'first time traveling to', 'first trip abroad', 'travel insurance', 'layover', 'packing list', 'travel tips japan',
    ],
    intro_queries: ['introduce yourself', 'what are you building', 'share your project', 'what do you do thread'],
    negative_terms: [],
    languages: ['en'],
    max_age_minutes: 3 * 24 * 60,
    min_followers: 0,
    author_cooldown_days: 30,
    like_post: true,
    product_mention_ratio: 0.5,
    link_ratio: 0.25,
    links_enabled: true,
    utm: 'utm_source=threads&utm_medium=comment',
    links: [],
    prices_allowed: false,
    selfpromo_every_days: 2,
    inbound_limit: 4,
    inbound_reply: true,
    memory_import_path: '',
    min_relevance: 0.75,
    min_fit: 2.0,
    max_risk: 0.35,
    stats_every_minutes: 240,
  },
};

/** Jev (post selection) runs via OpenRouter. All text (comments, replies, voice commands) is written by the model connected to Aside. */
export interface ModelsConfig { jev: string; text_provider: string; text_model: string; text_effort: string }
export const MODEL_DEFAULTS: ModelsConfig = {
  jev: 'typesafe/jev-1.13',
  text_provider: 'claude-code',
  text_model: 'claude-opus-5',
  text_effort: 'low',
};
export const EFFORTS = ['off', 'minimal', 'low', 'medium', 'high'];

export function getSetting<T>(key: string, fallback: T): T {
  const row = get('SELECT value FROM settings WHERE key = ?', key);
  return row ? j<T>(row.value, fallback) : fallback;
}
export function setSetting(key: string, value: unknown) {
  run('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value));
}

export function platformConfig(platform: string): PlatformConfig {
  const base = DEFAULTS[platform];
  if (!base) throw new Error(`unknown platform ${platform}`);
  const saved = getSetting<Partial<PlatformConfig>>(`platform:${platform}`, {});
  const cfg = { ...base, ...saved };
  cfg.active_hours = { ...base.active_hours, ...(saved.active_hours ?? {}) };
  return cfg;
}
export function savePlatformConfig(platform: string, patch: Partial<PlatformConfig>) {
  const current = getSetting<Partial<PlatformConfig>>(`platform:${platform}`, {});
  setSetting(`platform:${platform}`, { ...current, ...patch });
}
export function models(): ModelsConfig {
  return { ...MODEL_DEFAULTS, ...getSetting<Partial<ModelsConfig>>('models', {}) };
}
export const PLATFORMS = ['x', 'threads'] as const;
export const platformName = (p: string) => (p === 'x' ? 'X' : p === 'threads' ? 'Threads' : p);
