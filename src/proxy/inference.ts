import { InferenceRequest, InferenceOptions } from "./types";
import { ensureCredential } from "./auth";
import {
  loadAllProviders,
  getProvider,
  getProviderByModel,
  resolveModel,
  Provider,
} from "../providers";
import { translateRequest as codexTranslate } from "../providers/chatgpt";
import { translateRequest as geminiTranslate } from "../providers/gemini";

// Debug logging - set DEBUG=inference or DEBUG=* to enable
const DEBUG = process.env.DEBUG?.includes("inference") || process.env.DEBUG === "*";
function log(...args: any[]) {
  if (DEBUG) console.log("[inference]", ...args);
}

async function pickProvider(req: InferenceRequest): Promise<{ provider: Provider; upstreamModel: string }> {
  let provider: Provider | null = null;

  if (req.providerId) {
    provider = await getProvider(req.providerId);
  }
  if (!provider) {
    provider = await getProviderByModel(req.model);
  }
  if (!provider) {
    throw new Error(`No provider found for model ${req.model}`);
  }

  const upstreamModel = resolveModel(provider, req.model);
  if (!upstreamModel) {
    throw new Error(`Provider ${provider.id} does not support model ${req.model}`);
  }

  return { provider, upstreamModel };
}

function defaultAttempts(opts?: InferenceOptions) {
  return opts?.maxAttempts ?? 3;
}

function defaultMaxInterval(opts?: InferenceOptions) {
  return opts?.maxRetryIntervalSeconds ?? 30;
}

function applyAuthHeader(provider: Provider, credential: any, headers: Record<string, string>) {
  if (provider.auth.type === "api_key") {
    const headerName = provider.auth.headerName ?? "Authorization";
    const prefix = provider.auth.prefix ?? "Bearer ";
    headers[headerName] = `${prefix}${credential.apiKey}`;
    return;
  }
  // OAuth token - always use "Bearer" (capitalized) for Authorization header
  headers["Authorization"] = `Bearer ${credential.access_token}`;
}

async function doFetch(url: string, init: RequestInit, attempts: number, maxInterval: number) {
  let lastErr: any;
  for (let i = 0; i < attempts; i++) {
    try {
      log(`fetch attempt ${i + 1}/${attempts}:`, url);
      const res = await fetch(url, init);
      if (!res.ok && res.status >= 500 && i + 1 < attempts) {
        const delay = Math.min(maxInterval, 1 + i * 2);
        log(`server error ${res.status}, retrying in ${delay}s`);
        await new Promise((r) => setTimeout(r, delay * 1000));
        continue;
      }
      log(`response: ${res.status}`);
      return res;
    } catch (err) {
      lastErr = err;
      log(`fetch error:`, err instanceof Error ? err.message : err);
      if (i + 1 === attempts) throw err;
      const delay = Math.min(maxInterval, 1 + i * 2);
      log(`retrying in ${delay}s`);
      await new Promise((r) => setTimeout(r, delay * 1000));
    }
  }
  throw lastErr;
}

async function prepareRequest(req: InferenceRequest, opts?: InferenceOptions) {
  const { provider, upstreamModel } = await pickProvider(req);
  log(`provider: ${provider.id}, model: ${req.model} -> ${upstreamModel}`);
  const credential = await ensureCredential(provider);
  const isOAuth = provider.auth.type === "oauth2";
  log(`auth: ${isOAuth ? "oauth" : "api_key"}`);

  // Build URL using provider transform
  const url = req.path
    ? provider.baseUrl.replace(/\/$/, "") + req.path
    : provider.buildUrl(provider.baseUrl, upstreamModel);

  // Build headers
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(provider.headers ?? {}),
    ...(req.headers ?? {}),
  };
  applyAuthHeader(provider, credential, headers);

  // Build credential info for provider-specific headers
  const credInfo = {
    isOAuth,
    account_id: "account_id" in credential ? credential.account_id : undefined,
    email: "email" in credential ? credential.email : undefined,
  };
  provider.applyHeaders(headers, credInfo);

  // Build body - translate if needed based on protocol
  let body: Record<string, any> = { ...req.body };

  if (provider.protocol === "codex") {
    body.model = upstreamModel;
    body = codexTranslate(body as any);
  } else if (provider.protocol === "gemini") {
    body.model = upstreamModel;
    // Gemini CLI needs project_id from env or credential
    const projectId = process.env.GEMINI_PROJECT_ID
      || ("project_id" in credential ? credential.project_id as string : "");
    body = geminiTranslate(body as any, projectId);
  } else if (provider.protocol === "openai" || provider.protocol === "claude") {
    body.model = upstreamModel;
  }

  body = provider.transformRequest(body, isOAuth);

  return { provider, upstreamModel, url, headers, body, opts };
}

export async function inference(req: InferenceRequest, opts?: InferenceOptions) {
  const { url, headers, body, opts: options } = await prepareRequest(req, opts);

  const attempts = defaultAttempts(options);
  const maxInterval = defaultMaxInterval(options);

  const res = await doFetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: req.signal,
  }, attempts, maxInterval);

  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  if (!res.ok) {
    throw new Error(`Upstream error ${res.status}: ${typeof json === "string" ? json : JSON.stringify(json)}`);
  }
  return json;
}

export async function inferenceStream(req: InferenceRequest, opts?: InferenceOptions): Promise<{
  stream: ReadableStream<Uint8Array>;
  provider: Provider;
  model: string;
}> {
  const { provider, upstreamModel, url, headers, body } = await prepareRequest(req, opts);

  // Force streaming (except Gemini which uses SSE via URL param)
  if (provider.protocol !== "gemini") {
    body.stream = true;
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: req.signal,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upstream error ${res.status}: ${text}`);
  }

  if (!res.body) {
    throw new Error("No response body for streaming");
  }

  return { stream: res.body, provider, model: upstreamModel };
}
