import { exec } from "child_process";
import { URL } from "url";
import { createHash, randomBytes, randomUUID } from "crypto";
import { TokenRequestResult } from "@oslojs/oauth2";
import { loadCredential, saveCredential, credentialPath } from "./credentials";
import { OAuthCredential, LoginOptions } from "./types";
import { getProvider, Provider, OAuthConfig } from "../providers";

const DEFAULT_TIMEOUT_MS = 60_000;

async function openInBrowser(url: string) {
  return new Promise<void>((resolve) => {
    const opener = process.platform === "win32" ? "start" : process.platform === "darwin" ? "open" : "xdg-open";
    exec(`${opener} "${url}"`, () => resolve());
  });
}

const DEFAULT_OAUTH: Record<string, { clientId: string; clientSecret?: string }> = {
  gemini: {
    clientId: "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com",
    clientSecret: "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",
  },
  claude: {
    clientId: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
  },
  chatgpt: {
    clientId: "app_EMoamEEZ73f0CkXaXp7hrann",
  },
};

function envKey(providerId: string, suffix: string) {
  return `${providerId.toUpperCase()}_${suffix}`;
}

function getOAuthClient(provider: Provider, opts?: LoginOptions) {
  const id =
    opts?.clientId ??
    process.env[envKey(provider.id, "CLIENT_ID")] ??
    DEFAULT_OAUTH[provider.id]?.clientId;
  const secret =
    opts?.clientSecret ??
    process.env[envKey(provider.id, "CLIENT_SECRET")] ??
    DEFAULT_OAUTH[provider.id]?.clientSecret;
  if (!id) {
    throw new Error(`Missing client id for provider ${provider.id}. Set ${envKey(provider.id, "CLIENT_ID")} or pass via options.`);
  }
  return { clientId: id, clientSecret: secret };
}

async function awaitAuthCode(redirectUrl: string, noBrowser?: boolean, openUrl?: string) {
  const target = new URL(redirectUrl);
  const callbacks: { resolve?: (code: string) => void; reject?: (err: Error) => void } = {};
  const server = Bun.serve({
    hostname: target.hostname,
    port: Number(target.port || 80),
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname !== target.pathname) {
        return new Response("Not found", { status: 404 });
      }
      const code = url.searchParams.get("code");
      if (!code) {
        callbacks.reject?.(new Error("Missing code in callback"));
        return new Response("Missing code", { status: 400 });
      }
      callbacks.resolve?.(code);
      return new Response("Authentication complete. You can close this tab.");
    },
  });

  if (!noBrowser && openUrl) {
    await openInBrowser(openUrl);
  }

  const code = await new Promise<string>((resolve, reject) => {
    callbacks.resolve = resolve;
    callbacks.reject = reject;
    setTimeout(() => reject(new Error("OAuth timeout")), DEFAULT_TIMEOUT_MS);
  }).finally(() => server.stop());

  return code;
}

