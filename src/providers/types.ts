// Provider configuration and transform types

export interface ModelConfig {
  upstream: string;
  aliases: string[];
}

// Unified stream event types (Claude format)
export interface MessageStartEvent {
  type: "message_start";
  message: { id?: string; role: string; content: any[] };
}

export interface ContentBlockDeltaEvent {
  type: "content_block_delta";
  delta: { type: "text_delta"; text: string };
}

export interface ContentBlockStartEvent {
  type: "content_block_start";
  content_block: { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };
}

export interface MessageStopEvent {
  type: "message_stop";
}

export type StreamEvent = MessageStartEvent | ContentBlockDeltaEvent | ContentBlockStartEvent | MessageStopEvent;

export interface OAuthConfig {
  type: "oauth2";
  authUrl: string;
  tokenUrl: string;
  scopes: string[];
  redirect: string;
  tokenFormat: "form" | "json";
  extraAuthParams?: Record<string, string>;
}

export interface ApiKeyConfig {
  type: "api_key";
  headerName?: string;
  prefix?: string;
}

export type AuthConfig = OAuthConfig | ApiKeyConfig;

export interface CredentialInfo {
  isOAuth: boolean;
  account_id?: string;
  email?: string;
}

export interface Provider {
  // Config
  id: string;
  protocol: string;
  baseUrl: string;
  auth: AuthConfig;
  models: ModelConfig[];
  headers?: Record<string, string>;

  // Transforms
  applyHeaders: (headers: Record<string, string>, cred: CredentialInfo) => void;
  transformRequest: (body: Record<string, any>, isOAuth: boolean) => Record<string, any>;
  buildUrl: (baseUrl: string, model: string) => string;
}
