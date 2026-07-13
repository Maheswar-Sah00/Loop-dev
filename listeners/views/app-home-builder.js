import { countActiveOffers, listMatchedNeeds, listOpenOrAwaitingNeeds, recentOffers } from '../../lib/db.js';

/**
 * Build the Loop dashboard App Home view from the DB. Calm and uncluttered:
 * a title, then three sections (open needs, recent matches, offers) separated
 * by dividers, each with a friendly empty state.
 * @returns {import('@slack/types').HomeView}
 */
export function buildAppHomeView() {
  /** @type {import('@slack/types').KnownBlock[]} */
  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: 'Loop' } },
    { type: 'context', elements: [{ type: 'mrkdwn', text: 'connecting help in your community' }] },
    { type: 'divider' },
  ];

  addOpenNeeds(blocks);
  blocks.push({ type: 'divider' });
  addRecentMatches(blocks);
  blocks.push({ type: 'divider' });
  addOffers(blocks);

  return { type: 'home', blocks };
}

/**
 * @param {import('@slack/types').KnownBlock[]} blocks
 */
function addOpenNeeds(blocks) {
  const needs = listOpenOrAwaitingNeeds();
  blocks.push(sectionHeader('Who needs a hand'));

  if (needs.length === 0) {
    blocks.push(context("All quiet for now — nobody's asked for help."));
    return;
  }

  const shown = needs.slice(0, 10);
  shown.forEach((need, i) => {
    if (i > 0) blocks.push({ type: 'divider' });
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: truncate(need.raw_text || needSummary(need), 80) } });
    blocks.push(context(`${statusLabel(need.status)}  ·  ${timeAgo(tsToSeconds(need.message_ts))}`));
  });
  if (needs.length > shown.length) {
    blocks.push(context(`…and ${needs.length - shown.length} more waiting`));
  }
}

/**
 * @param {import('@slack/types').KnownBlock[]} blocks
 */
function addRecentMatches(blocks) {
  const matches = listMatchedNeeds(5);
  blocks.push(sectionHeader('Recent connections'));

  if (matches.length === 0) {
    blocks.push(context("No connections yet — they'll appear here as they happen."));
    return;
  }

  for (const need of matches) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `<@${need.requester_id}>  ↔  <@${need.matched_offer_user_id}>` },
    });
    blocks.push(context(truncate(need.raw_text || needSummary(need), 80)));
  }
}

/**
 * @param {import('@slack/types').KnownBlock[]} blocks
 */
function addOffers(blocks) {
  const count = countActiveOffers();
  blocks.push(sectionHeader('People ready to help'));

  if (count === 0) {
    blocks.push(context("No offers yet — they'll show up here as people share them."));
    return;
  }

  blocks.push(context(`${count} ${count === 1 ? 'offer' : 'offers'} shared so far`));
  for (const offer of recentOffers(3)) {
    const skill = titleize(offer.skills.join(', ')) || 'Something helpful';
    blocks.push(context(`${skill}  ·  offered ${timeAgo(offer.created_ts)}`));
  }
}

// --- helpers -----------------------------------------------------------------

/**
 * @param {string} title
 * @returns {import('@slack/types').SectionBlock}
 */
function sectionHeader(title) {
  return { type: 'section', text: { type: 'mrkdwn', text: `*${title}*` } };
}

/**
 * @param {string} text
 * @returns {import('@slack/types').ContextBlock}
 */
function context(text) {
  return { type: 'context', elements: [{ type: 'mrkdwn', text }] };
}

/**
 * @param {string} status
 * @returns {string}
 */
function statusLabel(status) {
  if (status === 'awaiting_consent') return 'checking with someone who may help';
  return "still looking — I'll keep an eye out";
}

/**
 * @param {import('../../lib/db.js').Need} need
 * @returns {string}
 */
function needSummary(need) {
  return need.need_skills.length ? need.need_skills.join(', ') : 'a request for help';
}

/**
 * Slack message ts ("1783944909.770039") → unix seconds.
 * @param {string | null} ts
 * @returns {number}
 */
function tsToSeconds(ts) {
  const n = ts ? Math.floor(Number.parseFloat(ts)) : 0;
  return Number.isFinite(n) ? n : 0;
}

/**
 * Humanize an age (unix seconds) into "3 minutes ago", "2 weeks ago", etc.
 * @param {number} unixSeconds
 * @returns {string}
 */
function timeAgo(unixSeconds) {
  if (!unixSeconds) return 'recently';
  const now = Math.floor(Date.now() / 1000);
  const diff = Math.max(0, now - unixSeconds);
  if (diff < 60) return 'just now';
  const mins = Math.floor(diff / 60);
  if (mins < 60) return `${mins} minute${mins > 1 ? 's' : ''} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs > 1 ? 's' : ''} ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days} day${days > 1 ? 's' : ''} ago`;
  if (days < 30) {
    const w = Math.floor(days / 7);
    return `${w} week${w > 1 ? 's' : ''} ago`;
  }
  const mo = Math.floor(days / 30);
  return `${mo} month${mo > 1 ? 's' : ''} ago`;
}

/**
 * @param {string} text
 * @param {number} max
 * @returns {string}
 */
function truncate(text, max) {
  const t = (text || '').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/**
 * Capitalize the first letter of each comma-separated term.
 * @param {string} text
 * @returns {string}
 */
function titleize(text) {
  return text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(', ');
}
