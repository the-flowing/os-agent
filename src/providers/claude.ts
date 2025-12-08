// Claude provider - config + transforms
import type { Provider } from "./types";

const CLAUDE_CODE_PREFIX = "You are Claude Code, Anthropic's official CLI for Claude.";

const claude: Provider = {
  // Config
  id: "claude",
  protocol: "claude",
  baseUrl: "https://api.anthropic.com",

  auth: {
    type: "oauth2",
    authUrl: "https://claude.ai/oauth/authorize",
    tokenUrl: "https://console.anthropic.com/v1/oauth/token",
    tokenFormat: "json",
    scopes: ["user:profile", "user:inference", "org:create_api_key"],
    redirect: "http://localhost:54545/callback",
  },

  models: [
    // SOTA primero
    {
      upstream: "claude-opus-4-5-20251101",
      aliases: ["opus", "claude-opus", "claude-opus-4-5"],
    },
    // Resto
    {
      upstream: "claude-sonnet-4-20250514",
      aliases: ["sonnet", "claude-sonnet", "claude-sonnet-4"],
    },
    {
      upstream: "claude-3-5-sonnet-20241022",
      aliases: ["sonnet-3.5", "claude-3-5-sonnet"],
    },
    {
      upstream: "claude-3-5-haiku-20241022",
      aliases: ["haiku", "claude-haiku", "claude-3-5-haiku"],
    },
  ],

  // Transforms
  applyHeaders(headers, cred) {
    if (cred.isOAuth) {
      headers["Anthropic-Beta"] =
        "claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14";
    }
    headers["anthropic-version"] = "2023-06-01";
  },

  transformRequest(body, isOAuth) {
    if (!isOAuth) return body;

    // Claude Code OAuth requires specific system prompt prefix
    const system = body.system;

    if (typeof system === "string") {
      if (!system.startsWith(CLAUDE_CODE_PREFIX)) {
        body.system = [
          { type: "text", text: CLAUDE_CODE_PREFIX },
          { type: "text", text: system },
        ];
      }
    } else if (Array.isArray(system)) {
      const firstText = system[0]?.text;
      if (firstText !== CLAUDE_CODE_PREFIX) {
        body.system = [{ type: "text", text: CLAUDE_CODE_PREFIX }, ...system];
      }
    } else {
      body.system = [{ type: "text", text: CLAUDE_CODE_PREFIX }];
    }

    return body;
  },

  buildUrl(baseUrl, model) {
    return baseUrl.replace(/\/$/, "") + "/v1/messages?beta=true";
  },
};

export default claude;
