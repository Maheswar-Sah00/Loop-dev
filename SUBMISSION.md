# Loop — Devpost Submission

**Track: Slack Agent for Good**

---

## Elevator pitch

Loop is a Slack-native agent that turns a community's everyday conversation into a
living directory of mutual aid — quietly noticing who needs help and who's offered
it, and connecting them with consent and a human in the loop.

---

## The problem

In the communities that run on generosity — mutual-aid groups, nonprofits,
immigrant-support and patient-support networks — help genuinely exists. Someone
offers to interpret at hospital visits on Thursdays. Someone else can drive people
to clinic appointments. Someone can help fill out government forms.

But those offers get **buried**. They're posted in one channel on a Tuesday and
scrolled away by Thursday. A week later, someone in a different channel asks for
exactly that — and never sees the offer that already exists. The willingness is
there. What's missing is the connection **across channels and across time**.

Group organizers end up being human routers, holding it all in their heads and
burning out. Most matches simply never happen.

---

## What Loop does

Loop reads the community's own messages and does the connecting work:

- **Understands** each message as a need, an offer, or neither.
- **Remembers** every offer, so it stays matchable long after it scrolls away.
- When a need appears, it **searches the community's real history** and **ranks**
  the handful of people who genuinely fit — by skill, timing, language, location.
- Posts a calm **match card** in the thread. A human chooses who to reach out to.
- **Asks the chosen volunteer privately** — without revealing who asked — and only
  makes the introduction **after they say yes**.

It never auto-matches, never pressures, and never exposes anyone before consent.
Loop suggests; people decide.

---

## Impact — who this helps, and why it matters

Loop is built for the groups where a missed connection has a real human cost:

- **Mutual-aid networks** coordinating rides, food, and errands for neighbours.
- **Nonprofits and volunteer orgs** matching skills to needs without a paid
  coordinator.
- **Immigrant- and refugee-support communities**, where an interpreter on the
  right day can decide whether someone makes their appointment.
- **Patient- and caregiver-support groups**, where a check-in call or a lift to
  dialysis is the difference between coping and not.

These communities already live in Slack, and they already have the goodwill. What
they lack is capacity — the human hours to remember every offer and route every
request. Loop gives them that capacity back, and does it **safely**: consent-first,
identity-protected, human-confirmed. It doesn't replace the organizer's judgment;
it removes the part that doesn't scale, so more help actually reaches people.

---

## Why it's Slack-native — and couldn't exist without RTS

Loop isn't a bot bolted onto Slack. The community's Slack history **is** the
matching engine.

Real-Time Search (`assistant.search.context`) is used here as a **matching
substrate across time**, not as a search box. When a need arrives, Loop doesn't
look in a private database of things it was explicitly told — it searches the
group's actual conversation, the offers real people made in their own words, days
or weeks earlier. That's the whole point: the match is grounded in genuine
community history, surfaced at the exact moment it's useful. (RTS with a
`search.messages` fallback keeps it robust.)

Take Slack away and there's nothing to match against. This only works because the
help was already being offered in Slack — Loop just makes sure it doesn't vanish.

---

## The technical / uniqueness angle

The interesting part isn't the LLM. Groq is used for two narrow, checkable jobs —
classify a message, then rank candidates — and that's it.

The real "tool" is a **consent-first state machine that manages a sensitive human
handoff**. A need moves through `open → awaiting_consent → matched` (or gracefully
back to `open`), and at every step the design protects people:

- the match card **locks** once someone acts, so two people don't both reach out;
- the volunteer is asked **privately**, and the requester's identity is **hidden**
  until the volunteer agrees;
- only then does the introduction happen, in the open, warmly.

Most "matching bots" are search wrappers that dump results. Loop is the opposite:
it treats a human introduction as something to be handled with care, and encodes
that care in state.

---

## How we built it

- **Bolt for JavaScript**, Socket Mode — one lightweight process, no server to host.
- **Groq** (`gpt-oss-120b`) for classification and ranking, via the
  OpenAI-compatible endpoint.
- **Slack Real-Time Search** (`assistant.search.context`, user token) for matching
  over real history, with `search.messages` as a fallback.
- **SQLite** for offer memory and the need/match state machine.
- **Block Kit** cards, private consent DMs, and an **App Home** dashboard showing
  open needs, recent connections, and offers on file.

Every user-facing word was written to sound like a thoughtful volunteer, not a
robot — calm, brief, and never pushy.

## What's next

- **Offer expiry** — offers age out (or ask "still available?") so matches stay fresh.
- **Overload protection** — cap how often any one volunteer is asked, so the most
  generous people don't get burned out.
- **Outcome tracking** — a light "did this help?" follow-up to learn which matches
  actually worked, and improve ranking over time.
- **Multi-channel scoping** — per-channel rules for where Loop listens and posts.
