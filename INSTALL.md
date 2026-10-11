# com-factory — installation (for humans and for agents)

com-factory is a local admin panel + runner that leaves genuinely useful replies on **X** and **Threads** on behalf of a founder, for one or several products, and keeps the statistics. It uses **Aside Browser** as the hands (your own logged-in sessions), **Jev** (via OpenRouter) to decide which posts deserve a reply, and **the model connected to Aside** (e.g. Claude through the claude-code provider, run with `aside exec`) to write the text. Everything lives in a local SQLite file; nothing leaves your machine except the Jev calls and the model calls made by Aside itself.

If you are an AI agent (Claude Code, Aside, Codex…): follow the steps literally and ask the human only for the things marked **ASK**.

## Requirements

- macOS (Apple Silicon or Intel). Linux works for the panel, but Aside Browser is a desktop app, so the machine needs a desktop session that never sleeps.
- Node.js **24+** (23.6 minimum): `brew install node` or https://nodejs.org
- **Aside Browser** installed and signed in (https://aside.com), with a model provider connected in Aside → Settings → Models (Claude via claude-code by default; change it in Настройки → Система). The installer adds the `aside` CLI if it is missing.
- An **OpenRouter** API key (https://openrouter.ai/keys) — **ASK** the human for it.
- The X and/or Threads account signed in **inside Aside Browser** — **ASK** the human to do it; never type their passwords.

## Install

```bash
git clone git@github.com:MikitaDrazdou/com-factory.git
cd com-factory
bash install.sh --openrouter-key sk-or-...      # add --port 4777 to change the port
```

The script installs dependencies, writes `.env`, registers a launchd service `com.com-factory.panel` (starts at login, restarts on crash) and runs `doctor`. The panel is at **http://127.0.0.1:4777**. Without a service: `npm start`.

## First configuration (5 minutes)

1. Open the panel. **Обзор** shows a checklist of what is still missing.
2. **Настройки → Продукт**: what you sell, who it is for, facts the agent may use, links (with UTM), **search queries of this product**, how to mention it, what never to say. Tick the platforms it applies to. Add as many products as you like: each one is searched by its own queries and drafted with its own context, so one account can serve several products.
3. **Настройки → X**: conservative defaults (4 replies/day, 60 min gap, active hours in the audience timezone, product mentioned in ≤25% of replies, no links/prices ever). Mode **Автоматически** publishes within those limits; **С подтверждением** keeps drafts in the queue until you approve them; **Только черновики** never posts.
4. **Настройки → Threads**: your handle (without @), run times, limits. «Ссылки в комментариях»: whether comments may carry a link, the UTM query for this platform (added to every link automatically, e.g. `utm_source=threads&utm_medium=comment`), the share of comments with a link, and extra platform-only links. Product links come from the product. The same section exists for X (off by default: on X the link lives in the profile). If an Aside routine already comments from the same account, put its `MEMORY.md` path into «Память рутины Aside»: it is imported hourly and com-factory will never reply to a post or an author the routine already handled. «Потолок на аккаунт в день» caps both tools together.
5. Put the product link into the X **profile bio** yourself (Edit profile → Website). On X the bot never posts links; people find the product through the profile.
   A **brand-new X account** (no posts, no bio, no followers) is usually refused by X when it replies through the API: the panel then shows a pause with the reason. Warm it up by hand first: photo, bio, 2–3 own posts, a few manual replies and likes over a week; pass any verification X asks for. The approved drafts stay in the queue and go out once X accepts replies.
6. Wait for the first runs (X: every 15 min in active hours; Threads: at the configured times) and watch **Журнал** / **Очередь**.

Voice or text: the command bar at the top of every page turns an instruction (“поставь для X лимит 6 в день”, “добавь запрос chip internacional Europa”, “пауза Threads на сутки”) into a settings change you confirm before it is applied.

## Commands

```
npm start                 panel + scheduler (what the service runs)
npm run doctor            checks Aside, X/Threads login, OpenRouter/Jev, DB
npm run cf x:tick         X: search → score → draft → post approved (one run)
npm run cf threads:run    Threads: import routine memory → inbound → search → draft → post approved → stats
npm run cf threads:login  check the Threads session
npm run cf x:post [id] / threads:post [id]   post approved drafts (one per call)
node src/cli.ts x:post --now                 same, ignoring active hours (limits and pauses still apply)
npm run cf x:rescore [days]                  re-run Jev on recently skipped X candidates (after loosening thresholds)
npm run cf threads:import <MEMORY.md>        import an Aside routine memory file (history + dedupe)
```

Logs: `data/com-factory.log`, service output in `data/panel.*.log`. Database: `data/com-factory.db`.

## Safety

Automated replies are against the letter of X and Meta rules; the risk is on the account owner. com-factory keeps it small and human-like: low daily limits, minimum gaps, active hours only, one reply per author per 30 days, one reply per thread (across all tools on the account), no links/prices on X, link in at most a quarter of Threads comments, no prices and no "send me your dates" hooks in first comments, immediate stop on any error, captcha or restriction (24 h; 1 h for an X search rate limit). Never run it on accounts you do not own, never with multiple fake accounts.

## Uninstall

```bash
launchctl bootout gui/$(id -u)/com.com-factory.panel; rm ~/Library/LaunchAgents/com.com-factory.panel.plist
rm -rf path/to/com-factory
```
