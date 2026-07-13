import {
  Agent,
  createMCPToolStaticFilter,
  MCPServerStreamableHttp,
  run,
  setDefaultOpenAIClient,
  setOpenAIAPI,
  setTracingDisabled,
} from '@openai/agents';
import { OpenAI } from 'openai';

import { addEmojiReaction } from './tools/index.js';

// This project uses the OpenAI Agents SDK, but we point it at Groq's
// OpenAI-compatible endpoint so it can run on a free GROQ_API_KEY.
const groqClient = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1',
});
setDefaultOpenAIClient(groqClient);
// Groq's compatible endpoint only supports Chat Completions, not the
// Responses API the SDK uses by default.
setOpenAIAPI('chat_completions');
// Tracing exports to OpenAI and needs an OpenAI key; disable it.
setTracingDisabled(true);

// A tool-calling capable Groq model (needed for the emoji + MCP tools).
// gpt-oss-120b is the most reliable free Groq model for the emoji tool and plain
// conversation. It can occasionally mangle the Slack MCP tools' long names (Groq
// then 400s); runAgent() catches that and retries without MCP, so a mangled tool
// call degrades to a normal reply instead of a user-facing error.
const MODEL = 'openai/gpt-oss-120b';

const SYSTEM_PROMPT = `\
You are a friendly Slack assistant. You help people by answering questions, \
having conversations, and being generally useful in Slack.

## PERSONALITY
- Friendly, helpful, and approachable
- Lightly witty — a touch of humor when appropriate, but never forced
- Concise and clear — respect people's time
- Confident but honest when you don't know something

## RESPONSE GUIDELINES
- Keep responses to 3 sentences max — be punchy, scannable, and actionable
- End with a clear next step on its own line so it's easy to spot
- Use a bullet list only for multi-step instructions
- Use casual, conversational language
- Use emoji sparingly — at most one per message, and only to set tone

## FORMATTING RULES
- Use standard Markdown syntax: **bold**, _italic_, \`code\`, \`\`\`code blocks\`\`\`, > blockquotes
- Use bullet points for multi-step instructions

## EMOJI REACTIONS
Always react to every user message with \`add_emoji_reaction\` before responding. \
Pick any Slack emoji that reflects the *topic* or *tone* of the message — be creative and specific \
(e.g. \`dog\` for dog topics, \`books\` for learning, \`wave\` for greetings). \
Vary your picks across a thread; don't repeat the same emoji.

## SLACK MCP SERVER
You may have access to the Slack MCP Server, which gives you powerful Slack tools \
beyond your built-in tools. Use them whenever they would help the user.

Available capabilities:
- **Search**: Search messages and files across public channels, search for channels by name
- **Read**: Read channel message history, read thread replies, read canvas documents
- **Write**: Send messages, create draft messages, schedule messages for later
- **Canvases**: Create, read, and update Slack canvas documents

Use these tools when they can help answer a question or complete a task — for example, \
searching for relevant messages, checking a channel for context, or creating a canvas. \
Also use them when the user explicitly asks you to perform a Slack action.`;

const SLACK_MCP_URL = 'https://mcp.slack.com/mcp';

// The Slack MCP server exposes 13 tools; their combined schemas (~10k tokens)
// blow past Groq's free-tier per-minute token limit. Load only the tools we
// actually use so requests stay under the cap. Widen this list if you move to
// a higher-limit tier.
const MCP_ALLOWED_TOOLS = ['slack_search_public_and_private', 'slack_read_channel', 'slack_send_message'];

export const starterAgent = new Agent({
  name: 'Starter Agent',
  instructions: SYSTEM_PROMPT,
  tools: [addEmojiReaction],
  model: MODEL,
});

/**
 * Run the agent, optionally connecting to the Slack MCP server.
 * @param {string | import('@openai/agents').AgentInputItem[]} inputItems
 * @param {import('./deps.js').AgentDeps} deps
 * @returns {Promise<import('@openai/agents').RunResult<any, any>>}
 */
export async function runAgent(inputItems, deps) {
  if (deps.userToken) {
    const mcpServer = new MCPServerStreamableHttp({
      url: SLACK_MCP_URL,
      requestInit: { headers: { Authorization: `Bearer ${deps.userToken}` } },
      toolFilter: createMCPToolStaticFilter({ allowed: MCP_ALLOWED_TOOLS }),
    });

    try {
      await mcpServer.connect();
      const agentWithMcp = starterAgent.clone({ mcpServers: [mcpServer] });
      return await run(agentWithMcp, inputItems, { context: deps });
    } catch (e) {
      // Free Groq models can occasionally emit a malformed/mis-named call for the
      // Slack MCP tools (Groq returns a 400). Rather than surface that to the user,
      // fall back to the plain agent so they always get a clean, useful reply.
      const err = /** @type {any} */ (e);
      console.error(`[agent] MCP path failed — retrying without MCP: ${err?.message || err}`);
      return await run(starterAgent, inputItems, { context: deps });
    } finally {
      await mcpServer.close();
    }
  }

  return await run(starterAgent, inputItems, { context: deps });
}