async function exchangeCodeForToken(
  auth: OAuthConfig,
  code: string,
  redirect: string,
  clientId: string,
  clientSecret: string | undefined,
  pkce?: { verifier: string },
  state?: string
): Promise<OAuthCredential> {
  const cleanedCode = code.includes("#") ? code.split("#")[0] : code;
  const useJson = auth.tokenFormat === "json";

  let body: string;
  let contentType: string;

  if (useJson) {
    const payload: Record<string, string> = {
      grant_type: "authorization_code",
      code: cleanedCode,
      redirect_uri: redirect,
      client_id: clientId,
    };
    if (clientSecret) payload.client_secret = clientSecret;
    if (pkce?.verifier) payload.code_verifier = pkce.verifier;
    if (state) payload.state = state;
    body = JSON.stringify(payload);
    contentType = "application/json";
  } else {
    const params = new URLSearchParams();
    params.set("grant_type", "authorization_code");
    params.set("code", cleanedCode);
    params.set("redirect_uri", redirect);
    params.set("client_id", clientId);
    if (clientSecret) params.set("client_secret", clientSecret);
    if (pkce?.verifier) params.set("code_verifier", pkce.verifier);
    body = params.toString();
    contentType = "application/x-www-form-urlencoded";
  }

  const res = await fetch(auth.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": contentType, Accept: "application/json" },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${text}`);
  }
  const json = (await res.json()) as Record<string, any>;
  const parsed = new TokenRequestResult(json);
  if (parsed.hasErrorCode()) {
    throw new Error(`Token exchange failed: ${parsed.errorCode()}`);
  }
  const accessToken = parsed.accessToken();
  if (!accessToken) throw new Error("Token exchange failed: missing access token");
  const tokenType = parsed.tokenType() ?? (json.token_type as string | undefined);
  const refreshToken = parsed.refreshToken() ?? (json.refresh_token as string | undefined);
  const idToken = json.id_token as string | undefined;
  const expiresAtDate = parsed.accessTokenExpiresAt();
  const expires_at = expiresAtDate
    ? expiresAtDate.getTime()
    : typeof json.expires_in === "number"
      ? Date.now() + json.expires_in * 1000
      : undefined;

  // Parse JWT id_token to extract account_id (for Codex)
  let account_id: string | undefined;
  let email: string | undefined;
  if (idToken) {
    const claims = parseJWT(idToken);
    // Codex uses chatgpt_account_id in the https://api.openai.com/auth claim
    account_id = claims?.["https://api.openai.com/auth"]?.chatgpt_account_id
      ?? claims?.sub;
    email = claims?.email;
  }

  return { access_token: accessToken, refresh_token: refreshToken, token_type: tokenType, expires_at, id_token: idToken, account_id, email };
}

// Parse JWT without verification (just extract claims)
function parseJWT(token: string): Record<string, any> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = Buffer.from(parts[1], 'base64url').toString('utf-8');
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

export class TokenRefreshError extends Error {
  constructor(public providerId: string, message: string) {
    super(message);
    this.name = "TokenRefreshError";
  }
}

async function refreshToken(provider: Provider, cred: OAuthCredential): Promise<OAuthCredential> {
  const auth = provider.auth;
  if (auth.type !== "oauth2") return cred;
  if (!cred.refresh_token) {
    throw new TokenRefreshError(provider.id, `No refresh token available. Run: bun run login --provider ${provider.id}`);
  }

  const { clientId, clientSecret } = getOAuthClient(provider);
  const useJson = auth.tokenFormat === "json";

  let body: string;
  let contentType: string;

  if (useJson) {
    const payload: Record<string, string> = {
      grant_type: "refresh_token",
      refresh_token: cred.refresh_token,
      client_id: clientId,
    };
    if (clientSecret) payload.client_secret = clientSecret;
    body = JSON.stringify(payload);
    contentType = "application/json";
  } else {
    const params = new URLSearchParams();
    params.set("grant_type", "refresh_token");
    params.set("refresh_token", cred.refresh_token);
    params.set("client_id", clientId);
    if (clientSecret) params.set("client_secret", clientSecret);
    body = params.toString();
    contentType = "application/x-www-form-urlencoded";
  }

  let res: Response;
  try {
    res = await fetch(auth.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": contentType, Accept: "application/json" },
      body,
    });
  } catch (err) {
    throw new TokenRefreshError(provider.id, `Network error during token refresh: ${err instanceof Error ? err.message : err}`);
  }

  if (!res.ok) {
    const text = await res.text();
    // Common refresh failure cases
    if (res.status === 400 || res.status === 401) {
      throw new TokenRefreshError(
        provider.id,
        `Token expired or revoked. Run: bun run login --provider ${provider.id}\n(Server: ${text})`
      );
    }
    throw new TokenRefreshError(provider.id, `Refresh failed (${res.status}): ${text}`);
  }

  const json = (await res.json()) as Record<string, any>;
  const parsed = new TokenRequestResult(json);
  if (parsed.hasErrorCode()) {
    throw new TokenRefreshError(
      provider.id,
      `Refresh failed: ${parsed.errorCode()}. Run: bun run login --provider ${provider.id}`
    );
  }

  const accessToken = parsed.accessToken() ?? (json.access_token as string | undefined) ?? cred.access_token;
  const newRefreshToken = parsed.refreshToken() ?? (json.refresh_token as string | undefined) ?? cred.refresh_token;
  const tokenType = parsed.tokenType() ?? (json.token_type as string | undefined) ?? cred.token_type;
  const expiresAtDate = parsed.accessTokenExpiresAt();
  const expires_at = expiresAtDate
    ? expiresAtDate.getTime()
    : typeof json.expires_in === "number"
      ? Date.now() + json.expires_in * 1000
      : cred.expires_at;

  const next: OAuthCredential = {
    ...cred, // Preserve extra fields like project_id, account_id, email
    access_token: accessToken,
    refresh_token: newRefreshToken,
    token_type: tokenType,
    expires_at,
  };
  saveCredential(provider.id, next);
  return next;
}

