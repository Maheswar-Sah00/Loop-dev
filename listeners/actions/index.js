import { handleFeedbackButton } from './feedback-buttons.js';
import {
  handleConfirmMatch,
  handleConsentNo,
  handleConsentYes,
  handleDismissMatch,
} from './match-actions.js';

/**
 * Register action listeners with the Bolt app.
 * @param {import('@slack/bolt').App} app
 * @returns {void}
 */
export function register(app) {
  app.action('feedback', handleFeedbackButton);
  app.action('confirm_match', handleConfirmMatch);
  app.action('dismiss_match', handleDismissMatch);
  app.action('consent_yes', handleConsentYes);
  app.action('consent_no', handleConsentNo);
}
