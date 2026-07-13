import { getNeed, setNeedMatchUser } from '../../lib/db.js';
import { publishHomeView } from '../events/app-home-opened.js';
import { buildConsentCardBlocks } from '../views/consent-card-builder.js';

/**
 * Consent-first matching flow. The need's `status` field is the state machine:
 *   open → awaiting_consent (Confirm) → matched (volunteer accepts)
 *                                     ↘ open (volunteer declines)
 * The requester's identity is never shown to the volunteer until they accept,
 * and the volunteer is never publicly introduced until they accept.
 */

/**
 * @param {string | undefined} value
 * @returns {{ need_id?: number, offer_user_id?: string }}
 */
function parsePayload(value) {
  try {
    return JSON.parse(value || '{}');
  } catch {
    return {};
  }
}

/**
 * @param {string} text
 * @returns {import('@slack/types').KnownBlock[]}
 */
function textBlocks(text) {
  return [{ type: 'section', text: { type: 'mrkdwn', text } }];
}

/**
 * "Confirm <name>" (clicked in the channel): lock the card, mark the need
 * awaiting_consent, and privately DM the chosen volunteer a consent card.
 * @param {import('@slack/bolt').AllMiddlewareArgs & import('@slack/bolt').SlackActionMiddlewareArgs<import('@slack/bolt').BlockButtonAction>} args
 * @returns {Promise<void>}
 */
export async function handleConfirmMatch({ ack, body, client, logger }) {
  await ack();

  try {
    const { need_id, offer_user_id } = parsePayload(body.actions[0].value);
    if (!need_id || !offer_user_id) return;
    console.log(`CONFIRM match clicked: need ${need_id} -> ${offer_user_id}`);

    // 1. State machine: record the chosen volunteer, await their consent.
    const updated = setNeedMatchUser(need_id, 'awaiting_consent', offer_user_id);
    await publishHomeView(client, updated?.requester_id);

    // 2. Lock the public card so nobody else acts on it (buttons removed).
    const channel = /** @type {string} */ (body.channel?.id);
    const ts = /** @type {string} */ (body.message?.ts);
    if (channel && ts) {
      await client.chat.update({
        channel,
        ts,
        text: `Quietly checking with <@${offer_user_id}> to see if they're free…`,
        blocks: textBlocks(`Quietly checking with <@${offer_user_id}> to see if they're free… 🤞`),
      });
    }

    // 3. DM the volunteer a consent card — requester identity stays hidden.
    const need = getNeed(need_id);
    if (!need) {
      logger.error(`confirm_match: need ${need_id} not found`);
      return;
    }
    const dm = await client.conversations.open({ users: offer_user_id });
    const dmChannel = /** @type {string} */ (dm.channel?.id);
    await client.chat.postMessage({
      channel: dmChannel,
      text: 'Someone nearby is hoping for a hand',
      blocks: buildConsentCardBlocks(need),
    });
    console.log(`Sent consent DM to ${offer_user_id} for need ${need_id}`);
  } catch (e) {
    logger.error(`Failed to handle confirm_match: ${e}`);
  }
}

/**
 * Volunteer clicks "I'm available": mark matched and introduce both people in
 * the original need thread.
 * @param {import('@slack/bolt').AllMiddlewareArgs & import('@slack/bolt').SlackActionMiddlewareArgs<import('@slack/bolt').BlockButtonAction>} args
 * @returns {Promise<void>}
 */
export async function handleConsentYes({ ack, body, client, logger }) {
  await ack();

  try {
    const { need_id } = parsePayload(body.actions[0].value);
    const need = need_id ? getNeed(need_id) : undefined;
    if (!need) return;

    const volunteer = /** @type {string} */ (body.user?.id || need.matched_offer_user_id);

    // 1. State machine: matched.
    setNeedMatchUser(need.id, 'matched', volunteer);

    // 2. Warm public introduction in the original need thread.
    const skills = need.need_skills.length ? need.need_skills.join(', ') : 'this';
    await client.chat.postMessage({
      channel: need.channel_id,
      thread_ts: need.message_ts,
      text: 'A warm introduction',
      blocks: textBlocks(
        `<@${need.requester_id}>, meet <@${volunteer}> — they'd be glad to help with *${skills}*. 🤝\n\nI'll step back now and let you two take it from here.`,
      ),
    });

    // 3. Update the volunteer's DM.
    const channel = /** @type {string} */ (body.channel?.id);
    const ts = /** @type {string} */ (body.message?.ts);
    if (channel && ts) {
      const done = "You're introduced — thank you for stepping up. 🙌";
      await client.chat.update({ channel, ts, text: done, blocks: textBlocks(done) });
    }
    console.log(`Need ${need.id} MATCHED: ${need.requester_id} <-> ${volunteer}`);
    // Refresh the dashboard for both parties.
    await publishHomeView(client, need.requester_id);
    await publishHomeView(client, volunteer);
  } catch (e) {
    logger.error(`Failed to handle consent_yes: ${e}`);
  }
}

/**
 * Volunteer clicks "Not right now": revert the need to open and thank them.
 * @param {import('@slack/bolt').AllMiddlewareArgs & import('@slack/bolt').SlackActionMiddlewareArgs<import('@slack/bolt').BlockButtonAction>} args
 * @returns {Promise<void>}
 */
export async function handleConsentNo({ ack, body, client, logger }) {
  await ack();

  try {
    const { need_id } = parsePayload(body.actions[0].value);
    if (!need_id) return;

    // State machine: back to open, clear the chosen volunteer.
    const updated = setNeedMatchUser(need_id, 'open', null);
    await publishHomeView(client, updated?.requester_id);

    const channel = /** @type {string} */ (body.channel?.id);
    const ts = /** @type {string} */ (body.message?.ts);
    if (channel && ts) {
      const note = 'Of course — no worries at all. Thank you for letting me know. 🙏';
      await client.chat.update({ channel, ts, text: note, blocks: textBlocks(note) });
    }
    console.log(`Need ${need_id} declined — reverted to open (next candidate could be offered; auto-retry not built yet)`);
  } catch (e) {
    logger.error(`Failed to handle consent_no: ${e}`);
  }
}

/**
 * "Dismiss" a suggested candidate: quietly collapse the card. (Unchanged from Task 5.)
 * @param {import('@slack/bolt').AllMiddlewareArgs & import('@slack/bolt').SlackActionMiddlewareArgs<import('@slack/bolt').BlockButtonAction>} args
 * @returns {Promise<void>}
 */
export async function handleDismissMatch({ ack, body, client, respond, logger }) {
  await ack();

  try {
    const payload = parsePayload(body.actions[0].value);
    console.log(`DISMISS match clicked: ${JSON.stringify(payload)}`);
    const note = "Okay — I've set that suggestion aside.";
    await respond({ replace_original: true, text: note, blocks: textBlocks(note) });
    // Keep the dashboard in sync with the dismissed suggestion.
    const need = payload.need_id ? getNeed(payload.need_id) : undefined;
    await publishHomeView(client, need?.requester_id);
  } catch (e) {
    logger.error(`Failed to handle dismiss_match: ${e}`);
  }
}
