import assert from "node:assert/strict";
import test from "node:test";
import { normalizeQuery } from "../src/communes.ts";
import { phraseNote, signaturePhrase } from "../src/share.ts";
import { BOB } from "./analytics-fixture.ts";
import { startTestApp } from "./helpers.ts";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];

function metaContent(html: string, key: string): string {
  const match = html.match(new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)"`));
  return match ? match[1] : "";
}

test("commune search matches names, postcodes and the abroad constituencies", async () => {
  const { request } = await startTestApp();
  const search = async (q: string) => (await (await request(`/api/communes?q=${encodeURIComponent(q)}`)).json()).results;

  const [bordeaux] = await search("bordeaux");
  assert.deepEqual(bordeaux, {
    code: "33063",
    name: "Bordeaux",
    dept: "33",
    deptName: "Gironde",
    postcodes: ["33000", "33100", "33200", "33300", "33800"],
    circos: [1, 2, 3],
  });
  assert.equal((await search("33600"))[0].name, "Pessac");
  assert.deepEqual(
    (await search("75011")).map((row: { name: string }) => row.name),
    ["Paris 11e arrondissement", "Paris"],
    "the arrondissement comes before the whole city",
  );
  assert.equal((await search("st etienne"))[0].name, "Saint-Étienne");
  assert.equal((await search("taillan"))[0].name, "Le Taillan-Médoc", "matches the start of a later word");
  assert.equal((await search("étranger"))[0].dept, "099");
  assert.deepEqual(await search("x"), []);
  assert.deepEqual(await search(""), []);
});

test("commune search is free but refuses other sites", async () => {
  const { request } = await startTestApp();
  await request("/api/bootstrap");
  for (let index = 0; index < 15; index += 1) {
    assert.equal((await request("/api/communes?q=paris")).status, 200);
  }
  assert.equal((await (await request("/api/quota")).json()).quota.remaining, 10);
  const foreign = await request("/api/communes?q=paris", { headers: { origin: "https://evil.example" } });
  assert.equal(foreign.status, 403);
});

test("commune search answers 503 without its data file", async () => {
  const { request } = await startTestApp({ communesPath: "/nonexistent/communes.json" });
  assert.equal((await request("/api/communes?q=paris")).status, 503);
});

test("normalizeQuery folds accents, punctuation and saint abbreviations", () => {
  assert.equal(normalizeQuery("  Ste-Marie-aux-Chênes "), "sainte marie aux chenes");
  assert.equal(normalizeQuery("St Étienne"), "saint etienne");
  assert.equal(normalizeQuery("L'Haÿ-les-Roses"), "l hay les roses");
});

test("share cards are cacheable PNGs that other sites may embed", async () => {
  const { request } = await startTestApp();
  for (const path of [`/og/depute/${BOB}.png`, "/og/groupe/RN.png", "/og/theme/fin-de-vie.png", "/og/accueil.png"]) {
    const response = await request(path);
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get("content-type"), "image/png");
    assert.equal(response.headers.get("cache-control"), "public, max-age=86400");
    assert.equal(response.headers.get("cross-origin-resource-policy"), "cross-origin");
    const bytes = new Uint8Array(await response.arrayBuffer());
    assert.deepEqual([...bytes.slice(0, 4)], PNG_SIGNATURE, path);
  }
  const missing = await request("/og/depute/personne.png");
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.get("cache-control"), "no-store");
  assert.equal((await request("/og/inconnu/RN.png")).status, 404);
});

test("the dashboard page describes the deputy, group or theme of a shared link", async () => {
  const { request } = await startTestApp();
  const deputy = await (await request(`/?depute=${BOB}&onglet=depute`)).text();
  assert.match(deputy, /<title>Ce que dit Bob à l&#39;Assemblée nationale · Polititia<\/title>/);
  assert.equal(metaContent(deputy, "og:title"), "Ce que dit Bob à l&#39;Assemblée nationale");
  assert.match(metaContent(deputy, "og:description"), /Gironde, 4e circonscription/);
  assert.equal(metaContent(deputy, "og:url"), `http://127.0.0.1:8000/?depute=${BOB}`);
  assert.match(metaContent(deputy, "og:image"), new RegExp(`^http://127\\.0\\.0\\.1:8000/og/depute/${BOB}\\.png\\?v=`));
  assert.equal(metaContent(deputy, "twitter:card"), "summary_large_image");
  assert.equal((deputy.match(/<title>/g) || []).length, 1);

  const party = await (await request("/?groupe=RN")).text();
  assert.match(metaContent(party, "og:title"), /groupe RN/);
  const theme = await (await request("/?theme=fin-de-vie")).text();
  assert.match(metaContent(theme, "og:image"), /\/og\/theme\/fin-de-vie\.png/);

  const unknown = await (await request(`/?depute=${encodeURIComponent('"><script>alert(1)</script>')}`)).text();
  assert.doesNotMatch(unknown, /<script>alert/);
  assert.match(metaContent(unknown, "og:image"), /\/og\/accueil\.png/);
});

test("the card phrase is the first one the deputy page lists", () => {
  const phrase = signaturePhrase({
    "2": [
      { ngram: "finances publiques", count: 10, ratio: 4 },
      { ngram: "justice fiscale", count: 8, ratio: 6 },
    ],
    "4": [{ ngram: "direction générale finances publiques", count: 6, ratio: 12 }],
  });
  assert.equal(phrase?.ngram, "direction générale finances publiques");
  assert.equal(signaturePhrase({}), null);
});

test("the card phrase can be stated plainly", () => {
  const rows = (rest: number, ratio: number | null) => ({ "2": [{ ngram: "justice fiscale", count: 8, rest, ratio }, { ngram: "érosion côtière", count: 5, rest: 2, ratio: null }] });
  assert.equal(signaturePhrase(rows(461, null))?.ngram, "érosion côtière", "8 uses against 461 elsewhere is no signature");
  assert.equal(signaturePhrase(rows(461, 12))?.ngram, "justice fiscale", "unless the ratio is stable");
  assert.equal(signaturePhrase(rows(40, null))?.ngram, "justice fiscale", "everyone else combined said it 5 times as often at most");
  assert.equal(phraseNote({ ngram: "x", count: 17, rest: 19, ratio: null }), "17 fois, contre 19 pour tous les autres orateurs réunis");
  assert.equal(phraseNote({ ngram: "x", count: 11, rest: 47, ratio: 482 }), "11 fois, contre 47 pour tous les autres orateurs réunis", "counts beat a huge ratio");
  assert.equal(phraseNote({ ngram: "x", count: 17, rest: 126, ratio: 1061 }), "17 fois, contre 126 pour tous les autres orateurs réunis", "a ratio above 100 reads as a bug");
  assert.equal(phraseNote({ ngram: "x", count: 5, rest: 0, ratio: null }), "5 fois, et par aucun autre orateur");
  assert.equal(phraseNote({ ngram: "x", count: 12, rest: 606, ratio: 32 }), "32 fois plus souvent que le reste de l'Assemblée");
});
