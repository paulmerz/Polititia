const data = window.DASHBOARD_DATA;

if (!data) {
  throw new Error("Dashboard data was not loaded. Run dashboard/build_dashboard_data.py.");
}

const partyMap = new Map(data.parties.map((party) => [party.id, party]));
const partyOrder = data.partyOrder;
const politiciansById = new Map(data.politicians.map((person) => [person.id, person]));
const chamberSvg = document.getElementById("chamberSvg");
const analysisContent = document.getElementById("analysisContent");
const partyFilter = document.getElementById("partyFilter");
const searchInput = document.getElementById("searchInput");
const searchResults = document.getElementById("searchResults");
const themeSearch = document.getElementById("themeSearch");
const themeMenu = document.getElementById("themeMenu");
const themeContext = document.getElementById("themeContext");
const themeTab = document.getElementById("themeTab");
const showUnlabeled = document.getElementById("showUnlabeled");
const seatScaleNote = document.getElementById("seatScaleNote");
const dialog = document.getElementById("politicianDialog");
const dialogTitle = document.getElementById("dialogTitle");
const dialogContent = document.getElementById("dialogContent");

const languageMarkers = data.languageMarkers || { metrics: [], partyRows: [], summary: {} };
const languageMetricMap = new Map((languageMarkers.metrics || []).map((metric) => [metric.key, metric]));
const pronounKeys = ["nous", "je", "il", "vous"];
const lexicalMetricKeys = ["LD", "BW", "MWL", "MSL", "TTR"];
const topicPalette = ["#2f6f73", "#b35d32", "#6f5b9e", "#2d9b68", "#c43b58", "#3156a3", "#e4a72c", "#8e4bb5", "#42a9b8", "#26324d"];
const markerHelp = {
  address: "Parliamentary address formulas only (monsieur le ministre, chers collègues). Rate is hits per 1,000 words.",
  negation: "Negation scope (ne … pas / jamais / rien / plus), not comparatives such as plus de or les plus.",
  procedure: "Collocations that contain legislative procedure terms.",
  stance: "Collocations that contain stance verbs (faut, propose, refuse…).",
  pronoun: "Collocations that contain je / nous / vous.",
};
const dashboardPartyToLanguageParty = {
  LFI_NFP: "La France Insoumise",
  GDR: "Parti communiste français",
  EcoS: "Europe Écologie Les Verts",
  SOC: "Parti socialiste",
  Dem: "Ensemble",
  EPR: "Ensemble",
  HOR: "Ensemble",
  DR: "Les Républicains",
  RN: "Rassemblement national",
  UNLABELED: "Non déclaré(s)",
};

const state = {
  activeTab: "politician",
  selectedId: null,
  selectedParty: "ALL",
  partyFilter: "ALL",
  ngram: "2",
  markerCategory: null,
  languageMetric: "LD",
  search: "",
  showUnlabeled: false,
  seatMetric: "tokens",
  isolatedTopicId: null,
  themeId: "",
  themeQuery: "",
  themeMenuOpen: false,
};

function catalogThemes() {
  return data.themes || [];
}

function selectedTheme() {
  return catalogThemes().find((theme) => theme.id === state.themeId) || null;
}

function themeScore(personId) {
  if (!state.themeId) {
    return null;
  }
  return data.politicianThemeScores?.[personId]?.[state.themeId] || null;
}

function fmtShare(value) {
  return `${Math.round(Number(value || 0) * 100)}%`;
}

function trendLabel(trend) {
  if (trend === "new") {
    return "New";
  }
  if (trend === "rising") {
    return "Rising";
  }
  if (trend === "falling") {
    return "Falling";
  }
  return "Stable";
}

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function fmtInt(value) {
  return Number(value || 0).toLocaleString("en-US");
}

function fmtCompact(value) {
  return Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(Number(value || 0));
}

function languageMetric(key) {
  return languageMetricMap.get(key) || { key, label: key, shortLabel: key, unit: "value" };
}

function languageValue(row, key) {
  return Number(row?.values?.[key] || 0);
}

function fmtLanguageValue(key, value) {
  const unit = languageMetric(key).unit;
  if (unit === "percent") {
    return `${(Number(value || 0) * 100).toFixed(1)}%`;
  }
  if (unit === "ratio") {
    return Number(value || 0).toFixed(3);
  }
  if (unit === "perMille") {
    return `${Number(value || 0).toFixed(1)}\u2030`;
  }
  if (unit === "chars") {
    return `${Number(value || 0).toFixed(1)} ch`;
  }
  if (unit === "words") {
    return `${Number(value || 0).toFixed(1)} w`;
  }
  return Number(value || 0).toFixed(2);
}

function languageColor(index) {
  return topicPalette[index % topicPalette.length];
}

function languageRowsForMetric(metricKey) {
  return [...(languageMarkers.partyRows || [])]
    .filter((row) => Number.isFinite(languageValue(row, metricKey)))
    .sort((a, b) => languageValue(b, metricKey) - languageValue(a, metricKey));
}

function languageRowForDashboardParty(partyId) {
  const languageParty = dashboardPartyToLanguageParty[partyId];
  if (!languageParty) {
    return null;
  }
  return (languageMarkers.partyRows || []).find((row) => row.party === languageParty) || null;
}

function partyLabel(partyId) {
  return partyMap.get(partyId)?.label || partyId;
}

function partyColor(partyId) {
  return partyMap.get(partyId)?.color || "#8f969e";
}

function selectedPolitician() {
  return politiciansById.get(state.selectedId) || data.politicians[0];
}

function chooseInitialPolitician() {
  const ranked = [...data.politicians]
    .filter((person) => person.party !== "UNLABELED")
    .sort((a, b) => (b.surfaceTokenCount || 0) - (a.surfaceTokenCount || 0));
  state.selectedId = (ranked[0] || data.politicians[0])?.id || null;
  state.selectedParty = selectedPolitician()?.party || "ALL";
}

function renderSummary() {
  const theme = selectedTheme();
  const metrics = theme
    ? [
        ["On theme", `${fmtInt(theme.politicianCount)} / ${fmtInt(data.meta.politicians)}`],
        ["Theme speeches", theme.speechCount],
        ["Opened by", partyLabel(theme.openerParty) || "n/a"],
        ["Trend", trendLabel(theme.trend)],
      ]
    : [
        ["Politicians", data.meta.politicians],
        ["Speeches", data.meta.totalSpeeches],
        ["Surface tokens", data.meta.totalSurfaceTokens],
        ["Parties", data.meta.eligibleParties.length],
      ];
  document.getElementById("summaryStrip").innerHTML = metrics
    .map(
      ([label, value]) => `
        <div class="metric">
          <span class="metric-value">${typeof value === "number" ? fmtCompact(value) : escapeHtml(value)}</span>
          <span class="metric-label">${escapeHtml(label)}</span>
        </div>
      `,
    )
    .join("");
  const eyebrow = document.querySelector(".eyebrow");
  if (eyebrow) {
    eyebrow.textContent = theme ? `Lens: ${theme.label}` : "French parliamentary speeches";
  }
}

