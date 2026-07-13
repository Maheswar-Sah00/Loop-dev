import { OpenAI } from 'openai';

/**
 * Thin Groq wrapper for one-shot prompts, independent of the Agents SDK.
 *
 * Uses Groq's OpenAI-compatible Chat Completions endpoint so it can run on a
 * free GROQ_API_KEY. When `expectJson` is set, the model is asked for a JSON
 * object and the parsed value is returned instead of raw text.
 */

const groq = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1',
});

// Same tool-calling capable model the agent uses.
const MODEL = 'openai/gpt-oss-120b';

/**
 * @typedef {Object} SendPromptOptions
 * @property {boolean} [expectJson]   Request + parse a JSON object response.
 * @property {string} [system]        Optional system instruction.
 * @property {number} [temperature]   Sampling temperature (default 0).
 */

/**
 * Send a single prompt to Groq and return the model's reply.
 * @param {string} prompt
 * @param {SendPromptOptions} [options]
 * @returns {Promise<string | any>} Raw text, or the parsed object when expectJson is true.
 */
export async function sendPrompt(prompt, options = {}) {
  const { expectJson = false, system, temperature = 0 } = options;

  /** @type {import('openai').OpenAI.Chat.ChatCompletionMessageParam[]} */
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: prompt });

  const completion = await groq.chat.completions.create({
    model: MODEL,
    messages,
    temperature,
    ...(expectJson ? { response_format: { type: 'json_object' } } : {}),
  });

  const content = completion.choices[0]?.message?.content ?? '';
  return expectJson ? parseJsonObject(content) : content;
}

/**
 * Parse a JSON object out of a model reply, tolerating code fences or stray prose.
 * @param {string} text
 * @returns {any}
 */
function parseJsonObject(text) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : trimmed).trim();

  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start !== -1 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1));
    }
    throw new Error(`sendPrompt: could not parse JSON from model output: ${text.slice(0, 200)}`);
  }
}
