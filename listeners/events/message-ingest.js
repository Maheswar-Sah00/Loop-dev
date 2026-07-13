import { addNeed, addOffer } from '../../lib/db.js';
import { findMatches } from '../../lib/matcher.js';
import { sendPrompt } from '../../lib/send-prompt.js';
import { publishHomeView } from './app-home-opened.js';
import { buildMatchCardBlocks } from '../views/match-card-builder.js';

/**
 * System instruction for the need/offer classifier. The model must reply with
 * ONLY a JSON object matching the shape documented below.
 */
const CLASSIFIER_SYSTEM = `\
You are a message classifier for a Slack community that connects people who \
need help with people who offer help. Classify a single Slack message into \
exactly one type:

- "offer": the author is volunteering a skill, resource, time, or help to others.
- "need": the author is requesting help — looking for a skill, resource, or person.
- "neither": anything else — greetings, jokes, vague chatter, status updates, or \
when you are unsure. When in doubt, choose "neither".

Also extract:
- skills: array of concise skill/topic keywords (e.g. ["react","design"]). Empty array if none.
- timing: any availability, deadline, or timing mentioned, else null.
- location: any location mentioned, else null.
- language: the primary human language of the message as an ISO code (e.g. "en", "es"), \
or a specific language explicitly required, else null.

Reply with ONLY a JSON object, no prose and no markdown, with exactly these keys: \
type, skills, timing, location, language.`;

/**
 * @param {import('@slack/types').MessageEvent} event
 * @returns {event is import('@slack/types').GenericMessageEvent}
 */
function isGenericMessageEvent(event) {
  return !('subtype' in event && event.subtype !== undefined);
}

// Message timestamps already ingested, so Slack's delivery retries don't
// classify/store the same message more than once. Capped to avoid unbounded growth.
const processedTs = new Set();

/**
 * Ingest top-level channel messages, classify them via Groq, and store any
 * detected offers/needs. Posts nothing to Slack — console output only.
 *
 * The Groq call is deliberately NOT awaited here: classification is slower than
 * Slack's ~3s event-ack window, and blocking would make Slack retry the delivery
 * (duplicating work/rows). We return immediately so Bolt acks fast, and run the
 * classification in the background.
 * @param {import('@slack/bolt').AllMiddlewareArgs & import('@slack/bolt').SlackEventMiddlewareArgs<'message'>} args
 * @returns {Promise<void>}
 */
export async function handleMessageIngest({ client, context, event, logger }) {
  // Skip subtypes (edits, deletes, joins, bot_message, etc.)
  if (!isGenericMessageEvent(event)) return;

  // Skip the app's own messages and any other bots.
  if (event.bot_id) return;
  if (context.botUserId && event.user === context.botUserId) return;

  // Only public/private channel messages (not DMs or group DMs).
  if (event.channel_type !== 'channel' && event.channel_type !== 'group') return;

  // Only top-level messages — ignore threaded replies.
  if (event.thread_ts) return;

  const text = (event.text || '').trim();
  if (!text) return;

  // Dedupe: Slack redelivers the same message on retry; process each ts once.
  if (processedTs.has(event.ts)) return;
  processedTs.add(event.ts);
  if (processedTs.size > 1000) {
    for (const ts of processedTs) {
      processedTs.delete(ts);
      if (processedTs.size <= 800) break;
    }
  }

  // Fire-and-forget so the event ack isn't blocked on the Groq call.
  classifyAndStore(text, event, logger, client).catch((e) => logger.error(`Ingestion failed: ${e}`));
}

/**
 * Classify a message and persist any detected offer/need. Never throws.
 * @param {string} text
 * @param {import('@slack/types').GenericMessageEvent} event
 * @param {import('@slack/bolt').Logger} logger
 * @param {import('@slack/web-api').WebClient} client
 * @returns {Promise<void>}
 */
async function classifyAndStore(text, event, logger, client) {
  /** @type {{ type: string, skills?: string[], timing?: string|null, location?: string|null, language?: string|null }} */
  let result;
  try {
    result = await sendPrompt(text, { expectJson: true, system: CLASSIFIER_SYSTEM });
  } catch (e) {
    logger.error(`Classification failed: ${e}`);
    return;
  }

  const skills = Array.isArray(result?.skills) ? result.skills : [];
  const timing = result?.timing ?? null;
  const location = result?.location ?? null;
  const language = result?.language ?? null;

  if (result?.type === 'offer') {
    addOffer({
      user_id: /** @type {string} */ (event.user),
      channel_id: event.channel,
      message_ts: event.ts,
      skills,
      availability_text: timing ?? undefined,
      location: location ?? undefined,
      language: language ?? undefined,
      raw_excerpt: text,
      created_ts: Math.floor(Date.now() / 1000),
    });
    console.log(`Classified as OFFER: ${JSON.stringify(result)}`);
  } else if (result?.type === 'need') {
    const need = addNeed({
      requester_id: /** @type {string} */ (event.user),
      channel_id: event.channel,
      message_ts: event.ts,
      need_skills: skills,
      timing: timing ?? undefined,
      location: location ?? undefined,
      language: language ?? undefined,
      raw_text: text,
    });
    console.log(`Classified as NEED: ${JSON.stringify(result)}`);
    console.log(`NEED detected: ${JSON.stringify(skills)} — running matcher`);
    const matches = await findMatches(need);
    if (matches.length > 0) {
      await postMatchCard(client, need, matches, logger);
    }
    // The dashboard changed (new need, possibly no_match) — refresh the asker's Home.
    await publishHomeView(client, need.requester_id);
  }
  // "neither": do nothing, stay silent.
}

/**
 * Post the match suggestion card as a threaded reply on the original need message.
 * @param {import('@slack/web-api').WebClient} client
 * @param {import('../../lib/db.js').Need} need
 * @param {Array<{user_id:string, confidence:string, reason:string, offer_age_days:number|null}>} matches
 * @param {import('@slack/bolt').Logger} logger
 * @returns {Promise<void>}
 */
async function postMatchCard(client, need, matches, logger) {
  const shown = matches.filter((m) => m.confidence === 'high' || m.confidence === 'medium').slice(0, 3);
  if (shown.length === 0) return;

  // Resolve display names for the button labels (falls back gracefully).
  /** @type {Record<string, string>} */
  const names = {};
  for (const m of shown) {
    try {
      const res = await client.users.info({ user: m.user_id });
      names[m.user_id] = res.user?.profile?.display_name || res.user?.real_name || res.user?.name || '';
    } catch {
      names[m.user_id] = '';
    }
  }

  const blocks = buildMatchCardBlocks(shown, names, need.id);
  try {
    await client.chat.postMessage({
      channel: need.channel_id,
      thread_ts: need.message_ts,
      text: 'I found someone who may be able to help',
      blocks,
    });
    console.log(`Posted match card for need ${need.id} in thread ${need.message_ts}`);
  } catch (e) {
    logger.error(`Failed to post match card: ${e}`);
  }
}