function populatePartyFilter() {
  const options = [
    `<option value="ALL">All parties</option>`,
    ...data.parties
      .filter((party) => party.politicianCount > 0)
      .map(
        (party) =>
          `<option value="${escapeHtml(party.id)}">${escapeHtml(party.label)} (${party.politicianCount})</option>`,
      ),
  ];
  partyFilter.innerHTML = options.join("");
}

function matchingThemes() {
  const term = normalize(state.themeQuery.trim());
  return catalogThemes().filter((theme) => {
    if (!term) {
      return true;
    }
    const aliases = (theme.aliases || []).join(" ");
    return normalize(`${theme.label} ${aliases} ${theme.type}`).includes(term);
  });
}

function renderThemeMenu() {
  if (!state.themeMenuOpen) {
    themeMenu.hidden = true;
    themeMenu.innerHTML = "";
    return;
  }

  const themes = matchingThemes();
  const domains = themes.filter((theme) => theme.type !== "emerging");
  const signals = themes.filter((theme) => theme.type === "emerging");
  const sections = [];
  sections.push(`<button class="theme-option ${state.themeId ? "" : "is-active"}" type="button" data-theme-id="">All issues</button>`);
  if (!catalogThemes().length) {
    sections.push(`<p class="source-note theme-option-label">No theme index. Rebuild the pipeline.</p>`);
  }
  if (domains.length) {
    sections.push(`<div class="theme-group-label">Domains</div>`);
    domains.forEach((theme) => {
      sections.push(`
        <button class="theme-option ${theme.id === state.themeId ? "is-active" : ""}" type="button" data-theme-id="${escapeHtml(theme.id)}">
          ${escapeHtml(theme.label)}
          <small>${fmtInt(theme.speechCount)} speeches · ${fmtInt(theme.politicianCount)} politicians</small>
        </button>
      `);
    });
  }
  if (signals.length) {
    sections.push(`<div class="theme-group-label">Signals</div>`);
    signals.forEach((theme) => {
      sections.push(`
        <button class="theme-option ${theme.id === state.themeId ? "is-active" : ""}" type="button" data-theme-id="${escapeHtml(theme.id)}">
          ${escapeHtml(theme.label)}
          <small>${escapeHtml(trendLabel(theme.trend))} · ${fmtInt(theme.speechCount)} speeches</small>
        </button>
      `);
    });
  }
  themeMenu.innerHTML = sections.join("");
  themeMenu.hidden = false;
}

function renderThemeContext() {
  const theme = selectedTheme();
  if (!theme) {
    themeContext.hidden = true;
    themeContext.innerHTML = "";
    return;
  }
  themeContext.hidden = false;
  themeContext.innerHTML = `
    <span class="theme-chip">
      ${escapeHtml(theme.label)}
      <button type="button" data-clear-theme="true" aria-label="Clear theme">x</button>
    </span>
    <span class="theme-context-meta">
      ${theme.type === "emerging" ? "Signal" : "Domain"}
      · ${fmtInt(theme.politicianCount)} politicians
      · opened ${escapeHtml(theme.firstDate || "n/a")}
    </span>
  `;
}

function syncControls() {
  partyFilter.value = state.partyFilter;
  searchInput.value = state.search;
  searchInput.placeholder = selectedTheme() ? "Name, in this theme" : "Name";
  themeSearch.value = selectedTheme() && !state.themeMenuOpen ? selectedTheme().label : state.themeQuery;
  themeSearch.placeholder = selectedTheme() ? selectedTheme().label : "All issues";
  showUnlabeled.checked = state.showUnlabeled;
  if (themeTab) {
    themeTab.hidden = !selectedTheme();
  }
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.toggle("is-active", tab.dataset.tab === state.activeTab);
  });
  document.querySelectorAll("[data-seat-metric]").forEach((button) => {
    const isActive = button.dataset.seatMetric === state.seatMetric;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
  });
  renderThemeMenu();
  renderThemeContext();
}

function getVisiblePoliticians() {
  const term = normalize(state.search.trim());
  return data.politicians.filter((person) => {
    if (state.partyFilter !== "ALL" && person.party !== state.partyFilter) {
      return false;
    }
    if (person.party === "UNLABELED" && !state.showUnlabeled && state.partyFilter !== "UNLABELED") {
      return false;
    }
    if (term && !normalize(person.name).includes(term)) {
      return false;
    }
    return true;
  });
}

function buildSectors(visible) {
  const counts = new Map();
  visible.forEach((person) => counts.set(person.party, (counts.get(person.party) || 0) + 1));
  const ordered = partyOrder.filter((party) => counts.get(party) > 0);
  const weights = ordered.map((party) => Math.sqrt(counts.get(party)));
  const totalWeight = weights.reduce((sum, value) => sum + value, 0) || 1;
  let cursor = 160;
  const sectors = new Map();

  ordered.forEach((party, index) => {
    const width = (weights[index] / totalWeight) * 140;
    const start = cursor;
    const end = cursor - width;
    sectors.set(party, {
      party,
      count: counts.get(party),
      start,
      end,
      width,
      mid: (start + end) / 2,
    });
    cursor = end;
  });

  return sectors;
}

const SEAT_ROW_RADII = [116, 169, 222, 275, 328, 381, 434, 486];

function distributeRowCounts(n, radii) {
  if (n <= 0) {
    return radii.map(() => 0);
  }
  const totalWeight = radii.reduce((sum, radius) => sum + radius, 0);
  const exact = radii.map((radius) => (n * radius) / totalWeight);
  const counts = exact.map((value) => Math.floor(value));
  let leftover = n - counts.reduce((sum, count) => sum + count, 0);
  const order = exact
    .map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((a, b) => b.frac - a.frac || b.index - a.index);
  for (let i = 0; i < leftover; i += 1) {
    counts[order[i].index] += 1;
  }
  return counts;
}

function polarPoint(cx, cy, radius, angleDegrees) {
  const radians = (angleDegrees * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(radians),
    y: cy - radius * Math.sin(radians),
  };
}

function arcPath(cx, cy, radius, start, end, steps = 48) {
  const points = [];
  for (let index = 0; index <= steps; index += 1) {
    const angle = start + ((end - start) * index) / steps;
    points.push(polarPoint(cx, cy, radius, angle));
  }
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(" ");
}

function svgEl(name, attrs = {}) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", name);
  Object.entries(attrs).forEach(([key, value]) => {
    element.setAttribute(key, value);
  });
  return element;
}

function seatMetricValue(person) {
  if (state.seatMetric === "speeches") {
    return Number(person.speechCount || 0);
  }
  return Number(person.surfaceTokenCount || 0);
}

function compareSeatPosition(a, b) {
  const speechDelta = Number(b.speechCount || 0) - Number(a.speechCount || 0);
  if (speechDelta !== 0) {
    return speechDelta;
  }
  return String(a.name || "").localeCompare(String(b.name || ""), "fr");
}

function themedSeatRadius(person, scale) {
  const score = themeScore(person.id);
  const themed = Boolean(selectedTheme());
  const share = Number(score?.share || 0);
  return seatRadius(person, scale) * (themed && score ? 1 + Math.min(0.7, share) : themed ? 0.72 : 1);
}

