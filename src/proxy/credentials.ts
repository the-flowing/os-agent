import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Credential } from "./types";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CREDENTIALS_DIR = path.join(ROOT, "credentials");

function ensureDir() {
  if (!fs.existsSync(CREDENTIALS_DIR)) {
    fs.mkdirSync(CREDENTIALS_DIR, { recursive: true });
  }
}

export function credentialPath(providerId: string) {
  ensureDir();
  return path.join(CREDENTIALS_DIR, `${providerId}.json`);
}

export function saveCredential(providerId: string, credential: Credential) {
  ensureDir();
  const filePath = credentialPath(providerId);
  fs.writeFileSync(filePath, JSON.stringify(credential, null, 2), "utf8");
}

export function loadCredential(providerId: string): Credential | undefined {
  const filePath = credentialPath(providerId);
  if (!fs.existsSync(filePath)) return undefined;
  const raw = fs.readFileSync(filePath, "utf8");
  try {
    return JSON.parse(raw) as Credential;
  } catch (err) {
    throw new Error(`Failed to parse credential for ${providerId}: ${(err as Error).message}`);
  }
}
