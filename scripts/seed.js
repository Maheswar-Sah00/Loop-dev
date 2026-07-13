import 'dotenv/config';

import { WebClient } from '@slack/web-api';

// ============================================================================
// CONFIG — channel IDs for your workspace. Edit these if they change.
//
// How to get a channel ID:
//   In Slack, click the channel name at the top of the channel (or right-click
//   the channel in the sidebar) → "View channel details" → scroll to the very
//   bottom → the Channel ID (e.g. C0123ABCD) is shown there; click to copy.
// ============================================================================
const CONFIG = {
  help_requests: 'C0BGQR998US',
  volunteers: 'C0BGSNSV89F',
  transport: 'C0BG9EGDEB1',
  language_support: 'C0BHK5KLMCG',
  community_care: 'C0BG9EH3BK9',
};

// ============================================================================
// Do I need `slack run` (the app) active while seeding?  ->  NO.
//
// These messages are posted by the BOT (via the bot token). The app's message
// listener deliberately ignores bot messages — see the `event.bot_id` guard in
// listeners/events/message-ingest.js — so it will NOT re-classify them into the
// local `offers` table, whether or not the app is running.
//
// That's intentional and fine: the point of seeding is to give Slack a body of
// real conversation history that Real-Time Search (assistant.search.context)
// and search.messages can FIND at match time. The matcher pulls candidates from
// that search, so seeded messages show up as genuine history during the demo.
//
// So: just run this script once (`node scripts/seed.js`). You do not need the
// app running, and running it alongside changes nothing about this script.
// Seed first, then start the app for the demo — order doesn't matter here.
//
// NOTE: the bot must be a MEMBER of each target channel to post. If you see a
// `not_in_channel` error below, run `/invite @loop-dev` in that channel and
// re-run. (The script tells you exactly which channel to fix.)
// ============================================================================

const TOKEN = process.env.SLACK_BOT_TOKEN;
const client = new WebClient(TOKEN);

const DELAY_MS = 800; // small pause between posts to stay well under rate limits
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Believable mutual-aid OFFERS, Hyderabad/Secunderabad-flavored, worded to read
// like real people rather than templates. (No "need" is posted — type that live.)
const OFFERS = [
  // --- #language-support ---
  {
    channel: 'language_support',
    text: 'Native Telugu and Hindi speaker — happy to come along and interpret at hospital or govt office visits on Thursdays. Did this a lot around Gandhi Hospital.',
  },
  {
    channel: 'language_support',
    text: 'I can translate documents between English and Telugu — certificates, application forms, letters. Usually free after 6pm on weekdays.',
  },
  {
    channel: 'language_support',
    text: 'Urdu and Hindi speaker here, based in the Old City. Glad to help interpret at clinics or offices whenever someone needs it.',
  },

  // --- #transport ---
  {
    channel: 'transport',
    text: 'I pass by Osmania General most weekday mornings — happy to drop someone at a clinic appointment on the way. Secunderabad side.',
  },
  {
    channel: 'transport',
    text: 'Have a car with space for a wheelchair. Can do hospital or airport drops on weekends, just cover the fuel.',
  },
  {
    channel: 'transport',
    text: 'Two-wheeler here — can quickly pick up medicines or small parcels around Begumpet and Prakash Nagar if anyone is stuck.',
  },
  {
    channel: 'transport',
    text: 'Free most weekday mornings to drop elders to dialysis or kids to school. I start from Uppal and have one spare seat.',
  },

  // --- #volunteers ---
  {
    channel: 'volunteers',
    text: "Happy to help fill out hospital and government forms — I've done plenty of Aarogyasri and pension paperwork. Just message me.",
  },
  {
    channel: 'volunteers',
    text: 'I can make evening check-in calls to elderly folks living alone, in Telugu or English. My own grandmother lives alone, so I know how much it matters.',
  },
  {
    channel: 'volunteers',
    text: 'Free on weekends to tutor school kids in maths and science up to class 10. Based in Kukatpally, can do online too.',
  },
  {
    channel: 'volunteers',
    text: 'Can help with grocery runs for anyone unwell or elderly around Ameerpet — just send me your list and I’ll sort it.',
  },

  // --- #community-care ---
  {
    channel: 'community_care',
    text: 'I cook a little extra dal and rice most days — glad to drop a tiffin for anyone recovering or short on food nearby in Malakpet.',
  },
  {
    channel: 'community_care',
    text: 'Nurse by training. Happy to check BP and sugar for elderly neighbours in Tarnaka on Sunday mornings, no charge.',
  },
  {
    channel: 'community_care',
    text: 'Can sit with elderly relatives for a few hours so caregivers get a break. Weekends work best for me.',
  },
  {
    channel: 'community_care',
    text: 'I deliver home-cooked meals on my scooter in the evenings around Himayatnagar — happy to add a few more plates for anyone who needs one.',
  },
];

async function main() {
  if (!TOKEN) {
    console.error('Missing SLACK_BOT_TOKEN in .env — cannot seed.');
    process.exit(1);
  }

  const channels = new Set(OFFERS.map((o) => o.channel));
  console.log(`Seeding ${OFFERS.length} offers across ${channels.size} channels…\n`);

  let posted = 0;
  let failed = 0;

  for (const [i, offer] of OFFERS.entries()) {
    const tag = `[${i + 1}/${OFFERS.length}]`;
    const channelId = CONFIG[offer.channel];

    if (!channelId) {
      console.warn(`  ${tag} skipped — no channel ID set for '${offer.channel}' in CONFIG.`);
      failed++;
      continue;
    }

    try {
      await client.chat.postMessage({ channel: channelId, text: offer.text });
      console.log(`  ${tag} #${offer.channel}: ${offer.text.slice(0, 60)}…`);
      posted++;
    } catch (e) {
      const err = /** @type {any} */ (e)?.data?.error || /** @type {any} */ (e)?.message;
      let hint = '';
      if (err === 'not_in_channel') hint = ` — run "/invite @loop-dev" in #${offer.channel.replace('_', '-')} then re-run`;
      if (err === 'channel_not_found') hint = ` — check the CONFIG channel ID for '${offer.channel}'`;
      console.error(`  ${tag} FAILED #${offer.channel} (${err})${hint}`);
      failed++;
    }

    await sleep(DELAY_MS);
  }

  console.log(`\nSeed complete — ${posted} posted, ${failed} skipped/failed.`);
}

main();