function updateSeatRadii() {
  const scale = seatScale();
  chamberSvg.querySelectorAll(".seat-dot[data-politician-id]").forEach((dot) => {
    const person = politiciansById.get(dot.dataset.politicianId);
    if (!person) {
      return;
    }
    const radius = themedSeatRadius(person, scale);
    const score = themeScore(person.id);
    const label = score
      ? `${seatTooltip(person)} - ${fmtInt(score.speechCount)} theme speeches - first ${score.firstDate || "n/a"}`
      : seatTooltip(person);
    dot.setAttribute("r", radius.toFixed(2));
    dot.setAttribute("aria-label", label);
    const title = dot.querySelector("title");
    if (title) {
      title.textContent = label;
    }
    const halo = chamberSvg.querySelector(`.seat-halo[data-politician-id="${person.id}"]`);
    if (halo) {
      halo.setAttribute("r", (radius + 3.2).toFixed(2));
    }
  });
  renderSeatScaleNote(scale);
  if (seatScaleNote) {
    seatScaleNote.classList.remove("is-updating");
    void seatScaleNote.offsetWidth;
    seatScaleNote.classList.add("is-updating");
  }
}

function setSeatMetric(metric) {
  if (!metric || state.seatMetric === metric) {
    return;
  }
  state.seatMetric = metric;
  syncControls();
  requestAnimationFrame(() => {
    updateSeatRadii();
  });
}

const SEAT_RADIUS_MIN = 2.6;
const SEAT_RADIUS_MAX = 14.5;
const SEAT_SCALE_PERCENTILE = 0.9;

