import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidEmail(value: string): boolean {
  const email = normalizeEmail(value);
  return email.length > 3 && email.length <= 254 && EMAIL_RE.test(email) && !email.includes("..");
}

export function captureEmail(filePath: string, record: {
  email: string;
  source: string;
  createdAt?: string;
}): void {
  mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const line = JSON.stringify({
    email: normalizeEmail(record.email),
    source: record.source,
    createdAt: record.createdAt || new Date().toISOString(),
  });
  appendFileSync(filePath, `${line}\n`, { encoding: "utf8", mode: 0o600 });
}
