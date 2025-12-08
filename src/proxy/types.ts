import { z } from "zod";

export const ModelConfigSchema = z.object({
  upstream: z.string().min(1),
  aliases: z.array(z.string().min(1)).default([]),
});

export type ModelConfig = z.infer<typeof ModelConfigSchema>;

export const AuthConfigSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("oauth2"),
    authUrl: z.string().url(),
    tokenUrl: z.string().url(),
    scopes: z.array(z.string().min(1)).default([]),
    redirect: z.string().url(),
    tokenFormat: z.enum(["form", "json"]).default("form"),
    extraAuthParams: z.record(z.string(), z.string()).optional(),
  }),
  z.object({
    type: z.literal("api_key"),
    headerName: z.string().default("Authorization"),
    prefix: z.string().default("Bearer "),
  }),
]);

export type AuthConfig = z.infer<typeof AuthConfigSchema>;

export const ProviderConfigSchema = z.object({
  id: z.string().min(1),
  protocol: z.enum(["openai", "claude", "gemini", "custom"]),
  baseUrl: z.string().url(),
  auth: AuthConfigSchema,
  models: z.array(ModelConfigSchema).nonempty(),
  headers: z.record(z.string(), z.string()).optional(),
  timeoutMs: z.number().int().positive().optional(),
  retry: z
    .object({
      attempts: z.number().int().positive().default(3),
      maxIntervalSeconds: z.number().int().positive().default(30),
    })
    .optional(),
  proxyOverride: z.string().url().optional(),
});

export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

export interface OAuthCredential {
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
  token_type?: string;
  id_token?: string;
  account_id?: string;
  email?: string;
  project_id?: string; // For Gemini CLI
}

export interface ApiKeyCredential {
  apiKey: string;
}

export type Credential = OAuthCredential | ApiKeyCredential;

export interface InferenceRequest {
  providerId?: string;
  model: string;
  body: Record<string, any>;
  path?: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export interface InferenceOptions {
  maxAttempts?: number;
  maxRetryIntervalSeconds?: number;
}

export interface LoginOptions {
  clientId?: string;
  clientSecret?: string;
  noBrowser?: boolean;
  apiKey?: string;
}
