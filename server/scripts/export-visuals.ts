import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Resvg } from "@resvg/resvg-wasm";
import { openAnalytics } from "../src/analytics.ts";
import { loadConfig } from "../src/config.ts";
import { loadDashboardData } from "../src/data.ts";
import { loadDotEnv } from "../src/load-env.ts";
import { carouselCaption, carouselSlides, slideSvg } from "../src/carousel.ts";
import { slugify } from "../src/outreach.ts";
import { buildCard, loadEngine, renderCard } from "../src/share.ts";

// npm run visuals
//   outreach/visuels/01-lfi-nfp.png …  one card per parliamentary group,
//   in the order of the dashboard, each showing the phrase that sets the
//   group apart. Ready to post as a carousel on launch day.

const NON_DEPUTY_PARTIES = new Set(["GOUV", "UNLABELED"]);

loadDotEnv();
const config = loadConfig();
const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const outDir = path.resolve(path.join(repoRoot, "outreach", "visuels"));
const host = new URL(config.baseURL).host;

const analytics = openAnalytics(config.analyticsPath);
if (!analytics) {
  console.error("Analytics database missing:", config.analyticsPath);
  process.exit(1);
}
const bundle = loadDashboardData(config.dashboardDataPath);
const parties = (bundle.parties as Array<{ id: string; label: string }>).filter((party) => !NON_DEPUTY_PARTIES.has(party.id));
const order = new Map((bundle.partyOrder as string[]).map((id, index) => [id, index]));
parties.sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99));

rmSync(outDir, { recursive: true, force: true });
const groupsDir = path.join(outDir, "groupes");
const carouselDir = path.join(outDir, "carrousel");
mkdirSync(groupsDir, { recursive: true });
mkdirSync(carouselDir, { recursive: true });
const captions: string[] = [];
let index = 0;
for (const party of parties) {
  const card = buildCard("groupe", party.id, analytics, bundle);
  if (!card?.quote) {
    console.warn(`No distinctive phrase for ${party.label}, skipped.`);
    continue;
  }
  index += 1;
  const file = `${String(index).padStart(2, "0")}-${slugify(party.label)}.png`;
  writeFileSync(path.join(groupsDir, file), await renderCard(card, host, `visuel:${party.id}`));
  captions.push(`${index}. ${party.label} : ${card.quote.text}, ${card.quote.note}`);
  console.log(`${file}  ${party.label} : ${card.quote.text}`);
}
writeFileSync(path.join(groupsDir, "legendes.txt"), `${captions.join("\n")}\n`);
console.log(`${index} group cards in ${groupsDir}.`);

const { fonts, regular, bold } = await loadEngine();
const slides = carouselSlides(analytics, bundle);
for (const [slideIndex, slide] of slides.entries()) {
  const svg = slideSvg(slide, slideIndex, slides.length, { regular, bold });
  const png = new Resvg(svg, { font: { fontBuffers: fonts, defaultFontFamily: "Inter", loadSystemFonts: false } }).render().asPng();
  writeFileSync(path.join(carouselDir, slide.file), png);
  console.log(`${slide.file}  ${slide.party} : « ${slide.phrase} »`);
}
writeFileSync(path.join(carouselDir, "legende.txt"), carouselCaption(slides));
console.log(`${slides.length} carousel slides in ${carouselDir}.`);
