#!/usr/bin/env bun
import { login, credentialLocation } from "./index";

function parseArgs() {
  const args = process.argv.slice(2);
  const out: { providerId?: string; noBrowser?: boolean; apiKey?: string } = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if ((arg === "-p" || arg === "--provider") && args[i + 1]) {
      out.providerId = args[++i];
    } else if (arg === "--no-browser") {
      out.noBrowser = true;
    } else if (arg === "--api-key" && args[i + 1]) {
      out.apiKey = args[++i];
    }
  }
  return out;
}

async function main() {
  const { providerId, noBrowser, apiKey } = parseArgs();
  if (!providerId) {
    console.error("Usage: bun run login --provider <id> [--no-browser] [--api-key <key>]");
    process.exit(1);
  }
  await login(providerId, { noBrowser, apiKey });
  console.log(`Credential saved at ${credentialLocation(providerId)}`);
  process.exit(0);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
