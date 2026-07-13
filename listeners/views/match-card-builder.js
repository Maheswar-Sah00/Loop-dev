/**
 * Build the Block Kit blocks for a match suggestion card. Tone is calm and
 * human: a short intro, then one section + context + buttons per candidate.
 *
 * @param {Array<{user_id:string, confidence:string, reason:string, offer_age_days:number|null}>} candidates
 *   Already filtered to the candidates worth showing (max 3).
 * @param {Record<string,string>} names  user_id -> display name (for button labels).
 * @param {number} needId
 * @returns {import('@slack/types').KnownBlock[]}
 */
export function buildMatchCardBlocks(candidates, names, needId) {
  const intro =
    candidates.length === 1
      ? 'I found someone who may be able to help. 🌱'
      : 'A few people here may be able to help. 🌱';

  /** @type {import('@slack/types').KnownBlock[]} */
  const blocks = [{ type: 'section', text: { type: 'mrkdwn', text: intro } }];

  for (const c of candidates) {
    const confidenceWord = c.confidence === 'high' ? 'Looks like a strong fit' : 'Might be a good fit';
    const age = humanizeAge(c.offer_age_days);
    const contextText = age ? `${confidenceWord} · ${age}` : confidenceWord;
    const value = JSON.stringify({ need_id: needId, offer_user_id: c.user_id });

    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `<@${c.user_id}>\n${c.reason}` },
    });
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: contextText }],
    });
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: `Ask ${shortName(names[c.user_id])}`, emoji: true },
          style: 'primary',
          action_id: 'confirm_match',
          value,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Not this one', emoji: true },
          action_id: 'dismiss_match',
          value,
        },
      ],
    });
  }

  return blocks;
}

/**
 * Turn an offer age in days into a warm, human phrase.
 * @param {number | null | undefined} days
 * @returns {string | null}
 */
function humanizeAge(days) {
  if (days === null || days === undefined) return null;
  if (days <= 0) return 'offered today';
  if (days === 1) return 'offered yesterday';
  if (days < 7) return `offered ${days} days ago`;
  if (days < 30) {
    const w = Math.round(days / 7);
    return `offered ${w} week${w > 1 ? 's' : ''} ago`;
  }
  const mo = Math.round(days / 30);
  return `offered ${mo} month${mo > 1 ? 's' : ''} ago`;
}

/**
 * Short, safe label for a button. Falls back to "them" when no name resolved.
 * @param {string | undefined} name
 * @returns {string}
 */
function shortName(name) {
  if (!name) return 'them';
  const first = name.trim().split(/\s+/)[0];
  return first.length > 20 ? `${first.slice(0, 19)}…` : first;
}