function quantile(values, p) {
  if (!values.length) {
    return 1;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * p;
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  if (lo === hi) {
    return sorted[lo];
  }
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (index - lo);
}

function seatScale() {
  const values = data.politicians.map((person) => seatMetricValue(person));
  return {
    cap: Math.max(1, quantile(values, SEAT_SCALE_PERCENTILE)),
    median: Math.max(1, quantile(values, 0.5)),
  };
}

function seatRadiusForValue(value, scale) {
  const capped = Math.min(Math.max(0, Number(value) || 0), scale.cap);
  return Math.max(SEAT_RADIUS_MIN, SEAT_RADIUS_MAX * Math.sqrt(capped / scale.cap));
}

function seatRadius(person, scale) {
  return seatRadiusForValue(seatMetricValue(person), scale);
}

function seatTooltip(person) {
  return `${person.name} - ${partyLabel(person.party)} - ${fmtInt(person.speechCount)} speeches · ${fmtCompact(person.surfaceTokenCount)} words`;
}

function layoutPartySeats(people, sector) {
  const radii = SEAT_ROW_RADII;
  const rowCounts = distributeRowCounts(people.length, radii);
  const gap = Math.min(2.4, sector.width / 7);
  const start = sector.start - gap;
  const end = sector.end + gap;
  const seats = [];
  let cursor = 0;

  for (let rowIndex = rowCounts.length - 1; rowIndex >= 0; rowIndex -= 1) {
    const count = rowCounts[rowIndex];
    if (!count) {
      continue;
    }
    const group = people.slice(cursor, cursor + count);
    cursor += count;
    const radius = radii[rowIndex];
    const stagger = count > 1 && rowIndex % 2 === 1 ? 0.4 : 0;
    group.forEach((person, index) => {
      const fraction = (index + 0.5 + stagger) / count;
      const theta = start + (end - start) * fraction;
      seats.push({ person, ...polarPoint(500, 585, radius, theta) });
    });
  }

  return seats;
}

function renderChamber() {
  const visible = getVisiblePoliticians();
  const sectors = buildSectors(visible);
  chamberSvg.replaceChildren();

  SEAT_ROW_RADII.forEach((radius) => {
    chamberSvg.appendChild(
      svgEl("path", {
        d: arcPath(500, 585, radius, 160, 20),
        class: "grid-arc",
      }),
    );
  });

  sectors.forEach((sector) => {
    chamberSvg.appendChild(
      svgEl("path", {
        d: arcPath(500, 585, 520, sector.start - 1, sector.end + 1, 28),
        class: "party-arc",
        stroke: partyColor(sector.party),
        "stroke-width": 8,
      }),
    );

    if (sector.width > 7) {
      const labelPoint = polarPoint(500, 585, 548, sector.mid);
      const label = svgEl("text", {
        x: labelPoint.x.toFixed(1),
        y: labelPoint.y.toFixed(1),
        class: "party-label",
      });
      label.textContent = partyLabel(sector.party);
      chamberSvg.appendChild(label);
    }
  });

  const tribune = svgEl("rect", {
    x: 416,
    y: 560,
    width: 168,
    height: 48,
    rx: 8,
    class: "tribune",
  });
  chamberSvg.appendChild(tribune);
  const tribuneText = svgEl("text", {
    x: 500,
    y: 590,
    class: "tribune-text",
  });
  tribuneText.textContent = "Presidence";
  chamberSvg.appendChild(tribuneText);

  if (!visible.length) {
    const empty = svgEl("text", { x: 500, y: 300, class: "empty-label" });
    empty.textContent = selectedTheme() ? "Nobody addresses this issue in the current filter" : "No matches";
    chamberSvg.appendChild(empty);
    renderLegend(new Map());
    return;
  }

  const byParty = new Map();
  visible.forEach((person) => {
    if (!byParty.has(person.party)) {
      byParty.set(person.party, []);
    }
    byParty.get(person.party).push(person);
  });

  const allSeats = [];
  partyOrder.forEach((party) => {
    const people = byParty.get(party);
    const sector = sectors.get(party);
    if (!people || !sector) {
      return;
    }
    people.sort(compareSeatPosition);
    allSeats.push(...layoutPartySeats(people, sector));
  });

  const scale = seatScale();
  const dots = svgEl("g");
  allSeats.forEach(({ person, x, y }) => {
    const score = themeScore(person.id);
    const themed = Boolean(selectedTheme());
    const muted = themed && !score;
    const share = Number(score?.share || 0);
    const radius = themedSeatRadius(person, scale);
    if (score) {
      dots.appendChild(
        svgEl("circle", {
          cx: x.toFixed(1),
          cy: y.toFixed(1),
          r: (radius + 3.2).toFixed(2),
          fill: partyColor(person.party),
          opacity: 0.22 + Math.min(0.35, share),
          class: "seat-halo",
          "data-politician-id": person.id,
        }),
      );
    }
    const themeNote = score
      ? `, ${fmtInt(score.speechCount)} on theme, ${fmtShare(share)} of speaking time`
      : themed
        ? ", has not addressed this theme"
        : "";
    const dot = svgEl("circle", {
      cx: x.toFixed(1),
      cy: y.toFixed(1),
      r: radius.toFixed(2),
      fill: partyColor(person.party),
      class: `seat-dot${person.id === state.selectedId ? " is-selected" : ""}${muted ? " is-muted" : ""}`,
      tabindex: 0,
      role: "button",
      "aria-label": `${seatTooltip(person)}${themeNote}`,
      "data-politician-id": person.id,
    });
    const title = svgEl("title");
    title.textContent = score
      ? `${seatTooltip(person)} - ${fmtInt(score.speechCount)} theme speeches - first ${score.firstDate || "n/a"}`
      : seatTooltip(person);
    dot.appendChild(title);
    dots.appendChild(dot);
  });
  chamberSvg.appendChild(dots);
  renderLegend(byParty);
  renderSeatScaleNote(scale);
}

function seatScaleExampleSvg(radius) {
  const size = Math.ceil(radius * 2 + 4);
  const center = size / 2;
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true"><circle cx="${center}" cy="${center}" r="${radius.toFixed(2)}" fill="#5b6575"></circle></svg>`;
}

function renderSeatScaleNote(scale) {
  if (!seatScaleNote) {
    return;
  }
  const isSpeeches = state.seatMetric === "speeches";
  const unit = isSpeeches ? "speeches" : "words";
  const formatValue = isSpeeches ? fmtInt : fmtCompact;
  const low = Math.max(1, Math.round(scale.cap * 0.1));
  const examples = [
    { value: low, label: formatValue(low) },
    { value: scale.median, label: formatValue(Math.round(scale.median)) },
    { value: scale.cap, label: `${formatValue(Math.round(scale.cap))}+` },
  ];
  const key = examples
    .map(
      (example) => `
        <span class="seat-size-key-item">
          ${seatScaleExampleSvg(seatRadiusForValue(example.value, scale))}
          <span>${escapeHtml(example.label)}</span>
        </span>`,
    )
    .join("");
  seatScaleNote.innerHTML = `
    <span>Circle area follows ${unit}, with a 90th-percentile cap so outliers share the largest size. Hover shows both counts.</span>
    <span class="seat-size-key" aria-label="Seat size key">${key}</span>
  `;
}

function renderLegend(byParty) {
  const legend = document.getElementById("partyLegend");
  legend.innerHTML = partyOrder
    .filter((party) => byParty.has(party))
    .map((party) => {
      const count = byParty.get(party)?.length || 0;
      return `
        <button class="legend-item result-button" type="button" data-party-filter="${escapeHtml(party)}">
          <span class="swatch" style="background:${partyColor(party)}"></span>
          <span>${escapeHtml(partyLabel(party))} ${fmtInt(count)}</span>
        </button>
      `;
    })
    .join("");
}

function renderSearchResults() {
  const term = normalize(state.search.trim());
  if (!term) {
    searchResults.classList.remove("is-visible");
    searchResults.innerHTML = "";
    return;
  }

  const matches = data.politicians
    .filter((person) => normalize(person.name).includes(term))
    .sort((a, b) => (b.surfaceTokenCount || 0) - (a.surfaceTokenCount || 0))
    .slice(0, 10);

  searchResults.classList.add("is-visible");
  searchResults.innerHTML = matches.length
    ? matches
        .map(
          (person) => `
            <button class="result-button" type="button" data-select-politician="${escapeHtml(person.id)}">
              ${escapeHtml(person.name)} · ${escapeHtml(partyLabel(person.party))}
            </button>
          `,
        )
        .join("")
    : `<span class="source-note">No results</span>`;
}

function phraseList(rows, options = {}) {
  const metric = options.metric || "count";
  const scoreLabel = options.scoreLabel || null;
  const scoreDigits = options.scoreDigits ?? 2;
  const maxValue = Math.max(
    1,
    ...rows.map((row) => Math.abs(Number(row[metric] ?? row.count ?? 0))),
  );
  if (!rows.length) {
    return `<p class="source-note">No phrases for this selection.</p>`;
  }
  return `
    <div class="phrase-list">
      ${rows
        .map((row) => {
          const value = Math.abs(Number(row[metric] ?? row.count ?? 0));
          const width = Math.max(4, (value / maxValue) * 100);
          const countText = scoreLabel
            ? `${Number(row[scoreLabel] || 0).toFixed(scoreDigits)}`
            : fmtInt(row.count);
          return `
            <div class="phrase-row">
              <div class="phrase-track" title="${escapeHtml(row.ngram)}">
                <span class="phrase-bar" style="width:${width.toFixed(1)}%"></span>
                <span class="phrase-text">${escapeHtml(row.ngram)}</span>
              </div>
              <span class="phrase-count">${escapeHtml(countText)}</span>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderLanguageMetricSelect(selectId = "languageMetricSelect") {
  return `
    <label class="field">
      <span>Marker</span>
      <select id="${escapeHtml(selectId)}">
        ${(languageMarkers.metrics || [])
          .map(
            (metric) => `
              <option value="${escapeHtml(metric.key)}" ${metric.key === state.languageMetric ? "selected" : ""}>
                ${escapeHtml(metric.label)}
              </option>
            `,
          )
          .join("")}
      </select>
    </label>
  `;
}

function renderLanguageMetricChart(metricKey) {
  const rows = languageRowsForMetric(metricKey);
  if (!rows.length) {
    return `<p class="source-note">No language markers available.</p>`;
  }

  const values = rows.map((row) => languageValue(row, metricKey));
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const range = Math.max(0.0001, maxValue - minValue);

  return `
    <div class="language-bars">
      ${rows
        .map((row, index) => {
          const value = languageValue(row, metricKey);
          const width = 12 + ((value - minValue) / range) * 88;
          return `
            <div class="language-bar-row">
              <div class="language-bar-label">
                <span>${escapeHtml(row.party)}</span>
                <strong>${escapeHtml(fmtLanguageValue(metricKey, value))}</strong>
              </div>
              <div class="language-track" aria-hidden="true">
                <span class="language-fill" style="width:${width.toFixed(1)}%; background:${languageColor(index)}"></span>
              </div>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderPronounStack(row) {
  const total = pronounKeys.reduce((sum, key) => sum + languageValue(row, key), 0);
  if (!total) {
    return `<div class="pronoun-stack is-empty"></div>`;
  }

  return `
    <div class="pronoun-stack">
      ${pronounKeys
        .map((key, index) => {
          const value = languageValue(row, key);
          const width = (value / total) * 100;
          return `
            <span
              style="width:${width.toFixed(1)}%; background:${languageColor(index)}"
              title="${escapeHtml(key)} ${escapeHtml(fmtLanguageValue(key, value))}"
            ></span>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderPronounDistribution() {
  const rows = [...(languageMarkers.partyRows || [])].sort((a, b) => {
    const totalA = pronounKeys.reduce((sum, key) => sum + languageValue(a, key), 0);
    const totalB = pronounKeys.reduce((sum, key) => sum + languageValue(b, key), 0);
    return totalB - totalA;
  });

  if (!rows.length) {
    return `<p class="source-note">No pronoun markers available.</p>`;
  }

  return `
    <div class="pronoun-legend">
      ${pronounKeys
        .map(
          (key, index) => `
            <span><span class="swatch" style="background:${languageColor(index)}"></span>${escapeHtml(key)}</span>
          `,
        )
        .join("")}
    </div>
    <div class="pronoun-list">
      ${rows
        .map((row) => {
          const total = pronounKeys.reduce((sum, key) => sum + languageValue(row, key), 0);
          return `
            <div class="pronoun-row">
              <div class="language-bar-label">
                <span>${escapeHtml(row.party)}</span>
                <strong>${escapeHtml(fmtLanguageValue("nous", total))}</strong>
              </div>
              ${renderPronounStack(row)}
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderLanguageMatrix() {
  const rows = [...(languageMarkers.partyRows || [])].sort((a, b) => a.party.localeCompare(b.party));
  if (!rows.length) {
    return "";
  }

  return `
    <div class="language-table-wrap">
      <table class="language-table">
        <thead>
          <tr>
            <th>Party</th>
            ${lexicalMetricKeys
              .map((key) => `<th>${escapeHtml(languageMetric(key).shortLabel)}</th>`)
              .join("")}
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (row) => `
                <tr>
                  <th>${escapeHtml(row.party)}</th>
                  ${lexicalMetricKeys
                    .map((key) => `<td>${escapeHtml(fmtLanguageValue(key, languageValue(row, key)))}</td>`)
                    .join("")}
                </tr>
              `,
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderPartyLanguageProfile(row) {
  if (!row) {
    return `
      <h3 class="section-title">Language profile</h3>
      <p class="source-note">No party-level marker row matched this dashboard group.</p>
    `;
  }

  return `
    <h3 class="section-title">Language profile</h3>
    <p class="source-note">Source party: ${escapeHtml(row.party)}</p>
    <div class="language-mini-grid">
      ${lexicalMetricKeys
        .map(
          (key) => `
            <div class="stat">
              <span>${escapeHtml(languageMetric(key).shortLabel)}</span>
              <strong>${escapeHtml(fmtLanguageValue(key, languageValue(row, key)))}</strong>
            </div>
          `,
        )
        .join("")}
    </div>
    <div class="party-pronoun-card">
      <div class="language-bar-label">
        <span>Pronouns</span>
        <strong>${escapeHtml(
          fmtLanguageValue(
            "nous",
            pronounKeys.reduce((sum, key) => sum + languageValue(row, key), 0),
          ),
        )}</strong>
      </div>
      ${renderPronounStack(row)}
      <div class="pronoun-legend">
        ${pronounKeys
          .map(
            (key, index) => `
              <span><span class="swatch" style="background:${languageColor(index)}"></span>${escapeHtml(key)}</span>
            `,
          )
          .join("")}
      </div>
    </div>
  `;
}

function markerTabs(markers) {
  const categories = Object.keys(markers || {});
  if (!categories.length) {
    return "";
  }
  if (!state.markerCategory || !categories.includes(state.markerCategory)) {
    state.markerCategory = categories[0];
  }
  return `
    <div class="subtabs">
      ${categories
        .map(
          (category) => `
            <button class="subtab ${category === state.markerCategory ? "is-active" : ""}" type="button" data-marker-category="${escapeHtml(category)}">
              ${escapeHtml(category)}
            </button>
          `,
        )
        .join("")}
    </div>
  `;
}

function ngramSelect(selectId) {
  return `
    <label class="field">
      <span>N-gram</span>
      <select id="${escapeHtml(selectId)}">
        <option value="1" ${state.ngram === "1" ? "selected" : ""}>Unigrams</option>
        <option value="2" ${state.ngram === "2" ? "selected" : ""}>Bigrams</option>
        <option value="3" ${state.ngram === "3" ? "selected" : ""}>Trigrams</option>
        <option value="4" ${state.ngram === "4" ? "selected" : ""}>Four-grams</option>
      </select>
    </label>
  `;
}

function renderExcerptList(excerpts) {
  if (!excerpts?.length) {
    return `<p class="source-note">No excerpts for this selection.</p>`;
  }
  return `
    <div class="excerpt-list">
      ${excerpts
        .map(
          (excerpt) => `
            <button class="excerpt-card" type="button" data-select-politician="${escapeHtml(excerpt.politicianId)}">
              <span class="source-note">${escapeHtml(excerpt.date || "n/a")} · ${escapeHtml(excerpt.speaker)} · ${escapeHtml(partyLabel(excerpt.party))}</span>
              <p>${escapeHtml(excerpt.snippet || "")}</p>
            </button>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderThemeLensNote(person) {
  const theme = selectedTheme();
  if (!theme) {
    return "";
  }
  const score = themeScore(person.id);
  const excerpts = data.politicianThemeExcerpts?.[person.id]?.[theme.id] || [];
  if (!score) {
    return `<p class="source-note theme-note">Has not addressed ${escapeHtml(theme.label)} in the current index.</p>`;
  }
  return `
    <h3 class="section-title">On ${escapeHtml(theme.label)}</h3>
    <div class="stat-grid">
      <div class="stat"><span>Theme speeches</span><strong>${fmtInt(score.speechCount)}</strong></div>
      <div class="stat"><span>Share</span><strong>${escapeHtml(fmtShare(score.share))}</strong></div>
      <div class="stat"><span>First mention</span><strong>${escapeHtml(score.firstDate || "n/a")}</strong></div>
    </div>
    ${renderExcerptList(excerpts)}
  `;
}

function renderPoliticianDetail(personId) {
  const person = politiciansById.get(personId);
  if (!person) {
    return `<div class="detail-body"><p class="source-note">No politician selected.</p></div>`;
  }

  const party = partyMap.get(person.party);
  const phrases = data.phrasesByPolitician[person.id] || { content: {}, markers: {}, tfidf: {} };
  const contentRows = phrases.content?.[state.ngram] || [];
  const tfidfRows = phrases.tfidf?.[state.ngram] || [];
  const markers = phrases.markers || {};
  const markerCategory = markerTabs(markers);
  const markerRows = markerCategory ? markers[state.markerCategory] || [] : [];
  const partyPhrases = data.partyPhrases[person.party] || { common: {}, distinctive: {} };

  return `
    <div class="detail-body">
      <div class="panel-control">
        ${ngramSelect("politicianPanelNgram")}
      </div>
      <div class="detail-header">
        <div class="person-title-row">
          <h2>${escapeHtml(person.name)}</h2>
          <span class="party-pill">
            <span class="swatch" style="background:${partyColor(person.party)}"></span>
            ${escapeHtml(party?.label || person.party)}
          </span>
        </div>
        <div class="stat-grid">
          <div class="stat"><span>Speeches</span><strong>${fmtInt(person.speechCount)}</strong></div>
          <div class="stat"><span>Tokens</span><strong>${fmtInt(person.surfaceTokenCount)}</strong></div>
          <div class="stat"><span>Sources</span><strong>${fmtInt(person.sourcePathCount)}</strong></div>
        </div>
        <p class="source-note">Party assignment: ${escapeHtml(person.partySource)}</p>
      </div>
      ${renderThemeLensNote(person)}

      <h3 class="section-title">TF-IDF phrases</h3>
      ${phraseList(tfidfRows, {
        metric: "tf_idf_vs_rest",
        scoreLabel: "tf_idf_vs_rest",
        scoreDigits: 4,
      })}

      <h3 class="section-title">Top content phrases</h3>
      ${phraseList(contentRows)}

      <h3 class="section-title">Speech markers</h3>
      ${markerCategory}
      ${renderMarkerRate(phrases, state.markerCategory)}
      <p class="source-note">${escapeHtml(markerHelp[state.markerCategory] || "")}</p>
      ${phraseList(markerRows)}

      <h3 class="section-title">Party common phrases</h3>
      ${phraseList(partyPhrases.common?.[state.ngram] || [])}

      <h3 class="section-title">Party-distinctive phrases</h3>
      ${phraseList(partyPhrases.distinctive?.[state.ngram] || [], {
        metric: "log_odds_vs_rest",
        scoreLabel: "log_odds_vs_rest",
      })}
    </div>
  `;
}

function partyOptions(selectedParty) {
  return data.parties
    .filter((party) => party.politicianCount > 0)
    .map(
      (party) =>
        `<option value="${escapeHtml(party.id)}" ${party.id === selectedParty ? "selected" : ""}>${escapeHtml(party.label)}</option>`,
    )
    .join("");
}

function renderThemeChart(themeId) {
  const series = data.partyThemeSeries?.[themeId] || {};
  const weeks = [...new Set(Object.values(series).flatMap((rows) => rows.map((row) => row.week)))].sort();
  if (weeks.length < 2) {
    return `<p class="source-note">Too few occurrences for a trajectory.</p>`;
  }
  const width = 320;
  const height = 140;
  const pad = 16;
  const parties = partyOrder.filter((party) => series[party]?.length);
  const pointsFor = (party) =>
    weeks.map((week, index) => {
      const row = (series[party] || []).find((item) => item.week === week);
      const x = pad + (index / Math.max(1, weeks.length - 1)) * (width - pad * 2);
      const y = height - pad - Number(row?.share || 0) * (height - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
  return `
    <svg class="theme-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Weekly party share">
      ${parties
        .map(
          (party) => `
            <polyline
              fill="none"
              stroke="${partyColor(party)}"
              stroke-width="2"
              points="${pointsFor(party).join(" ")}"
            ></polyline>
          `,
        )
        .join("")}
    </svg>
  `;
}

function renderOwnership(themeId) {
  const rows = data.themeOwnership?.[themeId] || [];
  if (!rows.length) {
    return `<p class="source-note">No ownership scores for this theme.</p>`;
  }
  const maxLift = Math.max(1, ...rows.map((row) => Number(row.lift || 0)));
  return `
    <div class="ownership-list">
      ${rows
        .map((row) => {
          const lift = Number(row.lift || 0);
          const width = Math.max(6, (lift / maxLift) * 100);
          return `
            <div class="ownership-row">
              <div class="language-bar-label">
                <span>${escapeHtml(partyLabel(row.party))}</span>
                <strong>${lift.toFixed(2)}x</strong>
              </div>
              <div class="ownership-track">
                <span class="ownership-fill" style="width:${width.toFixed(1)}%; background:${partyColor(row.party)}"></span>
              </div>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderThemePanel() {
  const theme = selectedTheme();
  if (!theme) {
    return `<div class="detail-body"><p class="source-note">Choose a theme to open the lens.</p></div>`;
  }
  return `
    <div class="detail-body">
      <div class="panel-title-row">
        <h2>${escapeHtml(theme.label)}</h2>
        <span class="party-pill">${theme.type === "emerging" ? "Signal" : "Domain"}</span>
      </div>
      <div class="stat-grid">
        <div class="stat"><span>Speeches</span><strong>${fmtInt(theme.speechCount)}</strong></div>
        <div class="stat"><span>Politicians</span><strong>${fmtInt(theme.politicianCount)}</strong></div>
        <div class="stat"><span>Opened by</span><strong>${escapeHtml(partyLabel(theme.openerParty) || "n/a")}</strong></div>
      </div>
      <p class="source-note">${escapeHtml(trendLabel(theme.trend))} · first ${escapeHtml(theme.firstDate || "n/a")}</p>
      <h3 class="section-title">Trajectory</h3>
      ${renderThemeChart(theme.id)}
      <h3 class="section-title">Who over-invests</h3>
      ${renderOwnership(theme.id)}
      <h3 class="section-title">Excerpts</h3>
      ${renderExcerptList(data.themeExcerpts?.[theme.id] || [])}
    </div>
  `;
}

function renderPartyPanel() {
  const selected = state.selectedParty === "ALL" ? selectedPolitician()?.party : state.selectedParty;
  const partyId = selected || "LFI_NFP";
  const party = partyMap.get(partyId);
  const phrases = data.partyPhrases[partyId] || { common: {}, distinctive: {} };
  const languageRow = languageRowForDashboardParty(partyId);

  return `
    <div class="detail-body">
      <div class="panel-control">
        <label class="field">
          <span>Party</span>
          <select id="partyPanelSelect">${partyOptions(partyId)}</select>
        </label>
        <label class="field">
          <span>N-gram</span>
          <select id="partyPanelNgram">
            <option value="1" ${state.ngram === "1" ? "selected" : ""}>Unigrams</option>
            <option value="2" ${state.ngram === "2" ? "selected" : ""}>Bigrams</option>
            <option value="3" ${state.ngram === "3" ? "selected" : ""}>Trigrams</option>
            <option value="4" ${state.ngram === "4" ? "selected" : ""}>Four-grams</option>
          </select>
        </label>
      </div>
      <div class="panel-title-row">
        <h2>${escapeHtml(party?.label || partyId)}</h2>
        <span class="party-pill">
          <span class="swatch" style="background:${partyColor(partyId)}"></span>
          ${escapeHtml(party?.family || "")}
        </span>
      </div>
      <div class="stat-grid">
        <div class="stat"><span>Politicians</span><strong>${fmtInt(party?.politicianCount)}</strong></div>
        <div class="stat"><span>Speeches</span><strong>${fmtInt(party?.speechCount)}</strong></div>
        <div class="stat"><span>Tokens</span><strong>${fmtInt(party?.analysisTokenCount)}</strong></div>
      </div>
      ${renderPartyLanguageProfile(languageRow)}
      <div class="two-column">
        <section>
          <h3 class="section-title">Common phrases</h3>
          ${phraseList(phrases.common?.[state.ngram] || [])}
        </section>
        <section>
          <h3 class="section-title">Distinctive phrases</h3>
          ${phraseList(phrases.distinctive?.[state.ngram] || [], {
            metric: "log_odds_vs_rest",
            scoreLabel: "log_odds_vs_rest",
          })}
        </section>
      </div>
    </div>
  `;
}

function renderLanguageMarkersPanel() {
  const rows = languageRowsForMetric(state.languageMetric);
  const metric = languageMetric(state.languageMetric);
  const summary = languageMarkers.summary?.[state.languageMetric] || {};
  const highest = rows[0];
  const lowest = rows[rows.length - 1];

  return `
    <div class="detail-body language-dashboard">
      <div class="panel-control marker-control">
        ${renderLanguageMetricSelect()}
      </div>
      <h2>Language markers</h2>
      <div class="stat-grid">
        <div class="stat"><span>Parties</span><strong>${fmtInt(languageMarkers.partyRows?.length || 0)}</strong></div>
        <div class="stat"><span>Highest ${escapeHtml(metric.shortLabel)}</span><strong>${escapeHtml(
          highest ? fmtLanguageValue(state.languageMetric, languageValue(highest, state.languageMetric)) : "n/a",
        )}</strong></div>
        <div class="stat"><span>Mean ${escapeHtml(metric.shortLabel)}</span><strong>${escapeHtml(
          summary.mean === undefined ? "n/a" : fmtLanguageValue(state.languageMetric, summary.mean),
        )}</strong></div>
      </div>

      <h3 class="section-title">${escapeHtml(metric.label)}</h3>
      <p class="source-note">${escapeHtml(metric.description || "")}</p>
      ${renderLanguageMetricChart(state.languageMetric)}

      <h3 class="section-title">Pronoun distribution</h3>
      ${renderPronounDistribution()}

      <h3 class="section-title">Lexical measures</h3>
      ${renderLanguageMatrix()}

      <p class="source-note section-title">Data source</p>
      <p class="source-note">${escapeHtml(languageMarkers.source || data.meta.sources.languageMarkers || "")}</p>
      <p class="source-note">${escapeHtml(lowest ? `Lowest ${metric.shortLabel}: ${lowest.party}` : "")}</p>
    </div>
  `;
}

function renderCorpusPanel() {
  const globalRows = data.globalPhrases?.[state.ngram] || [];
  const rankedParties = [...data.parties]
    .filter((party) => party.analysisTokenCount > 0)
    .sort((a, b) => b.analysisTokenCount - a.analysisTokenCount);
  const maxTokens = Math.max(1, ...rankedParties.map((party) => party.analysisTokenCount));

  return `
    <div class="detail-body">
      <div class="panel-control">
        <label class="field">
          <span>N-gram</span>
          <select id="corpusPanelNgram">
            <option value="1" ${state.ngram === "1" ? "selected" : ""}>Unigrams</option>
            <option value="2" ${state.ngram === "2" ? "selected" : ""}>Bigrams</option>
            <option value="3" ${state.ngram === "3" ? "selected" : ""}>Trigrams</option>
            <option value="4" ${state.ngram === "4" ? "selected" : ""}>Four-grams</option>
          </select>
        </label>
      </div>
      <h2>Corpus</h2>
      <div class="stat-grid">
        <div class="stat"><span>Speeches</span><strong>${fmtInt(data.meta.totalSpeeches)}</strong></div>
        <div class="stat"><span>Surface tokens</span><strong>${fmtInt(data.meta.totalSurfaceTokens)}</strong></div>
        <div class="stat"><span>Content tokens</span><strong>${fmtInt(data.meta.totalAnalysisTokens)}</strong></div>
      </div>

      <h3 class="section-title">Global common phrases</h3>
      ${phraseList(globalRows)}

      <h3 class="section-title">Party volume</h3>
      <div class="phrase-list">
        ${rankedParties
          .map((party) => {
            const width = Math.max(4, (party.analysisTokenCount / maxTokens) * 100);
            return `
              <div class="phrase-row">
                <div class="phrase-track">
                  <span class="phrase-bar" style="width:${width.toFixed(1)}%; background:${party.color}22"></span>
                  <span class="phrase-text">${escapeHtml(party.label)}</span>
                </div>
                <span class="phrase-count">${fmtCompact(party.analysisTokenCount)}</span>
              </div>
            `;
          })
          .join("")}
      </div>
      <p class="source-note section-title">Data sources</p>
      <p class="source-note">${Object.values(data.meta.sources).filter(Boolean).map(escapeHtml).join("<br />")}</p>
    </div>
  `;
}

function renderMarkerRate(phrases, category) {
  if (category !== "address" && category !== "negation") {
    return "";
  }
  const rate = phrases.markerRates?.[category];
  const count = phrases.markerCounts?.[category] || 0;
  if (rate === undefined) {
    return "";
  }
  return `
    <div class="stat-grid">
      <div class="stat"><span>Per 1,000 words</span><strong>${Number(rate).toFixed(1)}</strong></div>
      <div class="stat"><span>Hits</span><strong>${fmtInt(count)}</strong></div>
    </div>
  `;
}

function topicColor(topicId) {
  return topicPalette[Number(topicId) % topicPalette.length];
}

function renderTopicChart(months, lines) {
  if (!months.length || !lines.length) {
    return `<p class="source-note">No monthly series for this party.</p>`;
  }
  const width = 640;
  const height = 240;
  const pad = { top: 16, right: 12, bottom: 36, left: 42 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const maxValue = Math.max(0.05, ...lines.flatMap((line) => line.values));
  const xAt = (index) => pad.left + (months.length === 1 ? innerW / 2 : (index / (months.length - 1)) * innerW);
  const yAt = (value) => pad.top + innerH - (value / maxValue) * innerH;
  const visibleLines = lines.filter((line) => !state.isolatedTopicId || line.id === state.isolatedTopicId);
  const grid = [0, 0.25, 0.5, 0.75, 1].map((fraction) => {
    const value = maxValue * fraction;
    const y = yAt(value);
    return `<line class="topic-chart-grid" x1="${pad.left}" x2="${width - pad.right}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"></line>
      <text class="topic-chart-axis" x="8" y="${(y + 4).toFixed(1)}">${Math.round(value * 100)}%</text>`;
  });
  const xLabels = months.map((month, index) => {
    if (index !== 0 && index !== months.length - 1 && index % Math.ceil(months.length / 6) !== 0) {
      return "";
    }
    return `<text class="topic-chart-axis" x="${xAt(index).toFixed(1)}" y="${height - 10}" text-anchor="middle">${escapeHtml(month)}</text>`;
  });
  const paths = visibleLines.map((line) => {
    const d = line.values
      .map((value, index) => `${index === 0 ? "M" : "L"} ${xAt(index).toFixed(1)} ${yAt(value).toFixed(1)}`)
      .join(" ");
    return `<path class="topic-chart-line" d="${d}" stroke="${line.color}"></path>`;
  });
  return `
    <svg class="topic-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Theme share over time">
      ${grid.join("")}
      ${paths.join("")}
      ${xLabels.join("")}
    </svg>
  `;
}

function renderThemesPanel() {
  const bundle = data.topics;
  if (!bundle || !bundle.topics?.length) {
    return `
      <div class="detail-body">
        <h2>Themes</h2>
        <p class="source-note">Topic data is missing. Run analyze_topics.py then dashboard/build_dashboard_data.py.</p>
      </div>
    `;
  }

  const selected = state.selectedParty === "ALL" ? selectedPolitician()?.party : state.selectedParty;
  const partyId = selected || "LFI_NFP";
  const partyTopics = [...(bundle.byParty?.[partyId] || [])].sort((a, b) => b.share - a.share);
  const topTopics = partyTopics.slice(0, 5);
  const topIds = new Set(topTopics.map((topic) => String(topic.id)));
  const months = bundle.months || [];
  const series = bundle.series?.[partyId] || {};

  const lines = topTopics.map((topic) => ({
    id: String(topic.id),
    label: topic.label,
    color: topicColor(topic.id),
    values: months.map((month) => Number(series[String(topic.id)]?.[month] || 0)),
  }));
  if (partyTopics.length > 5) {
    lines.push({
      id: "other",
      label: "Other themes",
      color: "#9aa1aa",
      values: months.map((month) => {
        let rest = 0;
        Object.entries(series).forEach(([topicId, monthMap]) => {
          if (!topIds.has(topicId)) {
            rest += Number(monthMap[month] || 0);
          }
        });
        return rest;
      }),
    });
  }

  return `
    <div class="detail-body">
      <div class="panel-control">
        <label class="field">
          <span>Party</span>
          <select id="themesPartySelect">${partyOptions(partyId)}</select>
        </label>
      </div>
      <h2>Themes</h2>
      <p class="source-note">Lexical fields from TF-IDF + NMF on individual speeches. Shares are the percentage of that party's speeches assigned to each theme.</p>
      <div class="panel-title-row">
        <h3 class="section-title">${escapeHtml(partyLabel(partyId))}</h3>
      </div>
      ${renderTopicChart(months, lines)}
      <div class="topic-legend">
        ${lines
          .map((line) => {
            const isolated = state.isolatedTopicId;
            const dimmed = isolated && isolated !== line.id;
            const active = isolated === line.id;
            return `
              <button class="topic-legend-item${active ? " is-active" : ""}${dimmed ? " is-dimmed" : ""}" type="button" data-topic-id="${escapeHtml(line.id)}">
                <span class="swatch" style="background:${line.color}"></span>
                ${escapeHtml(line.label.split(",")[0])}
              </button>
            `;
          })
          .join("")}
      </div>
      <h3 class="section-title">Party lexical fields</h3>
      ${phraseList(
        partyTopics.map((topic) => ({
          ngram: `${topic.label} · ${topic.terms.slice(0, 6).join(", ")}`,
          count: topic.share,
          share_pct: (topic.share || 0) * 100,
        })),
        { metric: "count", scoreLabel: "share_pct", scoreDigits: 1 },
      )}
      <p class="source-note">${escapeHtml(bundle.source || "")}</p>
    </div>
  `;
}

function renderAnalysis() {
  if (state.activeTab === "theme") {
    analysisContent.innerHTML = renderThemePanel();
  } else if (state.activeTab === "party") {
    analysisContent.innerHTML = renderPartyPanel();
  } else if (state.activeTab === "markers") {
    analysisContent.innerHTML = renderLanguageMarkersPanel();
  } else if (state.activeTab === "corpus") {
    analysisContent.innerHTML = renderCorpusPanel();
  } else if (state.activeTab === "themes") {
    analysisContent.innerHTML = renderThemesPanel();
  } else {
    analysisContent.innerHTML = renderPoliticianDetail(state.selectedId);
  }
}

function renderDialog() {
  const person = selectedPolitician();
  if (!person) {
    return;
  }
  dialogTitle.textContent = person.name;
  dialogContent.innerHTML = renderPoliticianDetail(person.id);
}

function render() {
  syncControls();
  renderSearchResults();
  renderChamber();
  renderAnalysis();
  if (dialog.open) {
    renderDialog();
  }
}

function selectTheme(themeId) {
  state.themeId = themeId || "";
  state.themeQuery = "";
  state.themeMenuOpen = false;
  state.activeTab = state.themeId ? "theme" : "politician";
  render();
}

function selectPolitician(personId, openDialog = false) {
  const person = politiciansById.get(personId);
  if (!person) {
    return;
  }
  state.selectedId = person.id;
  state.selectedParty = person.party;
  if (person.party === "UNLABELED") {
    state.showUnlabeled = true;
  }
  state.activeTab = "politician";
  render();
  if (openDialog) {
    renderDialog();
    dialog.showModal();
  }
}

document.querySelectorAll("[data-seat-metric]").forEach((button) => {
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    setSeatMetric(button.dataset.seatMetric);
  });
});

document.body.addEventListener("click", (event) => {
  const tab = event.target.closest("[data-tab]");
  if (tab) {
    state.activeTab = tab.dataset.tab;
    render();
    return;
  }

  const markerButton = event.target.closest("[data-marker-category]");
  if (markerButton) {
    state.markerCategory = markerButton.dataset.markerCategory;
    render();
    return;
  }

  const topicButton = event.target.closest("[data-topic-id]");
  if (topicButton) {
    const topicId = topicButton.dataset.topicId;
    state.isolatedTopicId = state.isolatedTopicId === topicId ? null : topicId;
    render();
    return;
  }

  const personButton = event.target.closest("[data-select-politician]");
  if (personButton) {
    selectPolitician(personButton.dataset.selectPolitician, true);
    return;
  }

  const partyButton = event.target.closest("[data-party-filter]");
  if (partyButton) {
    state.partyFilter = partyButton.dataset.partyFilter;
    state.selectedParty = state.partyFilter;
    state.activeTab = "party";
    render();
    return;
  }

  const themeButton = event.target.closest("[data-theme-id]");
  if (themeButton) {
    selectTheme(themeButton.dataset.themeId);
    return;
  }

  if (event.target.closest("[data-clear-theme]")) {
    selectTheme("");
  }
});

chamberSvg.addEventListener("click", (event) => {
  const dot = event.target.closest("[data-politician-id]");
  if (dot) {
    selectPolitician(dot.dataset.politicianId, true);
  }
});

chamberSvg.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") {
    return;
  }
  const dot = event.target.closest("[data-politician-id]");
  if (dot) {
    event.preventDefault();
    selectPolitician(dot.dataset.politicianId, true);
  }
});

partyFilter.addEventListener("change", () => {
  state.partyFilter = partyFilter.value;
  if (state.partyFilter !== "ALL") {
    state.selectedParty = state.partyFilter;
    state.activeTab = "party";
  }
  render();
});

searchInput.addEventListener("input", () => {
  state.search = searchInput.value;
  render();
});

themeSearch.addEventListener("focus", () => {
  state.themeMenuOpen = true;
  state.themeQuery = selectedTheme() ? "" : themeSearch.value;
  render();
});

themeSearch.addEventListener("input", () => {
  state.themeQuery = themeSearch.value;
  state.themeMenuOpen = true;
  render();
});

document.addEventListener("click", (event) => {
  if (!event.target.closest(".theme-field")) {
    if (state.themeMenuOpen) {
      state.themeMenuOpen = false;
      render();
    }
  }
});

showUnlabeled.addEventListener("change", () => {
  state.showUnlabeled = showUnlabeled.checked;
  render();
});

analysisContent.addEventListener("change", (event) => {
  if (event.target.id === "partyPanelSelect") {
    state.selectedParty = event.target.value;
    render();
  }
  if (event.target.id === "themesPartySelect") {
    state.selectedParty = event.target.value;
    state.isolatedTopicId = null;
    render();
  }
  if (
    event.target.id === "partyPanelNgram" ||
    event.target.id === "corpusPanelNgram" ||
    event.target.id === "politicianPanelNgram"
  ) {
    state.ngram = event.target.value;
    render();
  }
  if (event.target.id === "languageMetricSelect") {
    state.languageMetric = event.target.value;
    render();
  }
});

dialog.addEventListener("click", (event) => {
  if (event.target === dialog) {
    dialog.close();
  }
});

document.getElementById("closeDialog").addEventListener("click", () => dialog.close());

chooseInitialPolitician();
renderSummary();
populatePartyFilter();
render();
