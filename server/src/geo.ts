import { existsSync, readFileSync, statSync } from "node:fs";
import { Reader, type CityResponse } from "mmdb-lib";
import type { AppConfig } from "./config.ts";

export type GeoLocation = {
  country: string;
  city: string;
};

export type GeoSource = "cloudflare" | "mmdb" | null;

export type GeoLocator = {
  locate(ip: string, headers?: Headers): GeoLocation;
  source(): GeoSource;
};

type MmdbRecord = {
  country?: { iso_code?: string };
  registered_country?: { iso_code?: string };
  city?: { names?: { fr?: string; en?: string } };
};

const UNKNOWN: GeoLocation = { country: "", city: "" };
const RELOAD_CHECK_MS = 10 * 60 * 1000;
// Cloudflare uses XX for unknown and T1 for Tor exit nodes.
const COUNTRY_RE = /^[A-Z]{2}$/;
const NOT_A_COUNTRY = new Set(["XX", "T1"]);

function cleanCountry(value: string | null | undefined): string {
  const code = (value || "").trim().toUpperCase();
  return COUNTRY_RE.test(code) && !NOT_A_COUNTRY.has(code) ? code : "";
}

// Node decodes header bytes as Latin-1; Cloudflare sends city names in UTF-8.
function decodeHeader(value: string): string {
  const decoded = Buffer.from(value, "latin1").toString("utf8");
  return decoded.includes("\uFFFD") ? value : decoded;
}

function cleanCity(value: string | null | undefined): string {
  return decodeHeader((value || "").trim())
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .slice(0, 80);
}

export function locationFromMmdb(record: MmdbRecord | null | undefined): GeoLocation {
  if (!record) {
    return UNKNOWN;
  }
  const country = cleanCountry(record.country?.iso_code || record.registered_country?.iso_code);
  const names = record.city?.names || {};
  return { country, city: country ? cleanCity(names.fr || names.en || "") : "" };
}

export function createGeoLocator(config: Pick<AppConfig, "geoipPath" | "trustProxy">): GeoLocator {
  const dbPath: string = config.geoipPath;
  let reader: Reader<CityResponse> | null = null;
  let loadedMtime = 0;
  let checkedAt = 0;
  let sawProxyHeader = false;

  function currentReader(): Reader<CityResponse> | null {
    const now = Date.now();
    if (checkedAt && now - checkedAt < RELOAD_CHECK_MS) {
      return reader;
    }
    checkedAt = now;
    try {
      if (!existsSync(dbPath)) {
        reader = null;
        return null;
      }
      const mtime = statSync(dbPath).mtimeMs;
      if (!reader || mtime !== loadedMtime) {
        reader = new Reader<CityResponse>(readFileSync(dbPath));
        loadedMtime = mtime;
      }
    } catch (error) {
      console.error("[geo] cannot read", dbPath, error);
      reader = null;
    }
    return reader;
  }

  function fromDatabase(ip: string): GeoLocation {
    const db = currentReader();
    if (!db) {
      return UNKNOWN;
    }
    try {
      return locationFromMmdb(db.get(ip));
    } catch {
      return UNKNOWN;
    }
  }

  return {
    locate(ip, headers) {
      // Proxy headers can be forged by any client unless the proxy is trusted.
      const headerCountry = config.trustProxy ? cleanCountry(headers?.get("cf-ipcountry")) : "";
      if (headerCountry) {
        sawProxyHeader = true;
        const city = cleanCity(headers?.get("cf-ipcity"));
        if (city) {
          return { country: headerCountry, city };
        }
        const fallback = fromDatabase(ip);
        return { country: headerCountry, city: fallback.country === headerCountry ? fallback.city : "" };
      }
      return fromDatabase(ip);
    },
    source() {
      if (sawProxyHeader) {
        return "cloudflare";
      }
      return currentReader() ? "mmdb" : null;
    },
  };
}
