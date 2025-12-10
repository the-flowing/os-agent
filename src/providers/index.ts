// Dynamic provider discovery
import { readdirSync } from "fs";
import { join, dirname } from "path";
import type { Provider } from "./types";
import { hasCredentialForProvider } from "../proxy/credentials";

export type { Provider, ModelConfig, AuthConfig, OAuthConfig, ApiKeyConfig, CredentialInfo, StreamEvent } from "./types";

const providersDir = dirname(import.meta.path);
const providerCache = new Map<string, Provider>();
const loadingProviders = new Map<string, Promise<Provider | null>>(); // Prevents race conditions
let allProvidersLoaded = false;

// Default transforms for providers that don't define them
const defaultTransforms = {
  applyHeaders: () => {},
  transformRequest: (body: Record<string, any>) => body,
  buildUrl: (baseUrl: string) => baseUrl,
};

async function loadProvider(id: string): Promise<Provider | null> {
  // Return cached provider
  if (providerCache.has(id)) {
    return providerCache.get(id)!;
  }

  // Return existing loading promise to prevent race condition
  if (loadingProviders.has(id)) {
    return loadingProviders.get(id)!;
  }

  // Start loading and cache the promise
  const loadPromise = (async () => {
    try {
      const modulePath = join(providersDir, `${id}.ts`);
      const module = await import(modulePath);

      const provider: Provider = {
        ...defaultTransforms,
        ...module.default,
      };

      providerCache.set(id, provider);
      return provider;
    } catch (error) {
      console.error(`Error loading provider ${id}:`, error);
      return null;
    } finally {
      loadingProviders.delete(id);
    }
  })();

  loadingProviders.set(id, loadPromise);
  return loadPromise;
}

export async function loadAllProviders(): Promise<Provider[]> {
  if (allProvidersLoaded) {
    return Array.from(providerCache.values());
  }

  const files = readdirSync(providersDir);
  const providerFiles = files.filter(
    (f) => f.endsWith(".ts") && !f.startsWith("codex-instructions") && f !== "index.ts" && f !== "types.ts"
  );

  for (const file of providerFiles) {
    const id = file.replace(".ts", "");
    await loadProvider(id);
  }

  allProvidersLoaded = true;
  return Array.from(providerCache.values());
}

export async function getProvider(id: string): Promise<Provider | null> {
  return loadProvider(id);
}

export async function getProviderByModel(modelAlias: string): Promise<Provider | null> {
  const providers = await loadAllProviders();
  const lower = modelAlias.toLowerCase();

  for (const provider of providers) {
    for (const model of provider.models) {
      if (
        model.aliases.map((a) => a.toLowerCase()).includes(lower) ||
        model.upstream.toLowerCase() === lower
      ) {
        return provider;
      }
    }
  }
  return null;
}

export function resolveModel(provider: Provider, modelAlias: string): string | null {
  const lower = modelAlias.toLowerCase();

  for (const model of provider.models) {
    if (
      model.aliases.map((a) => a.toLowerCase()).includes(lower) ||
      model.upstream.toLowerCase() === lower
    ) {
      return model.upstream;
    }
  }
  return null;
}

// Get all available models for model picker
export interface AvailableModel {
  alias: string;
  upstream: string;
  providerId: string;
  isSota?: boolean;
  hasCredential: boolean;
}

// SOTA models in order of preference
const SOTA_ORDER = ["opus", "codex", "gemini-pro"];

export async function getAvailableModels(): Promise<AvailableModel[]> {
  const providers = await loadAllProviders();
  const sota: AvailableModel[] = [];
  const rest: AvailableModel[] = [];

  for (const provider of providers) {
    for (let i = 0; i < provider.models.length; i++) {
      const model = provider.models[i];
      const alias = model.aliases[0] || model.upstream;
      const entry: AvailableModel = {
        alias,
        upstream: model.upstream,
        providerId: provider.id,
        isSota: i === 0, // First model of each provider is SOTA
        hasCredential: hasCredentialForProvider(provider.id),
      };

      if (i === 0) {
        sota.push(entry);
      } else {
        rest.push(entry);
      }
    }
  }

  // Sort SOTA by preference order
  sota.sort((a, b) => {
    const aIdx = SOTA_ORDER.indexOf(a.alias);
    const bIdx = SOTA_ORDER.indexOf(b.alias);
    if (aIdx === -1 && bIdx === -1) return 0;
    if (aIdx === -1) return 1;
    if (bIdx === -1) return -1;
    return aIdx - bIdx;
  });

  return [...sota, ...rest];
}
