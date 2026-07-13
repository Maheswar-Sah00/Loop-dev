import { WebClient } from '@slack/web-api';

import { listActiveOffers, updateNeedStatus } from './db.js';
import { sendPrompt } from './send-prompt.js';

/**
 * Matching for detected needs: gather candidate helpers from local offers and a
 * single Slack search, merge/dedupe them, then rank with Groq.
 */

// Web API client authorized with the USER token (xoxp-), required for search.
const userToken = process.env.SLACK_USER_TOKEN;
const userClient = userToken ? new WebClient(userToken) : null;

// TEST HOOK ONLY (off by default): when MATCH_ALLOW_SELF=1, a requester can be
// matched to their own offer. Used to demo the consent flow with a single
// account. Leave unset in normal operation.
const ALLOW_SELF_MATCH = process.env.MATCH_ALLOW_SELF === '1';

const RANK_SYSTEM = `\
You match a help REQUEST (a "need") to candidate helpers in a community.

You are given the need and a list of candidates, each with a user_id and the text \
of their offer or message. Judge who GENUINELY fits, considering skill match, \
timing/availability, language, and location. OMIT anyone who does not genuinely fit \
— it is correct to return an empty list.

Return at most 3 candidates, best fit first. Reply with ONLY a JSON object of this shape:
{ "matches": [
    { "user_id": string,
      "confidence": "high" | "medium" | "low",
      "reason": "<one short human sentence explaining the fit>",
      "offer_age_days": number | null }
] }

"confidence" reflects how well the candidate fits the need. "reason" is a single short, \
warm, human sentence in plain language — no jargon, no numbers or percentages (e.g. \
"Speaks Telugu and is free on Thursdays"). If nobody genuinely fits, return { "matches": [] }.`;

/**
 * @typedef {import('./db.js').Need} Need
 */

/**
 * @typedef {Object} Candidate
 * @property {string} user_id
 * @property {string} text            Offer/message text used as context.
 * @property {'offer'|'search'} source
 * @property {number | null} created_ts
 * @property {number | null} offer_age_days
 */

/**
 * Find and rank candidate helpers for a detected need. Logs each step; posts
 * nothing to Slack (Task 5 adds the card).
 * @param {Need} need
 * @returns {Promise<any[]>} The ranked matches (may be empty).
 */
export async function findMatches(need) {
  const nowSec = Math.floor(Date.now() / 1000);
  const query = buildQuery(need);
  console.log(`[matcher] need ${need.id}: query="${query}"`);

  // --- STEP 1a: local offers ------------------------------------------------
  const offers = listActiveOffers();
  console.log(`[matcher] local active offers: ${offers.length}`);

  /** @type {Map<string, Candidate>} */
  const byUser = new Map();
  for (const offer of offers) {
    if (!ALLOW_SELF_MATCH && offer.user_id === need.requester_id) continue; // don't match a requester to themselves
    const offerText = offer.raw_excerpt || [offer.skills.join(', '), offer.availability_text].filter(Boolean).join(' — ');
    const existing = byUser.get(offer.user_id);
    if (existing) {
      // A person can have several offers — keep all their skills in context so
      // any of them can match (offers are newest-first, so the first sets the age).
      existing.text = `${existing.text} · ${offerText}`;
    } else {
      byUser.set(offer.user_id, {
        user_id: offer.user_id,
        text: offerText,
        source: 'offer',
        created_ts: offer.created_ts ?? null,
        offer_age_days: offer.created_ts ? Math.floor((nowSec - offer.created_ts) / 86400) : null,
      });
    }
  }

  // --- STEP 1b: exactly one Slack search (RTS, then fallback) ---------------
  const searchHits = await searchSlack(query);
  for (const hit of searchHits) {
    if (!hit.user_id || (!ALLOW_SELF_MATCH && hit.user_id === need.requester_id)) continue;
    if (byUser.has(hit.user_id)) continue; // offer text wins as context
    byUser.set(hit.user_id, {
      user_id: hit.user_id,
      text: hit.text,
      source: 'search',
      created_ts: null,
      offer_age_days: null,
    });
  }

  // --- STEP 2: merged candidates -------------------------------------------
  const candidates = [...byUser.values()];
  console.log(`[matcher] merged candidates: ${candidates.length} (deduped by user_id)`);

  if (candidates.length === 0) {
    updateNeedStatus(need.id, 'no_match');
    console.log(`NO MATCH for need ${need.id}`);
    return [];
  }

  // --- STEP 3: rank with Groq ----------------------------------------------
  const ageByUser = new Map(candidates.map((c) => [c.user_id, c.offer_age_days]));
  let matches;
  try {
    const prompt = JSON.stringify({
      need: {
        skills: need.need_skills,
        timing: need.timing,
        location: need.location,
        language: need.language,
        text: need.raw_text,
      },
      candidates: candidates.map((c) => ({ user_id: c.user_id, text: c.text, offer_age_days: c.offer_age_days })),
    });
    const ranked = await sendPrompt(prompt, { expectJson: true, system: RANK_SYSTEM });
    matches = Array.isArray(ranked) ? ranked : Array.isArray(ranked?.matches) ? ranked.matches : [];
  } catch (e) {
    console.error(`[matcher] ranking failed: ${e}`);
    updateNeedStatus(need.id, 'no_match');
    console.log(`NO MATCH for need ${need.id}`);
    return [];
  }

  // Trust our own age computation over the model's.
  for (const m of matches) {
    m.offer_age_days = ageByUser.has(m.user_id) ? ageByUser.get(m.user_id) : (m.offer_age_days ?? null);
  }

  // --- STEP 4: decide match vs no_match ------------------------------------
  const hasMediumPlus = matches.some((m) => m.confidence === 'high' || m.confidence === 'medium');
  if (!hasMediumPlus) {
    updateNeedStatus(need.id, 'no_match');
    console.log(`NO MATCH for need ${need.id}`);
    return [];
  }

  console.log(`MATCHES for need ${need.id}: ${JSON.stringify(matches)}`);
  return matches;
}