async function loginOAuth(provider: Provider, opts?: LoginOptions): Promise<OAuthCredential> {
  const auth = provider.auth;
  if (auth.type !== "oauth2") throw new Error("Auth type is not oauth2");
  const { clientId, clientSecret } = getOAuthClient(provider, opts);
  const { verifier, challenge } = generatePKCE();
  const state = randomUUID();
  const authUrl = new URL(auth.authUrl);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", auth.redirect);
  authUrl.searchParams.set("state", state);
  if (auth.scopes.length > 0) authUrl.searchParams.set("scope", auth.scopes.join(" "));
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  if (auth.extraAuthParams) {
    for (const [key, value] of Object.entries(auth.extraAuthParams)) {
      authUrl.searchParams.set(key, value);
    }
  }

  const code = await awaitAuthCode(auth.redirect, opts?.noBrowser, authUrl.toString());
  let token = await exchangeCodeForToken(auth, code, auth.redirect, clientId, clientSecret, { verifier }, state);

  // Gemini-specific: onboard user and get project_id
  if (provider.id === "gemini") {
    token = await geminiOnboarding(token, clientId, clientSecret);
  }

  saveCredential(provider.id, token);
  return token;
}

// Gemini CLI onboarding - checks subscription first, falls back to GCP project
async function geminiOnboarding(token: OAuthCredential, clientId: string, clientSecret: string): Promise<OAuthCredential> {
  const metadata = {
    ideType: "IDE_UNSPECIFIED",
    platform: "PLATFORM_UNSPECIFIED",
    pluginType: "GEMINI",
  };
  const headers = {
    "Authorization": `Bearer ${token.access_token}`,
    "Content-Type": "application/json",
    "User-Agent": "google-api-nodejs-client/9.15.1",
    "X-Goog-Api-Client": "gl-node/22.17.0",
    "Client-Metadata": "ideType=IDE_UNSPECIFIED,platform=PLATFORM_UNSPECIFIED,pluginType=GEMINI",
  };

  // 1. Call loadCodeAssist WITHOUT project to check for subscription
  console.log("Checking Gemini CLI subscription...");
  const loadRes = await fetch("https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist", {
    method: "POST",
    headers,
    body: JSON.stringify({ metadata }),
  });

  if (!loadRes.ok) {
    console.warn("Could not load code assist, skipping onboarding");
    return token;
  }

  const loadData = await loadRes.json() as {
    allowedTiers?: { id: string; isDefault?: boolean }[];
    cloudaicompanionProject?: string | { id?: string };
  };

  // 2. Get tier ID
  let tierID = "legacy-tier";
  const defaultTier = loadData.allowedTiers?.find(t => t.isDefault);
  if (defaultTier?.id) tierID = defaultTier.id;

  // 3. Get project from subscription or fall back to GCP projects
  let projectId = "";
  if (typeof loadData.cloudaicompanionProject === "string") {
    projectId = loadData.cloudaicompanionProject.trim();
  } else if (loadData.cloudaicompanionProject?.id) {
    projectId = loadData.cloudaicompanionProject.id.trim();
  }

  if (projectId) {
    console.log(`Using Gemini CLI subscription project: ${projectId}`);
  } else {
    // Fall back to fetching GCP projects
    console.log("No subscription found, fetching GCP projects...");
    const projectsRes = await fetch("https://cloudresourcemanager.googleapis.com/v1/projects", { headers });
    if (!projectsRes.ok) {
      console.warn("Could not fetch GCP projects, skipping onboarding");
      return token;
    }
    const projectsData = await projectsRes.json() as { projects?: { projectId: string; lifecycleState: string }[] };
    const activeProjects = (projectsData.projects || []).filter(p => p.lifecycleState === "ACTIVE");
    if (activeProjects.length === 0) {
      console.warn("No active GCP projects found");
      return token;
    }
    projectId = activeProjects[0].projectId;
    console.log(`Using GCP project: ${projectId}`);
  }

  // 4. Call onboardUser
  console.log("Onboarding user for Gemini CLI...");
  const onboardRes = await fetch("https://cloudcode-pa.googleapis.com/v1internal:onboardUser", {
    method: "POST",
    headers,
    body: JSON.stringify({
      tierId: tierID,
      metadata,
      cloudaicompanionProject: projectId,
    }),
  });

  if (!onboardRes.ok) {
    const errText = await onboardRes.text();
    console.warn(`Onboarding failed (${onboardRes.status}): ${errText}`);
    // Still save project_id even if onboarding fails - might already be onboarded
  } else {
    const onboardData = await onboardRes.json() as { done?: boolean; response?: { cloudaicompanionProject?: string | { id?: string } } };
    if (onboardData.done) {
      console.log("Onboarding complete!");
      // Use project from response if available
      const resp = onboardData.response?.cloudaicompanionProject;
      if (typeof resp === "string" && resp.trim()) {
        projectId = resp.trim();
      } else if (resp && typeof resp === "object" && resp.id) {
        projectId = resp.id.trim();
      }
    }
  }

  // 5. Return token with project_id
  return {
    ...token,
    project_id: projectId,
  } as OAuthCredential;
}

