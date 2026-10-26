import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { openAnalytics } from "../src/analytics.ts";
import { carouselCaption, carouselSlides, slideSvg } from "../src/carousel.ts";
import { loadDashboardData } from "../src/data.ts";
import { loadEngine } from "../src/share.ts";

test("the launch carousel resolves eight slides with the chosen phrases", async () => {
  const analytics = openAnalytics(path.resolve(import.meta.dirname, "..", "..", "analysis_outputs", "analytics.sqlite"));
  if (!analytics) {
    return;
  }
  const bundle = loadDashboardData(path.resolve(import.meta.dirname, "..", "..", "dashboard", "data", "dashboard-data.json"));
  const slides = carouselSlides(analytics, bundle);
  assert.equal(slides.length, 8);
  assert.deepEqual(
    slides.map((slide) => slide.phrase),
    [
      "services publics",
      "dérèglement climatique",
      "enfants placés",
      "droit international",
      "suicide assisté",
      "extrême gauche",
      "pouvoir achat",
      "élus locaux",
    ],
  );
  for (const slide of slides) {
    assert.ok(slide.count > 0 && slide.rest >= 0, slide.party);
    assert.ok(slide.color.startsWith("#"), slide.party);
  }
  const caption = carouselCaption(slides);
  assert.match(caption, /1\. LFI-NFP : « services publics »/);
  assert.doesNotMatch(caption, /groupes réunis/);

  const { regular, bold } = await loadEngine();
  const svg = slideSvg(slides[1], 1, slides.length, { regular, bold });
  assert.match(svg, /dérèglement/);
  assert.match(svg, /autres orateurs/);
  assert.match(svg, /réunis/);
  assert.match(svg, /2 \/ 8/);
});
