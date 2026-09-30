const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Throwaway inbox providers: an address there proves nothing about a person.
const DISPOSABLE_DOMAINS = new Set([
  "10minutemail.com",
  "20minutemail.com",
  "33mail.com",
  "anonaddy.me",
  "burnermail.io",
  "discard.email",
  "dispostable.com",
  "dropmail.me",
  "emailondeck.com",
  "fakeinbox.com",
  "getairmail.com",
  "getnada.com",
  "guerrillamail.com",
  "guerrillamail.info",
  "guerrillamail.net",
  "guerrillamail.org",
  "guerrillamailblock.com",
  "harakirimail.com",
  "jetable.org",
  "mail-temporaire.fr",
  "mailcatch.com",
  "maildrop.cc",
  "mailinator.com",
  "mailinator.net",
  "mailnesia.com",
  "mintemail.com",
  "mohmal.com",
  "moakt.com",
  "mytemp.email",
  "nada.email",
  "sharklasers.com",
  "spam4.me",
  "spamgourmet.com",
  "temp-mail.io",
  "temp-mail.org",
  "tempail.com",
  "tempmail.com",
  "tempmail.dev",
  "tempmailo.com",
  "tempr.email",
  "throwawaymail.com",
  "trashmail.com",
  "trashmail.de",
  "trashmail.fr",
  "trashmail.net",
  "yopmail.com",
  "yopmail.fr",
  "yopmail.net",
]);

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidEmail(value: string): boolean {
  const email = normalizeEmail(value);
  return email.length > 3 && email.length <= 254 && EMAIL_RE.test(email) && !email.includes("..");
}

export function isDisposableEmail(value: string): boolean {
  const domain = normalizeEmail(value).split("@")[1] || "";
  const parts = domain.split(".");
  for (let index = 0; index < parts.length - 1; index += 1) {
    if (DISPOSABLE_DOMAINS.has(parts.slice(index).join("."))) {
      return true;
    }
  }
  return false;
}
