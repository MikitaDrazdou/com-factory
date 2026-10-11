import { decide, type Question, type Answer } from './openrouter.ts';
import { models, type PlatformConfig } from './settings.ts';
import { productLine, type Product } from './products.ts';

export interface Scored { answers: Record<string, Answer>; cost: number; decision: 'draft' | 'skip'; reason: string; lang: string; kind: string; fit: number }

/** Ask Jev whether a post is worth a reply for this product. All questions go in one call. */
export async function scorePost(platform: string, cfg: PlatformConfig, product: Product | undefined, state: Record<string, unknown>): Promise<Scored> {
  const product_ = productLine(product);
  const threads = platform === 'threads';
  const topic = product?.audience ? `${product_}. Audience: ${product.audience}` : product_;
  const questions: Record<string, Question> = {
    relevant: {
      type: 'noul',
      instructions: threads
        ? `The post is about a topic where the product below is genuinely relevant: travelling abroad (first trip, packing, airports, paying abroad, visas, insurance, routes, travelling with kids, country tips) or staying connected abroad (SIM, eSIM, roaming, mobile internet, VPN), OR it is an "introduce yourself / share your project" thread where people present what they do. Product: ${topic}`
        : `The post is about mobile connectivity in any context: SIM, eSIM, chip, roaming, mobile data, a carrier or plan, no signal, activation trouble, internet while travelling, wifi abroad; OR about travelling abroad: first trip, packing, airports, paying abroad, visas, apps that need internet. A complaint, a joke or a short rant about one of these topics counts as relevant. Product: ${topic}`,
      criteria: { true: 'Matches the topic above', false: 'Unrelated, metaphorical use of the words, or a different topic' },
    },
    kind: {
      type: 'choice',
      instructions: 'What kind of post is this?',
      criteria: {
        question: 'The author asks for advice, recommendations or help',
        discussion: 'The author shares an experience, complaint or opinion that invites replies',
        ...(threads ? { intro: 'An "introduce yourself", "what do you build", "promote your project" thread inviting people to present themselves' } : {}),
        ad: 'Promotes a product, service, promo code, giveaway or affiliate link',
        news: 'News, politics, announcements, press',
        other: 'Jokes, memes, personal chatter, anything else',
      },
    },
    fit: {
      type: 'score',
      instructions: `How good is this post for a short, genuinely useful reply from the person who runs ${product_}? Excellent: asks which SIM/eSIM/internet option to use abroad, or complains about roaming, an eSIM, a carrier, no signal or expensive mobile data${threads ? '' : ' (at home or abroad: a practical tip about eSIM/plans is welcome either way)'}, or VPN abroad. Good: a concrete travel question (${threads ? 'where to go for given dates or a season, ' : ''}packing, payment abroad, airport, visa, first trip, kids) where a practical tip adds real value${threads ? ', or an intro thread where a one-line self-presentation is welcome' : ''}. Weak: travel topic with no natural angle. Bad: ads, news, politics, brand accounts, domestic transport, tech reviews.`,
      criteria: ['Bad fit', 'Weak fit', 'Good fit', 'Excellent fit'],
    },
    lang: {
      type: 'choice',
      instructions: 'Main language of the post text',
      criteria: { pt: 'Portuguese', es: 'Spanish', en: 'English', ru: 'Russian', other: 'Any other language (Kazakh, Chinese, Indonesian, ...)' },
    },
    risk: {
      type: 'noul',
      instructions: 'Replying would look inappropriate or spammy: the post is political, about a tragedy or death, hostile, sarcastic bait, adult content, a brand/business/promo account, a competitor selling eSIM/SIM, or the author is clearly a bot',
      criteria: { true: 'Risky to reply', false: 'Normal post by a real person' },
    },
  };
  const { answers, cost } = await decide(models().jev, state, questions);
  const rel = answers.relevant?.noul ?? 0;
  const kind = answers.kind?.choice ?? 'other';
  const fit = answers.fit?.score ?? 0;
  const lang = answers.lang?.choice ?? 'other';
  const risk = answers.risk?.noul ?? 1;
  const langs = product?.languages?.length ? product.languages : cfg.languages;
  let reason = '';
  if (rel < cfg.min_relevance) reason = `relevance ${rel.toFixed(2)} < ${cfg.min_relevance}`;
  else if (!['question', 'discussion', 'intro'].includes(kind)) reason = `kind=${kind}`;
  else if (fit < cfg.min_fit) reason = `fit ${fit.toFixed(2)} < ${cfg.min_fit}`;
  else if (risk >= (cfg.max_risk ?? 0.35)) reason = `risk ${risk.toFixed(2)} ≥ ${cfg.max_risk ?? 0.35}`;
  else if (langs.length && !langs.includes(lang)) reason = `language ${lang} not in [${langs.join(',')}]`;
  return { answers, cost, decision: reason ? 'skip' : 'draft', reason: reason || `fit ${fit.toFixed(2)}, ${kind}, ${lang}`, lang, kind, fit };
}

export type InboundKind = 'A' | 'B' | 'C' | 'D';
/** Classify a reply someone left under our comment: A question, B interest, C thanks, D negative/other. */
export async function classifyInbound(state: { their_reply: string; our_comment: string; author: string }): Promise<{ kind: InboundKind; confidence: number; cost: number; lang: string }> {
  const { answers, cost } = await decide(models().jev, state, {
    kind: {
      type: 'choice',
      instructions: 'Someone replied to our comment. What is their reply?',
      criteria: {
        A: 'A question or request: asks about a country, dates, price, plan, how to install, whether it works somewhere, or any travel question',
        B: 'Positive interest without a question: "I need this too", "useful", "saving this", "we fly in October"',
        C: 'Simple thanks or an emoji, nothing to answer',
        D: 'Negative, argument, trolling, competitor promotion, spam, or a reply not addressed to us',
      },
    },
    lang: { type: 'choice', instructions: 'Language of their reply', criteria: { ru: 'Russian', en: 'English', pt: 'Portuguese', es: 'Spanish', other: 'Other' } },
  });
  const kind = (answers.kind?.choice as InboundKind) ?? 'D';
  return { kind: ['A', 'B', 'C', 'D'].includes(kind) ? kind : 'D', confidence: answers.kind?.confidence ?? 0, cost, lang: answers.lang?.choice ?? 'en' };
}
