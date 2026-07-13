/**
 * Build the private DM consent card sent to a chosen volunteer. Describes the
 * need warmly WITHOUT revealing who asked — the requester's identity stays
 * hidden until the volunteer agrees.
 *
 * @param {import('../../lib/db.js').Need} need
 * @returns {import('@slack/types').KnownBlock[]}
 */
export function buildConsentCardBlocks(need) {
  const skills = Array.isArray(need.need_skills) && need.need_skills.length ? need.need_skills.join(', ') : 'something';

  const details = [];
  if (need.timing) details.push(`*When:* ${need.timing}`);
  if (need.location) details.push(`*Where:* ${need.location}`);
  const detailText = details.length ? `\n${details.join('\n')}` : '';

  const value = JSON.stringify({ need_id: need.id });

  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `Hi there 🙂 Someone nearby is hoping for a little help with *${skills}*.${detailText}\n\nOnly if you have the time and energy — there's no pressure at all. Would you be up for it?`,
      },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Happy to help', emoji: true },
          style: 'primary',
          action_id: 'consent_yes',
          value,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Not right now', emoji: true },
          action_id: 'consent_no',
          value,
        },
      ],
    },
  ];
}
