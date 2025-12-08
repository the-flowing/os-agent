// Gemini CLI provider - config, translator, and stream parser
// Uses cloudcode-pa.googleapis.com (Code Assist API) for OAuth access
import type { Provider } from "./types";

// ============================================================================
// TRANSLATOR: Claude -> Gemini CLI request format
// ============================================================================

interface ClaudeSystemBlock { type: string; text: string; }
interface ClaudeContentBlock { type: string; text?: string; id?: string; name?: string; input?: any; tool_use_id?: string; content?: any; }
interface ClaudeMessage { role: string; content: string | ClaudeContentBlock[]; }
interface ClaudeRequest { model: string; system?: string | ClaudeSystemBlock[]; messages: ClaudeMessage[]; tools?: any[]; max_tokens?: number; stream?: boolean; }

export function translateRequest(req: ClaudeRequest, projectId?: string): Record<string, any> {
  const out: Record<string, any> = {
    request: {
      contents: [],
    },
    model: req.model,
    project: projectId || "",
  };

  // System prompt -> system_instruction
  if (req.system) {
    const systemText = typeof req.system === "string"
      ? req.system
      : req.system.map((s) => s.text).join("\n");

    out.request.system_instruction = {
      role: "user",
      parts: [{ text: systemText }],
    };
  }

  // Build tool_call_id -> name map for tool responses
  const toolCallIdToName: Record<string, string> = {};
  for (const msg of req.messages) {
    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === "tool_use" && block.id && block.name) {
          toolCallIdToName[block.id] = block.name;
        }
      }
    }
  }

  // Messages -> contents
  for (const msg of req.messages) {
    const role = msg.role === "assistant" ? "model" : "user";
    const content: Record<string, any> = { role, parts: [] };

    const msgContent = msg.content;

    if (typeof msgContent === "string") {
      content.parts.push({ text: msgContent });
    } else if (Array.isArray(msgContent)) {
      for (const block of msgContent) {
        if (block.type === "text" && block.text) {
          content.parts.push({ text: block.text });
        } else if (block.type === "tool_use") {
          content.parts.push({
            functionCall: {
              name: block.name || "",
              args: (block.input as Record<string, unknown>) || {},
            },
          });
        } else if (block.type === "tool_result") {
          const toolName = block.tool_use_id ? toolCallIdToName[block.tool_use_id] : "unknown";
          let responseData: Record<string, unknown>;

          if (typeof block.content === "string") {
            try {
              responseData = JSON.parse(block.content);
            } catch {
              responseData = { result: block.content };
            }
          } else {
            responseData = { result: block.content };
          }

          content.parts.push({
            functionResponse: {
              name: toolName,
              response: responseData,
            },
          });
        }
      }
    }

    if (content.parts.length > 0) {
      out.request.contents.push(content);
    }
  }

  // Tools -> functionDeclarations
  if (req.tools && req.tools.length > 0) {
    out.request.tools = [{
      functionDeclarations: req.tools.map((tool: any) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.input_schema,
      })),
    }];
  }

  // Generation config
  if (req.max_tokens) {
    out.request.generationConfig = {
      maxOutputTokens: req.max_tokens,
    };
  }

  return out;
}

// ============================================================================
// STREAM PARSER: Gemini CLI SSE -> Claude format
// ============================================================================

import type { StreamEvent } from "./types";
export type { StreamEvent };

export interface StreamState {
  started: boolean;
  functionCallIndex: number;
}

export function createStreamState(): StreamState {
  return { started: false, functionCallIndex: -1 };
}

// Returns array of events since Gemini can return full response in one SSE event
export function parseStreamEvent(line: string, state: StreamState): StreamEvent[] {
  if (!line.startsWith("data:")) return [];
  const data = line.slice(5).trim();
  if (data === "[DONE]") return [{ type: "message_stop" }];

  try {
    const event = JSON.parse(data);
    const events: any[] = [];

    // Gemini CLI wraps response in "response" field
    const response = event.response || event;
    const candidates = response.candidates;
    if (!candidates || !candidates[0]) return [];

    const candidate = candidates[0];
    const content = candidate.content;

    if (!state.started) {
      state.started = true;
      events.push({ type: "message_start", message: { role: "assistant", content: [] } });
    }

    if (content?.parts) {
      for (const part of content.parts) {
        if (part.text) {
          events.push({ type: "content_block_delta", delta: { type: "text_delta", text: part.text } });
        }
        if (part.functionCall) {
          state.functionCallIndex++;
          events.push({
            type: "content_block_start",
            content_block: {
              type: "tool_use",
              id: `call_${state.functionCallIndex}`,
              name: part.functionCall.name,
              input: part.functionCall.args,
            },
          });
        }
      }
    }

    if (candidate.finishReason) {
      events.push({ type: "message_stop" });
    }

    return events;
  } catch {
    return [];
  }
}

// ============================================================================
// PROVIDER CONFIG
// ============================================================================

const gemini: Provider = {
  id: "gemini",
  protocol: "gemini",
  // Gemini CLI uses Cloud Code Assist endpoint (works with OAuth cloud-platform scope)
  baseUrl: "https://cloudcode-pa.googleapis.com",

  auth: {
    type: "oauth2",
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    tokenFormat: "form",
    scopes: [
      "https://www.googleapis.com/auth/cloud-platform",
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/userinfo.profile",
    ],
    redirect: "http://localhost:8085/oauth2callback",
    extraAuthParams: {
      access_type: "offline",
      prompt: "consent",
    },
  },

  models: [
    { upstream: "gemini-2.5-pro", aliases: ["gemini-pro", "gemini-2.5-pro", "gemini"] },
    { upstream: "gemini-3-pro-preview", aliases: ["gemini-3-pro", "gemini-3-pro-preview"] },
    { upstream: "gemini-2.5-flash", aliases: ["gemini-flash", "gemini-2.5-flash"] },
    { upstream: "gemini-2.5-flash-lite", aliases: ["gemini-lite", "gemini-2.5-flash-lite"] },
    { upstream: "gemini-2.0-flash", aliases: ["gemini-2.0-flash"] },
    { upstream: "gemini-1.5-pro", aliases: ["gemini-1.5-pro"] },
  ],

  applyHeaders(headers, cred) {
    // Required headers for Gemini CLI endpoint
    headers["User-Agent"] = "google-api-nodejs-client/9.15.1";
    headers["X-Goog-Api-Client"] = "gl-node/22.17.0";
    headers["Client-Metadata"] = "ideType=IDE_UNSPECIFIED,platform=PLATFORM_UNSPECIFIED,pluginType=GEMINI";
    headers["Accept"] = "text/event-stream";
  },

  transformRequest(body, isOAuth) {
    return body;
  },

  buildUrl(baseUrl, model) {
    // Gemini CLI uses /v1internal:streamGenerateContent
    return baseUrl.replace(/\/$/, "") + "/v1internal:streamGenerateContent?alt=sse";
  },
};

export default gemini;
