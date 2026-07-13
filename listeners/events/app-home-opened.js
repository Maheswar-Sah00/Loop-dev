import { buildAppHomeView } from '../views/app-home-builder.js';

const SUGGESTED_PROMPTS = [
  { title: 'Write a Message', message: 'Help me draft a message to my team' },
  { title: 'Summarize', message: 'Can you help me summarize something?' },
  { title: 'Brainstorm', message: 'I need help brainstorming ideas' },
];

/**
 * Handle app_home_opened events. Under agent_view, this event fires for both
 * the Home tab and the Messages tab (the agent DM). Branch on event.tab:
 *   - 'messages' → pin suggested prompts to the top of the DM
 *   - 'home'     → publish the App Home Block Kit view
 * @param {import('@slack/bolt').AllMiddlewareArgs & import('@slack/bolt').SlackEventMiddlewareArgs<'app_home_opened'>} args
 * @returns {Promise<void>}
 */
export async function handleAppHomeOpened({ client, event, context, logger }) {
  try {
    if (event.tab === 'messages') {
      await client.assistant.threads.setSuggestedPrompts(
        // Under agent_view, suggested prompts pin to the top of the Messages tab —
        // no thread_ts is required. Cast until @slack/bolt's types catch up.
        /** @type {import('@slack/web-api').AssistantThreadsSetSuggestedPromptsArguments} */ ({
          channel_id: event.channel,
          title: 'How can I help you today?',
          prompts: SUGGESTED_PROMPTS,
        }),
      );
      // TODO(agent-dm-messages-tab): handle app_context_changed once Bolt supports it
      return;
    }

    const userId = /** @type {string} */ (context.userId);
    await client.views.publish({ user_id: userId, view: buildAppHomeView() });
  } catch (e) {
    logger.error(`Failed to handle app_home_opened: ${e}`);
  }
}

/**
 * Publish (refresh) the Loop dashboard for a specific user. Safe to call after
 * any need status change; failures are logged and swallowed so they never break
 * the triggering flow.
 * @param {import('@slack/web-api').WebClient} client
 * @param {string | undefined | null} userId
 * @returns {Promise<void>}
 */
export async function publishHomeView(client, userId) {
  if (!userId) return;
  try {
    await client.views.publish({ user_id: userId, view: buildAppHomeView() });
  } catch (e) {
    console.error(`Failed to refresh Home for ${userId}: ${e}`);
  }
}
