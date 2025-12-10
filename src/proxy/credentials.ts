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

export function hasCredentialForProvider(providerId: string): boolean {
  // Check explicit file or any matching credential file name
  const id = providerId.toLowerCase();
  return !!loadCredential(providerId) || listCredentialFiles().some((f) => f.toLowerCase().includes(id));
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

export function deleteCredential(providerId: string): boolean {
  const filePath = credentialPath(providerId);
  if (!fs.existsSync(filePath)) return false;
  fs.unlinkSync(filePath);
  return true;
}

export function hasAnyCredentialFiles(): boolean {
  ensureDir();
  const files = fs.readdirSync(CREDENTIALS_DIR);
  return files.length > 0;
}

export function listCredentialFiles(): string[] {
  ensureDir();
  return fs.readdirSync(CREDENTIALS_DIR).map((f) => path.join(CREDENTIALS_DIR, f));
}
