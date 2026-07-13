# Loop

**A Slack-native mutual-aid matching agent for communities and nonprofits.**

Loop quietly reads the everyday messages in a community's Slack, notices when
someone needs help and when someone offers it, and connects the two — with a
human in the loop and consent before any introduction is made.

---

## The problem

In mutual-aid groups, nonprofits, and support communities, help genuinely
exists — but it's scattered. An offer of "I can drive people to clinic
appointments on weekday mornings" gets posted on Tuesday and buried by Thursday.
A week later someone asks for exactly that in a different channel, and never sees
it. The willingness is there; the **connection across time and channels** is not.

## What Loop does

Loop turns the community's own conversation into a living directory of help:

1. **Listens** to messages across channels it's in.
2. **Classifies** each one as a *need*, an *offer*, or *neither* (Groq LLM).
3. **Remembers** offers in a local store so they're matchable later.
4. When a **need** appears, it **searches the community's real history** using
   Slack Real-Time Search, then **ranks** the best few helpers.
5. Posts a calm **match card** in the thread — a human picks who to reach out to.
6. **Asks the chosen volunteer privately**, without revealing the requester,
   and only introduces the two people **after the volunteer says yes**.

Nothing is auto-matched behind people's backs. Loop suggests; humans decide.

## How it works (the flow)

```
message → classify (need / offer / neither)
        → offer memory (SQLite)
        → RTS search over community history (user token)
        → rank candidates (Groq)
        → Block Kit match card (human confirms)
        → private consent DM to the volunteer (identity hidden)
        → introduction in-thread (requester ↔ volunteer)
        → status / outcome tracking + App Home dashboard
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full diagram.

## Tech stack

| Piece | Choice |
|---|---|
| Slack framework | **Bolt for JavaScript** (Socket Mode) |
| Language model | **Groq** — open-weight `gpt-oss-120b`, via the OpenAI-compatible endpoint |
| Search / matching substrate | **Slack Real-Time Search** — `assistant.search.context`, with `search.messages` as a graceful fallback |
| Storage | **SQLite** (`better-sqlite3`) — offers, needs, and match state |
| Interface | Block Kit cards, private DMs, and an **App Home** dashboard |

The LLM does two narrow jobs (classify, then rank). The matching *substrate* —
the community's real message history — is provided by Slack RTS.

## Setup

**Prerequisites:** Node.js 20+, a Slack workspace where you can install apps, and
a free [Groq API key](https://console.groq.com).

1. **Create the Slack app** from [`manifest.json`](./manifest.json)
   (api.slack.com/apps → *From an app manifest*), then install it.
2. **Install dependencies:**
   ```sh
   npm install
   ```
3. **Configure `.env`** (copy from `.env.sample`):
   ```sh
   GROQ_API_KEY=your_groq_key          # required — classifier + ranker
   SLACK_BOT_TOKEN=xoxb-...             # required — post cards, open DMs
   SLACK_APP_TOKEN=xapp-...             # required — Socket Mode (connections:write)
   SLACK_USER_TOKEN=xoxp-...            # required — Real-Time Search
   ```
4. **Invite the bot** to the channels it should watch (`/invite @loop`).
5. *(Optional)* Seed realistic history for a demo:
   ```sh
   node scripts/seed.js
   ```

## Run

```sh
npm start          # Socket Mode
# or, with the Slack CLI:
slack run
```

You should see `Starter Agent is running!` and `[db] SQLite initialized`.
Post an offer, then a matching need, in a channel the bot is in — and watch the
match card appear.

## Required scopes

**Bot token:** `app_mentions:read`, `channels:history`, `groups:history`,
`im:history`, `im:read`, `im:write`, `chat:write`, `reactions:read`,
`reactions:write`, `users:read`, `assistant:write`.

**User token (for Real-Time Search):** `search:read` (and its
`search:read.public` / `.private` / `.im` / `.mpim` variants),
`channels:read`, `groups:read`, `users:read`.

## Project layout

```
app.js                     Socket Mode entry point
lib/
  db.js                    SQLite store (offers, needs, match state)
  send-prompt.js           Groq wrapper (classify + rank)
  matcher.js               candidate gathering, RTS search, ranking
listeners/
  events/message-ingest.js classify every channel message; run the matcher
  actions/match-actions.js consent-first state machine (confirm → consent → intro)
  views/                   Block Kit: match card, consent DM, App Home
scripts/seed.js            demo history seeder
```