function loginApiKey(provider: Provider, opts?: LoginOptions) {
  const key = opts?.apiKey ?? process.env[envKey(provider.id, "API_KEY")];
  if (!key) {
    throw new Error(`Missing API key for provider ${provider.id}. Set ${envKey(provider.id, "API_KEY")} or pass via options.`);
  }
  const credential = { apiKey: key } as const;
  saveCredential(provider.id, credential);
  return credential;
}

export async function login(providerId: string, opts?: LoginOptions) {
  const provider = await getProvider(providerId);
  if (!provider) {
    throw new Error(`Unknown provider: ${providerId}`);
  }
  if (provider.auth.type === "oauth2") {
    return loginOAuth(provider, opts);
  }
  return loginApiKey(provider, opts);
}

export async function ensureCredential(provider: Provider): Promise<OAuthCredential | { apiKey: string }> {
  const cred = loadCredential(provider.id);
  if (!cred) {
    throw new Error(`No credential found for ${provider.id}. Run login first.`);
  }
  if (provider.auth.type === "api_key") {
    if (!("apiKey" in cred) || !cred.apiKey) {
      throw new Error(`Stored credential for ${provider.id} is missing apiKey.`);
    }
    return { apiKey: cred.apiKey };
  }
  if (!("access_token" in cred)) {
    throw new Error(`Stored credential for ${provider.id} is not an OAuth token.`);
  }
  const now = Date.now() + 60_000; // buffer 60s
  if (cred.expires_at && cred.expires_at < now) {
    return refreshToken(provider, cred);
  }
  return cred;
}

export function credentialLocation(providerId: string) {
  return credentialPath(providerId);
}

function base64Url(input: Buffer) {
  return input
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function generatePKCE() {
  const verifier = base64Url(randomBytes(32));
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}