/**
 * Build a single search query from the need's skills, location, and language.
 * @param {Need} need
 * @returns {string}
 */
function buildQuery(need) {
  const parts = [
    ...(Array.isArray(need.need_skills) ? need.need_skills : []),
    need.timing,
    need.location,
    need.language,
  ];
  return parts.filter(Boolean).join(' ').trim();
}

/**
 * Run exactly one Slack search for the query: try the Real-Time Search method
 * assistant.search.context first, fall back to search.messages on error. All
 * calls are wrapped so a failure just yields zero hits.
 * @param {string} query
 * @returns {Promise<Array<{ user_id: string | undefined, text: string }>>}
 */
async function searchSlack(query) {
  if (!userClient) {
    console.log('[matcher] no SLACK_USER_TOKEN set — skipping Slack search, using local offers only');
    return [];
  }
  if (!query) {
    console.log('[matcher] empty query — skipping Slack search');
    return [];
  }

  // Try Real-Time Search first.
  try {
    const res = /** @type {any} */ (await userClient.apiCall('assistant.search.context', { query, limit: 20 }));
    const messages = res?.results?.messages ?? res?.messages ?? [];
    const hits = messages.map(mapRtsMessage).filter((/** @type {any} */ h) => h.text);
    console.log(`[matcher] RTS assistant.search.context OK — ${hits.length} results (used: RTS)`);
    return hits;
  } catch (e) {
    console.log(`[matcher] RTS assistant.search.context unavailable (${errText(e)}) — falling back to search.messages`);
  }

  // Fallback: classic search.messages.
  try {
    const res = /** @type {any} */ (await userClient.search.messages({ query, count: 20 }));
    const matches = res?.messages?.matches ?? [];
    const hits = matches.map((/** @type {any} */ m) => ({ user_id: m.user, text: m.text || '' })).filter((h) => h.text);
    console.log(`[matcher] search.messages OK — ${hits.length} results (used: fallback)`);
    return hits;
  } catch (e) {
    console.error(`[matcher] search.messages failed (${errText(e)}) — continuing with local offers only`);
    return [];
  }
}

/**
 * Normalize a Real-Time Search result message into { user_id, text }.
 * @param {any} m
 * @returns {{ user_id: string | undefined, text: string }}
 */
function mapRtsMessage(m) {
  return {
    user_id: m?.author_user_id ?? m?.user ?? m?.user_id,
    text: m?.content ?? m?.text ?? m?.message?.text ?? '',
  };
}

/**
 * @param {unknown} e
 * @returns {string}
 */
function errText(e) {
  const err = /** @type {any} */ (e);
  return err?.data?.error || err?.message || String(err);
}
