// ChatGPT/Codex provider - config, translator, and stream parser
import type { Provider } from "./types";
import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// Load official Codex instructions from file (required prefix validated by API)
const __dirname = dirname(fileURLToPath(import.meta.url));
const CODEX_INSTRUCTIONS = readFileSync(join(__dirname, "codex-instructions.txt"), "utf-8");

// ============================================================================
// TRANSLATOR: Claude -> Codex request format
// ============================================================================

interface ClaudeSystemBlock { type: string; text: string; }
interface ClaudeContentBlock { type: string; text?: string; id?: string; name?: string; input?: any; tool_use_id?: string; content?: any; }
interface ClaudeMessage { role: string; content: string | ClaudeContentBlock[]; }
interface ClaudeRequest { model: string; system?: string | ClaudeSystemBlock[]; messages: ClaudeMessage[]; tools?: any[]; stream?: boolean; }

export function translateRequest(req: ClaudeRequest): Record<string, any> {
  const out: Record<string, any> = {
    model: req.model,
    input: [],
    stream: req.stream ?? true,
    reasoning: { effort: "low", summary: "auto" },
    include: ["reasoning.encrypted_content"],
    parallel_tool_calls: true,
    store: false,
  };

  // System prompt -> instructions (will be replaced by official instructions in transformRequest)
  if (req.system) {
    if (typeof req.system === "string") {
      out.instructions = req.system;
    } else if (Array.isArray(req.system)) {
      out.instructions = req.system.map((s) => s.text).join("\n");
    }
  }

  // Messages -> input
  for (const msg of req.messages) {
    if (msg.role === "user" || msg.role === "assistant") {
      const content = msg.content;

      // Handle tool results separately
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "tool_result") {
            out.input.push({
              type: "function_call_output",
              call_id: block.tool_use_id,
              output: typeof block.content === "string" ? block.content : JSON.stringify(block.content),
            });
          }
        }
      }

      // Build message
      const inputMsg: Record<string, any> = {
        type: "message",
        role: msg.role,
        content: [],
      };

      if (typeof content === "string") {
        const partType = msg.role === "assistant" ? "output_text" : "input_text";
        inputMsg.content.push({ type: partType, text: content });
      } else if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "text") {
            const partType = msg.role === "assistant" ? "output_text" : "input_text";
            inputMsg.content.push({ type: partType, text: block.text });
          } else if (block.type === "tool_use") {
            // Add message first if it has content
            if (inputMsg.content.length > 0) {
              out.input.push(inputMsg);
            }
            out.input.push({
              type: "function_call",
              call_id: block.id,
              name: shortenName(block.name || ""),
              arguments: JSON.stringify(block.input || {}),
            });
            continue;
          }
        }
      }

      // Add message if it has content
      if (inputMsg.content.length > 0) {
        out.input.push(inputMsg);
      }
    }
  }

  // Tools
  if (req.tools && req.tools.length > 0) {
    out.tools = req.tools.map((tool: any) => ({
      type: "function",
      name: shortenName(tool.name),
      description: tool.description,
      parameters: tool.input_schema,
    }));
  }

  return out;
}

function shortenName(name: string): string {
  if (name.length <= 64) return name;
  if (name.startsWith("mcp__")) {
    const idx = name.lastIndexOf("__");
    if (idx > 0) {
      const candidate = "mcp__" + name.slice(idx + 2);
      return candidate.length > 64 ? candidate.slice(0, 64) : candidate;
    }
  }
  return name.slice(0, 64);
}

// ============================================================================
// STREAM PARSER: Codex SSE -> Claude format
// ============================================================================

import type { StreamEvent } from "./types";
export type { StreamEvent };

export interface StreamState {
  responseId?: string;
  createdAt?: number;
  functionCallIndex: number;
}

export function createStreamState(): StreamState {
  return { functionCallIndex: -1 };
}

// Returns array of events for consistency with other parsers
export function parseStreamEvent(line: string, state: StreamState): StreamEvent[] {
  if (!line.startsWith("data:")) return [];
  const data = line.slice(5).trim();
  if (data === "[DONE]") return [{ type: "message_stop" }];

  try {
    const event = JSON.parse(data);
    const eventType = event.type;

    if (eventType === "response.created") {
      state.responseId = event.response?.id;
      state.createdAt = event.response?.created_at;
      return [{ type: "message_start", message: { id: state.responseId, role: "assistant", content: [] } }];
    }

    if (eventType === "response.output_text.delta") {
      return [{ type: "content_block_delta", delta: { type: "text_delta", text: event.delta || "" } }];
    }

    if (eventType === "response.output_item.done") {
      const item = event.item;
      if (item?.type === "function_call") {
        return [{
          type: "content_block_start",
          content_block: {
            type: "tool_use",
            id: item.call_id,
            name: item.name,
            input: JSON.parse(item.arguments || "{}"),
          },
        }];
      }
    }

    if (eventType === "response.completed") {
      return [{ type: "message_stop" }];
    }

    return [];
  } catch {
    return [];
  }
}

// ============================================================================
// PROVIDER CONFIG
// ============================================================================

const chatgpt: Provider = {
  id: "chatgpt",
  protocol: "codex",
  baseUrl: "https://chatgpt.com/backend-api/codex",

  auth: {
    type: "oauth2",
    authUrl: "https://auth.openai.com/oauth/authorize",
    tokenUrl: "https://auth.openai.com/oauth/token",
    tokenFormat: "form",
    scopes: ["openid", "email", "profile", "offline_access"],
    redirect: "http://localhost:1455/auth/callback",
    extraAuthParams: {
      prompt: "login",
      id_token_add_organizations: "true",
      codex_cli_simplified_flow: "true",
    },
  },

  models: [
    { upstream: "gpt-5.1", aliases: ["codex", "gpt-5.1", "gpt-5"] },
    { upstream: "gpt-5-codex", aliases: ["gpt-5-codex"] },
    { upstream: "gpt-5-codex-mini", aliases: ["gpt-5-mini", "gpt-5-codex-mini"] },
    { upstream: "o3", aliases: ["o3"] },
    { upstream: "o4-mini", aliases: ["o4-mini"] },
  ],

  applyHeaders(headers, cred) {
    headers["Version"] = "0.21.0";
    headers["Openai-Beta"] = "responses=experimental";
    headers["Session_id"] = randomUUID();
    headers["User-Agent"] = "codex_cli_rs/0.50.0 (Mac OS 26.0.1; arm64)";
    headers["Accept"] = "text/event-stream";
    headers["Connection"] = "Keep-Alive";
    if (cred.isOAuth) {
      headers["Originator"] = "codex_cli_rs";
      if (cred.account_id) {
        headers["Chatgpt-Account-Id"] = cred.account_id;
      }
    }
  },

  transformRequest(body, isOAuth) {
    body.stream = true;
    delete body.previous_response_id;

    // Codex requires official instructions - move custom instructions to input
    const customInstructions = body.instructions;
    body.instructions = CODEX_INSTRUCTIONS;

    if (customInstructions && customInstructions !== CODEX_INSTRUCTIONS) {
      const systemMessage = {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: customInstructions }],
      };
      body.input = [systemMessage, ...(body.input || [])];
    }

    return body;
  },

  buildUrl(baseUrl, model) {
    return baseUrl.replace(/\/$/, "") + "/responses";
  },
};

export default chatgpt;
