"use strict";

// Every analysis (a person, a group, a theme, the Assembly for a period) is a
// metered view fetched through PolititiaGate.view(). The page is a pure
// function of `state` and of the views already fetched: each user action
// updates the state, renders what is known, then fetches what is missing under
// one interaction id so the server counts the action once.

const Gate = window.PolititiaGate;

// The server CSP forbids inline style attributes (style-src 'self'). Markup
// carries computed styles in data-style and they are applied through the
// CSSOM, which the policy allows. The observer runs before paint.
function applyDataStyles(root) {
  if (root.nodeType !== 1) {
    return;
  }
  const targets = root.matches("[data-style]") ? [root] : [];
  targets.push(...root.querySelectorAll("[data-style]"));
  for (const element of targets) {
    element.style.cssText = element.dataset.style;
    element.removeAttribute("data-style");
  }
}

new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    mutation.addedNodes.forEach(applyDataStyles);
  }
}).observe(document.body, { childList: true, subtree: true });

const $ = (id) => document.getElementById(id);
const chamberSvg = $("chamberSvg");
const analysisContent = $("analysisContent");
const partyFilter = $("partyFilter");
const searchInput = $("searchInput");
const searchResults = $("searchResults");
const themeSearch = $("themeSearch");
const themeMenu = $("themeMenu");
const themeContext = $("themeContext");
const showOthers = $("showOthers");
const seatScaleNote = $("seatScaleNote");
const periodSelect = $("periodSelect");
const periodCustom = $("periodCustom");
const periodFrom = $("periodFrom");
const periodTo = $("periodTo");
const dialog = $("politicianDialog");
const dialogTitle = $("dialogTitle");
const dialogContent = $("dialogContent");

const TABS = ["themes", "depute", "groupe", "assemblee", "style"];
const OTHER_PARTIES = new Set(["GOUV", "UNLABELED"]);
const METHOD_URL = "/methode";

const state = {
  mode: "citizen",
  tab: "themes",
  selectedId: null,
  partyId: null,
  partyFilter: "ALL",
  themeId: "",
  themeQuery: "",
  themeMenuOpen: false,
  search: "",
  showOthers: false,
  seatMetric: "words",
  ngram: "auto",
  markerCategory: null,
  languageMetric: "LD",
  period: { preset: "all", from: "", to: "" },
};

let data = null;
let partyMap = new Map();
let politiciansById = new Map();
let themeMap = new Map();
let languageMetricMap = new Map();
const views = new Map();
const viewStatus = new Map();

// ---------------------------------------------------------------- formatting

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function fmtInt(value) {
  return Number(value || 0).toLocaleString("fr-FR");
}

function fmtCompact(value) {
  return Intl.NumberFormat("fr-FR", { notation: "compact", maximumFractionDigits: 1 }).format(Number(value || 0));
}

function fmtPct(value, digits = 0) {
  const pct = Number(value || 0) * 100;
  return `${pct.toLocaleString("fr-FR", { maximumFractionDigits: digits, minimumFractionDigits: 0 })}\u202f%`;
}

function fmtDate(iso) {
  if (!iso) {
    return "";
  }
  const date = new Date(`${iso}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
}

function fmtMonth(ym) {
  const [year, month] = String(ym || "").split("-").map(Number);
  if (!year || !month) {
    return ym || "";
  }
  return new Date(year, month - 1, 15).toLocaleDateString("fr-FR", { month: "short", year: "numeric" });
}

function fmtRatio(value) {
  const ratio = Number(value || 0);
  if (!Number.isFinite(ratio) || ratio <= 0) {
    return "";
  }
  return `×${ratio >= 10 ? Math.round(ratio) : ratio.toLocaleString("fr-FR", { maximumFractionDigits: 1 })}`;
}

function plural(count, singular, pluralForm) {
  return `${fmtInt(count)} ${Math.abs(Number(count)) > 1 ? pluralForm : singular}`;
}

function capitalize(text) {
  const value = String(text || "");
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function isScientific() {
  return state.mode === "scientific";
}

function infoTip(text) {
  if (!text) {
    return "";
  }
  return `
    <button class="info-tip" type="button" aria-label="Plus d'informations">
      <span aria-hidden="true">?</span>
      <span class="info-tip-bubble">${escapeHtml(text)}</span>
    </button>`;
}

function sectionTitle(text, help = "", tag = "h3") {
  return `<${tag} class="section-title">${escapeHtml(text)}${infoTip(help)}</${tag}>`;
}

function note(text, extraClass = "") {
  return `<p class="source-note ${extraClass}">${escapeHtml(text)}</p>`;
}

// ---------------------------------------------------------------- catalog

function partyLabel(partyId) {
  return partyMap.get(partyId)?.label || partyId || "";
}

function partyColor(partyId) {
  return partyMap.get(partyId)?.color || "#8f969e";
}

function partyPill(partyId) {
  const party = partyMap.get(partyId);
  return `
    <span class="party-pill" title="${escapeHtml(party?.name || "")}">
      <span class="swatch" data-style="background:${partyColor(partyId)}"></span>
      ${escapeHtml(partyLabel(partyId))}
    </span>`;
}

function themeLabel(themeId) {
  return themeMap.get(themeId)?.label || themeId || "";
}

function catalogDomains() {
  return (data?.analytics?.themes || []).filter((theme) => theme.type === "domain");
}

function childThemes(domainId) {
  return (data?.analytics?.themes || []).filter(
    (theme) => theme.type === "theme" && theme.parent === domainId && theme.id !== domainId,
  );
}

function isOtherParty(partyId) {
  return OTHER_PARTIES.has(partyId);
}

function partyVisible(partyId) {
  return state.showOthers || !isOtherParty(partyId) || state.partyFilter === partyId;
}

// ---------------------------------------------------------------- periods

function corpusMonths() {
  return data?.analytics?.months || [];
}

function shiftMonth(ym, delta) {
  const [year, month] = ym.split("-").map(Number);
  const total = year * 12 + (month - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

function clampMonth(ym) {
  const months = corpusMonths();
  if (!months.length || !ym) {
    return ym;
  }
  if (ym < months[0]) {
    return months[0];
  }
  if (ym > months[months.length - 1]) {
    return months[months.length - 1];
  }
  return ym;
}

function periodPresets() {
  const sessions = data?.analytics?.sessions || [];
  return [
    { id: "all", label: "Toute la législature" },
    { id: "12m", label: "12 derniers mois" },
    { id: "3m", label: "3 derniers mois" },
    ...sessions.map((session) => ({ id: session.id, label: session.label, session })),
    { id: "custom", label: "Période personnalisée…" },
  ];
}

function periodRange() {
  const months = corpusMonths();
  const first = months[0] || "";
  const last = months[months.length - 1] || "";
  const preset = state.period.preset;
  if (preset === "12m" || preset === "3m") {
    return { from: clampMonth(shiftMonth(last, preset === "12m" ? -11 : -2)), to: last };
  }
  if (preset === "custom") {
    return { from: clampMonth(state.period.from || first), to: clampMonth(state.period.to || last) };
  }
  const session = periodPresets().find((option) => option.id === preset)?.session;
  if (session) {
    return { from: clampMonth(session.from.slice(0, 7)), to: clampMonth(session.to.slice(0, 7)) };
  }
  return { from: first, to: last };
}

function isAllPeriod() {
  const { from, to } = periodRange();
  const months = corpusMonths();
  return state.period.preset === "all" || (from === months[0] && to === months[months.length - 1]);
}

function periodLabel() {
  const { from, to } = periodRange();
  const span = from === to ? fmtMonth(from) : `${fmtMonth(from)} – ${fmtMonth(to)}`;
  return state.period.preset === "all" ? `toute la législature (${span})` : span;
}

// ---------------------------------------------------------------- views

function apiPath(base, extra = {}) {
  const params = new URLSearchParams();
  if (!isAllPeriod()) {
    const { from, to } = periodRange();
    params.set("from", from);
    params.set("to", to);
  }
  Object.entries(extra).forEach(([key, value]) => {
    if (value) {
      params.set(key, value);
    }
  });
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

const politicianPath = (id) => apiPath(`/api/politician/${encodeURIComponent(id)}`, { theme: state.themeId });
const partyPath = (id) => apiPath(`/api/party/${encodeURIComponent(id)}`);
const themePath = (id) => apiPath(`/api/theme/${encodeURIComponent(id)}`);
const assemblyPath = () => apiPath("/api/assembly");

function currentPartyId() {
  return state.partyId || (state.partyFilter !== "ALL" ? state.partyFilter : null);
}

function neededPaths() {
  const paths = [];
  if (!isAllPeriod() || state.tab === "assemblee") {
    paths.push(assemblyPath());
  }
  if (state.themeId) {
    paths.push(themePath(state.themeId));
  }
  if (state.selectedId && (state.tab === "depute" || dialog.open)) {
    paths.push(politicianPath(state.selectedId));
  }
  if (state.tab === "groupe" && currentPartyId()) {
    paths.push(partyPath(currentPartyId()));
  }
  return paths;
}

async function load() {
  const missing = neededPaths().filter((path) => !views.has(path) && viewStatus.get(path) !== "loading");
  if (!missing.length) {
    return;
  }
  const interactionId = Gate.newInteractionId();
  missing.forEach((path) => viewStatus.set(path, "loading"));
  render();
  await Promise.all(
    missing.map(async (path) => {
      try {
        views.set(path, await Gate.view(path, { interactionId }));
        viewStatus.delete(path);
      } catch (error) {
        const code = error?.code;
        viewStatus.set(path, code === "quota_exceeded" ? "locked" : code === "not_found" ? "missing" : "error");
        if (!["quota_exceeded", "not_found"].includes(code)) {
          console.error(error);
        }
      }
    }),
  );
  render();
}

function statusBlock(path) {
  const status = viewStatus.get(path);
  if (status === "locked") {
    return `
      <div class="locked-card">
        <p><strong>Vos analyses gratuites sont épuisées.</strong></p>
        <p>La suite reste gratuite : confirmez simplement votre adresse email pour continuer sans limite.</p>
        <button class="gate-submit" type="button" data-open-gate="true">Continuer gratuitement</button>
      </div>`;
  }
  if (status === "missing") {
    return note("Aucune donnée pour cette sélection.");
  }
  if (status === "error") {
    return `${note("Cette analyse n'a pas pu être chargée.")}<button class="gate-secondary" type="button" data-retry="true">Réessayer</button>`;
  }
  return `<p class="source-note loading-note">Chargement de l'analyse…</p>`;
}

// ---------------------------------------------------------------- URL state

function writeUrl() {
  const params = new URLSearchParams();
  if (state.tab !== "themes") {
    params.set("onglet", state.tab);
  }
  if (state.selectedId) {
    params.set("depute", state.selectedId);
  }
  if (state.partyId) {
    params.set("groupe", state.partyId);
  }
  if (state.themeId) {
    params.set("theme", state.themeId);
  }
  if (state.period.preset !== "all") {
    params.set("periode", state.period.preset);
    if (state.period.preset === "custom") {
      const { from, to } = periodRange();
      params.set("du", from);
      params.set("au", to);
    }
  }
  if (isScientific()) {
    params.set("mode", "detaille");
  }
  const query = params.toString();
  window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
}

function readUrl() {
  const params = new URLSearchParams(window.location.search);
  const monthPattern = /^\d{4}-\d{2}$/;
  state.mode = params.get("mode") === "detaille" ? "scientific" : "citizen";
  const tab = params.get("onglet");
  if (TABS.includes(tab) && (tab !== "style" || isScientific())) {
    state.tab = tab;
  }
  const person = params.get("depute");
  if (person && politiciansById.has(person)) {
    state.selectedId = person;
    if (!tab) {
      state.tab = "depute";
    }
  }
  const party = params.get("groupe");
  if (party && partyMap.has(party)) {
    state.partyId = party;
    if (!tab && !person) {
      state.tab = "groupe";
    }
  }
  const theme = params.get("theme");
  if (theme && themeMap.has(theme)) {
    state.themeId = theme;
  }
  const preset = params.get("periode");
  if (preset && periodPresets().some((option) => option.id === preset)) {
    state.period.preset = preset;
    if (preset === "custom") {
      const from = params.get("du");
      const to = params.get("au");
      state.period.from = monthPattern.test(from || "") ? from : "";
      state.period.to = monthPattern.test(to || "") ? to : "";
    }
  }
  const selected = politiciansById.get(state.selectedId);
  if (selected && isOtherParty(selected.party)) {
    state.showOthers = true;
  }
}

// One user action: update the state, then render and fetch.
function commit() {
  writeUrl();
  render();
  load();
}

// ---------------------------------------------------------------- controls

function renderChrome() {
  document.body.dataset.mode = state.mode;
  document.querySelectorAll("[data-audience-mode]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.audienceMode === state.mode);
  });
  document.querySelectorAll(".tab").forEach((tab) => {
    const active = tab.dataset.tab === state.tab;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", active ? "true" : "false");
  });
  document.querySelectorAll("[data-seat-metric]").forEach((button) => {
    const active = button.dataset.seatMetric === state.seatMetric;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
}

function renderPeriodControl() {
  const presets = periodPresets();
  if (periodSelect.options.length !== presets.length) {
    periodSelect.innerHTML = presets
      .map((option) => `<option value="${escapeHtml(option.id)}">${escapeHtml(option.label)}</option>`)
      .join("");
  }
  periodSelect.value = state.period.preset;
  const custom = state.period.preset === "custom";
  periodCustom.hidden = !custom;
  const months = corpusMonths();
  const { from, to } = periodRange();
  [periodFrom, periodTo].forEach((input) => {
    input.min = months[0] || "";
    input.max = months[months.length - 1] || "";
  });
  if (custom) {
    periodFrom.value = from;
    periodTo.value = to;
  }
  periodSelect.title = `Période analysée : ${periodLabel()}`;
}

function populatePartyFilter() {
  const options = [
    `<option value="ALL">Tous les groupes</option>`,
    ...data.parties
      .filter((party) => party.politicianCount > 0 && (state.showOthers || !isOtherParty(party.id)))
      .map(
        (party) =>
          `<option value="${escapeHtml(party.id)}">${escapeHtml(party.label)} (${fmtInt(party.politicianCount)})</option>`,
      ),
  ];
  partyFilter.innerHTML = options.join("");
  partyFilter.value = state.partyFilter;
  if (partyFilter.value !== state.partyFilter) {
    state.partyFilter = "ALL";
    partyFilter.value = "ALL";
  }
}

function matchingThemes(domain) {
  const term = normalize(state.themeQuery.trim());
  const children = childThemes(domain.id);
  if (!term) {
    return { domainMatches: true, children };
  }
  const matches = (theme) => normalize(`${theme.label} ${theme.committee || ""}`).includes(term);
  return { domainMatches: matches(domain), children: children.filter(matches) };
}

function renderThemeMenu() {
  if (!state.themeMenuOpen) {
    themeMenu.hidden = true;
    themeMenu.innerHTML = "";
    return;
  }
  const sections = [
    `<button class="theme-option ${state.themeId ? "" : "is-active"}" type="button" data-theme-id="">Tous les thèmes</button>`,
  ];
  catalogDomains().forEach((domain) => {
    const { domainMatches, children } = matchingThemes(domain);
    if (!domainMatches && !children.length) {
      return;
    }
    sections.push(`
      <button class="theme-option theme-option-domain ${domain.id === state.themeId ? "is-active" : ""}" type="button" data-theme-id="${escapeHtml(domain.id)}">
        ${escapeHtml(domain.label)}
        <small>Tout le domaine</small>
      </button>`);
    children.forEach((theme) => {
      sections.push(`
        <button class="theme-option theme-option-child ${theme.id === state.themeId ? "is-active" : ""}" type="button" data-theme-id="${escapeHtml(theme.id)}">
          ${escapeHtml(theme.label)}
        </button>`);
    });
  });
  if (sections.length === 1) {
    sections.push(note("Aucun thème ne correspond.", "theme-option-label"));
  }
  themeMenu.innerHTML = sections.join("");
  themeMenu.hidden = false;
}

function renderThemeContext() {
  if (!state.themeId) {
    themeContext.hidden = true;
    themeContext.innerHTML = "";
    return;
  }
  const view = views.get(themePath(state.themeId));
  const meta = view
    ? `${plural(view.stats.politicians, "personne en a parlé", "personnes en ont parlé")} · ${plural(view.stats.speeches, "intervention", "interventions")} sur ${escapeHtml(periodLabel())}`
    : "Chargement…";
  themeContext.hidden = false;
  themeContext.innerHTML = `
    <span class="theme-chip">
      ${escapeHtml(themeLabel(state.themeId))}
      <button type="button" data-theme-id="" aria-label="Retirer le thème">×</button>
    </span>
    <span class="theme-context-meta">${meta}. Les sièges vides n'ont pas abordé ce thème.</span>`;
}

function syncControls() {
  renderChrome();
  renderPeriodControl();
  populatePartyFilter();
  searchInput.value = state.search;
  const theme = themeMap.get(state.themeId);
  themeSearch.value = theme && !state.themeMenuOpen ? theme.label : state.themeQuery;
  themeSearch.placeholder = theme ? theme.label : "Tous les thèmes";
  showOthers.checked = state.showOthers;
  renderThemeMenu();
  renderThemeContext();
}

function renderSummary() {
  const assembly = views.get(assemblyPath());
  const metrics = assembly
    ? [
        ["Interventions", fmtCompact(assembly.totals.speeches)],
        ["Mots prononcés", fmtCompact(assembly.totals.words)],
        ["Séances", fmtInt(assembly.totals.sittings)],
        ["Scrutins", fmtInt(assembly.totals.votes)],
      ]
    : [
        ["Députés", fmtInt(data.meta.deputies)],
        ["Interventions", fmtCompact(data.meta.totalSpeeches)],
        ["Mots prononcés", fmtCompact(data.meta.totalWords)],
        ["Groupes", fmtInt(data.parties.filter((party) => party.politicianCount > 0 && !isOtherParty(party.id)).length)],
      ];
  $("summaryStrip").innerHTML = `
    ${metrics
      .map(
        ([label, value]) => `
          <div class="metric">
            <span class="metric-value">${escapeHtml(value)}</span>
            <span class="metric-label">${escapeHtml(label)}</span>
          </div>`,
      )
      .join("")}
    <p class="summary-period">Période : ${escapeHtml(periodLabel())}</p>`;
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
    .sort((a, b) => (b.words || 0) - (a.words || 0))
    .slice(0, 10);
  searchResults.classList.add("is-visible");
  searchResults.innerHTML = matches.length
    ? matches
        .map(
          (person) => `
            <button class="result-button" type="button" data-select-politician="${escapeHtml(person.id)}">
              ${escapeHtml(person.name)} · ${escapeHtml(partyLabel(person.party))}
            </button>`,
        )
        .join("")
    : note("Aucun résultat");
}

// ---------------------------------------------------------------- hemicycle

const SEAT_ROW_RADII = [116, 169, 222, 275, 328, 381, 434, 486];
const SEAT_RADIUS_MIN = 2.6;
const SEAT_RADIUS_MAX = 14.5;
const SEAT_SCALE_PERCENTILE = 0.9;
const honorifics = new Set(["m", "mme", "mlle", "mr", "dr"]);

function shortPoliticianName(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  let index = 0;
  while (index < parts.length && honorifics.has(normalize(parts[index]).replace(/\./g, ""))) {
    index += 1;
  }
  const rest = parts.slice(index);
  if (!rest.length) {
    return String(name || "").trim();
  }
  if (rest.length === 1) {
    return rest[0];
  }
  return `${(Array.from(rest[0])[0] || "").toUpperCase()}. ${rest.slice(1).join(" ")}`;
}

function getVisiblePoliticians() {
  const term = normalize(state.search.trim());
  return data.politicians.filter((person) => {
    if (state.partyFilter !== "ALL" && person.party !== state.partyFilter) {
      return false;
    }
    if (!partyVisible(person.party)) {
      return false;
    }
    return !term || normalize(person.name).includes(term);
  });
}

function seatStats(person) {
  if (!isAllPeriod()) {
    const assembly = views.get(assemblyPath());
    if (assembly) {
      const row = assembly.chamber?.[person.id];
      return { speeches: row?.[0] || 0, words: row?.[1] || 0, spoke: (row?.[0] || 0) > 0 };
    }
  }
  return { speeches: person.speechCount || 0, words: person.words || 0, spoke: true };
}

function seatMetricValue(person) {
  const stats = seatStats(person);
  return state.seatMetric === "speeches" ? stats.speeches : stats.words;
}

function themeScores() {
  return state.themeId ? views.get(themePath(state.themeId))?.politicianScores || null : null;
}

function buildSectors(visible) {
  const counts = new Map();
  visible.forEach((person) => counts.set(person.party, (counts.get(person.party) || 0) + 1));
  const ordered = data.partyOrder.filter((party) => counts.get(party) > 0);
  const weights = ordered.map((party) => Math.sqrt(counts.get(party)));
  const totalWeight = weights.reduce((sum, value) => sum + value, 0) || 1;
  let cursor = 160;
  const sectors = new Map();
  ordered.forEach((party, index) => {
    const width = (weights[index] / totalWeight) * 140;
    sectors.set(party, { party, count: counts.get(party), start: cursor, end: cursor - width, width, mid: cursor - width / 2 });
    cursor -= width;
  });
  return sectors;
}

function distributeRowCounts(n, radii) {
  if (n <= 0) {
    return radii.map(() => 0);
  }
  const totalWeight = radii.reduce((sum, radius) => sum + radius, 0);
  const exact = radii.map((radius) => (n * radius) / totalWeight);
  const counts = exact.map((value) => Math.floor(value));
  const leftover = n - counts.reduce((sum, count) => sum + count, 0);
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
  return { x: cx + radius * Math.cos(radians), y: cy - radius * Math.sin(radians) };
}

function arcPath(cx, cy, radius, start, end, steps = 48) {
  const points = [];
  for (let index = 0; index <= steps; index += 1) {
    points.push(polarPoint(cx, cy, radius, start + ((end - start) * index) / steps));
  }
  return points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ");
}

function svgEl(name, attrs = {}) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", name);
  Object.entries(attrs).forEach(([key, value]) => element.setAttribute(key, value));
  return element;
}

function quantile(values, p) {
  if (!values.length) {
    return 1;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * p;
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (index - lo);
}

function seatScale() {
  const values = data.politicians.map(seatMetricValue).filter((value) => value > 0);
  return {
    cap: Math.max(1, quantile(values, SEAT_SCALE_PERCENTILE)),
    median: Math.max(1, quantile(values, 0.5)),
  };
}

function seatRadiusForValue(value, scale) {
  const capped = Math.min(Math.max(0, Number(value) || 0), scale.cap);
  return Math.max(SEAT_RADIUS_MIN, SEAT_RADIUS_MAX * Math.sqrt(capped / scale.cap));
}

function seatTooltip(person) {
  const stats = seatStats(person);
  return `${person.name} – ${partyLabel(person.party)} – ${plural(stats.speeches, "intervention", "interventions")} · ${fmtCompact(stats.words)} mots`;
}

function layoutPartySeats(people, sector) {
  const rowCounts = distributeRowCounts(people.length, SEAT_ROW_RADII);
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
    const stagger = count > 1 && rowIndex % 2 === 1 ? 0.4 : 0;
    group.forEach((person, index) => {
      const theta = start + (end - start) * ((index + 0.5 + stagger) / count);
      seats.push({ person, ...polarPoint(500, 585, SEAT_ROW_RADII[rowIndex], theta) });
    });
  }
  return seats;
}

function seatLabelPoint(x, y, extra) {
  const dx = x - 500;
  const dy = y - 585;
  const dist = Math.hypot(dx, dy) || 1;
  return { x: x + (dx / dist) * extra, y: y + (dy / dist) * extra };
}

function renderChamber() {
  const visible = getVisiblePoliticians();
  const sectors = buildSectors(visible);
  const showSeatNames = state.partyFilter !== "ALL";
  chamberSvg.replaceChildren();

  SEAT_ROW_RADII.forEach((radius) => {
    chamberSvg.appendChild(svgEl("path", { d: arcPath(500, 585, radius, 160, 20), class: "grid-arc" }));
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
    if (sector.width > 7 && !showSeatNames) {
      const point = polarPoint(500, 585, 548, sector.mid);
      const label = svgEl("text", { x: point.x.toFixed(1), y: point.y.toFixed(1), class: "party-label" });
      label.textContent = partyLabel(sector.party);
      chamberSvg.appendChild(label);
    }
  });
  chamberSvg.appendChild(svgEl("rect", { x: 416, y: 560, width: 168, height: 48, rx: 8, class: "tribune" }));
  const tribuneText = svgEl("text", { x: 500, y: 590, class: "tribune-text" });
  tribuneText.textContent = "Présidence";
  chamberSvg.appendChild(tribuneText);

  if (!visible.length) {
    const empty = svgEl("text", { x: 500, y: 300, class: "empty-label" });
    empty.textContent = "Aucune correspondance";
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

  const seats = [];
  data.partyOrder.forEach((party) => {
    const people = byParty.get(party);
    const sector = sectors.get(party);
    if (people && sector) {
      people.sort((a, b) => (b.speechCount || 0) - (a.speechCount || 0) || a.name.localeCompare(b.name, "fr"));
      seats.push(...layoutPartySeats(people, sector));
    }
  });

  const scale = seatScale();
  const scores = themeScores();
  const dots = svgEl("g");
  const names = svgEl("g", { class: "seat-names", "aria-hidden": "true" });
  const nameSize = visible.length > 90 ? 6.8 : visible.length > 50 ? 7.6 : visible.length > 28 ? 8.6 : 10;

  seats.forEach(({ person, x, y }) => {
    const stats = seatStats(person);
    const score = scores?.[person.id] || null;
    const muted = (scores && !score) || !stats.spoke;
    const share = Number(score?.share || 0);
    let radius = seatRadiusForValue(seatMetricValue(person), scale);
    if (scores) {
      radius *= score ? 1 + Math.min(0.7, share) : 0.72;
    }
    if (score) {
      dots.appendChild(
        svgEl("circle", {
          cx: x.toFixed(1),
          cy: y.toFixed(1),
          r: (radius + 3.2).toFixed(2),
          fill: partyColor(person.party),
          opacity: 0.22 + Math.min(0.35, share),
          class: "seat-halo",
        }),
      );
    }
    let label = seatTooltip(person);
    if (scores) {
      label += score
        ? ` – sur ce thème : ${plural(score.speechCount, "intervention", "interventions")} (${fmtPct(share)} de sa parole)`
        : " – n'a pas abordé ce thème";
    } else if (!stats.spoke) {
      label += " – aucune intervention sur la période";
    }
    const dot = svgEl("circle", {
      cx: x.toFixed(1),
      cy: y.toFixed(1),
      r: radius.toFixed(2),
      fill: partyColor(person.party),
      class: `seat-dot${person.id === state.selectedId ? " is-selected" : ""}${muted ? " is-muted" : ""}`,
      tabindex: 0,
      role: "button",
      "aria-label": label,
      "data-politician-id": person.id,
    });
    const title = svgEl("title");
    title.textContent = label;
    dot.appendChild(title);
    dots.appendChild(dot);
    if (showSeatNames) {
      const point = seatLabelPoint(x, y, 7 + radius);
      const text = svgEl("text", { x: point.x.toFixed(1), y: point.y.toFixed(1), class: "seat-name", "font-size": String(nameSize) });
      text.textContent = shortPoliticianName(person.name);
      names.appendChild(text);
    }
  });
  chamberSvg.appendChild(dots);
  if (showSeatNames) {
    chamberSvg.appendChild(names);
  }
  renderLegend(byParty);
  renderSeatScaleNote(scale);
}

function renderSeatScaleNote(scale) {
  const isSpeeches = state.seatMetric === "speeches";
  const unit = isSpeeches ? "interventions" : "mots";
  const formatValue = isSpeeches ? fmtInt : fmtCompact;
  const low = Math.max(1, Math.round(scale.cap * 0.1));
  const examples = [
    { value: low, label: formatValue(low) },
    { value: scale.median, label: formatValue(Math.round(scale.median)) },
    { value: scale.cap, label: `${formatValue(Math.round(scale.cap))}+` },
  ];
  const key = examples
    .map((example) => {
      const radius = seatRadiusForValue(example.value, scale);
      const size = Math.ceil(radius * 2 + 4);
      return `
        <span class="seat-size-key-item">
          <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true"><circle cx="${size / 2}" cy="${size / 2}" r="${radius.toFixed(2)}" fill="#5b6575"></circle></svg>
          <span>${escapeHtml(example.label)}</span>
        </span>`;
    })
    .join("");
  seatScaleNote.innerHTML = `
    <span>Chaque cercle est une personne ; sa taille suit le nombre de ${unit} sur ${escapeHtml(periodLabel())}.</span>
    <span class="seat-size-key" aria-label="Légende de taille des sièges">${key}</span>`;
}

function renderLegend(byParty) {
  $("partyLegend").innerHTML = data.partyOrder
    .filter((party) => byParty.has(party))
    .map(
      (party) => `
        <button class="legend-item result-button" type="button" data-select-party="${escapeHtml(party)}" title="${escapeHtml(partyMap.get(party)?.name || "")}">
          <span class="swatch" data-style="background:${partyColor(party)}"></span>
          <span>${escapeHtml(partyLabel(party))} ${fmtInt(byParty.get(party)?.length || 0)}</span>
        </button>`,
    )
    .join("");
}

// ---------------------------------------------------------------- shared blocks

function barList(rows, { empty = "Aucune donnée pour cette sélection.", limit = 0 } = {}) {
  const sorted = [...rows].sort((a, b) => Number(b.value || 0) - Number(a.value || 0));
  const shown = limit ? sorted.slice(0, limit) : sorted;
  if (!shown.length) {
    return note(empty);
  }
  const max = Math.max(Number.EPSILON, ...shown.map((row) => Number(row.value || 0)));
  return `
    <div class="phrase-list">
      ${shown
        .map((row) => {
          const width = Math.max(4, (Number(row.value || 0) / max) * 100);
          const attrs = Object.entries(row.data || {})
            .map(([key, value]) => `data-${key}="${escapeHtml(value)}"`)
            .join(" ");
          const tag = attrs ? "button" : "div";
          const bar = row.color ? `background:${row.color}33` : "";
          return `
            <div class="phrase-row">
              <${tag} class="phrase-track${attrs ? " is-action" : ""}" ${attrs ? `type="button" ${attrs}` : ""} title="${escapeHtml(row.title || row.label)}">
                <span class="phrase-bar" data-style="width:${width.toFixed(1)}%;${bar}"></span>
                <span class="phrase-text">${escapeHtml(row.label)}${row.detail ? `<small class="phrase-detail">${escapeHtml(row.detail)}</small>` : ""}</span>
                ${row.badge ? `<span class="phrase-badge">${escapeHtml(row.badge)}</span>` : ""}
              </${tag}>
              <span class="phrase-count">${escapeHtml(row.display ?? fmtInt(row.value))}</span>
            </div>`;
        })
        .join("")}
    </div>`;
}

const AUTO_NGRAM_SIZES = ["4", "3", "2"];
const AUTO_NGRAM_LIMIT = 15;
// A longer phrase replaces an overlapping shorter one when it carries at least
// half of its occurrences ("direction générale finances publiques" absorbs
// "finances publiques"); otherwise it is a minor variant and is dropped.
const LONGER_PHRASE_SHARE = 0.5;

function containsPhrase(longer, shorter) {
  return ` ${longer} `.includes(` ${shorter} `);
}

function mergeNgramRows(bySize) {
  const candidates = AUTO_NGRAM_SIZES.flatMap((size) =>
    (bySize?.[size] || []).map((row) => ({ ...row, size: Number(size) })),
  ).sort((a, b) => Number(b.count || 0) - Number(a.count || 0) || b.size - a.size);
  const kept = [];
  for (const row of candidates) {
    const overlap = kept.findIndex((other) => containsPhrase(other.ngram, row.ngram) || containsPhrase(row.ngram, other.ngram));
    if (overlap >= 0) {
      const other = kept[overlap];
      if (row.size > other.size && Number(row.count || 0) >= LONGER_PHRASE_SHARE * Number(other.count || 0)) {
        kept[overlap] = row;
      }
      continue;
    }
    if (kept.length < AUTO_NGRAM_LIMIT) {
      kept.push(row);
    }
  }
  return kept.filter(
    (row, index) => !kept.some((other, otherIndex) => otherIndex !== index && other.size > row.size && containsPhrase(other.ngram, row.ngram)),
  );
}

function rowsForNgram(bySize) {
  return state.ngram === "auto" ? mergeNgramRows(bySize) : bySize?.[state.ngram] || [];
}

function ngramSelect() {
  const options = [
    ["auto", "Expressions (2 à 4 mots)"],
    ["1", "1 mot"],
    ["2", "2 mots"],
    ["3", "3 mots"],
    ["4", "4 mots"],
  ];
  return `
    <label class="field ngram-field">
      <span class="field-heading">Groupes de mots${infoTip("« Expressions » mélange les suites de 2 à 4 mots en retirant les doublons (« finances publiques » disparaît si « direction générale des finances publiques » est déjà là). Vous pouvez aussi choisir une longueur précise. Les petits mots (le, de, à…) sont retirés.")}</span>
      <select data-control="ngram">
        ${options.map(([value, label]) => `<option value="${value}" ${state.ngram === value ? "selected" : ""}>${escapeHtml(label)}</option>`).join("")}
      </select>
    </label>`;
}

function phraseRows(rows, withRatio) {
  return rows.map((row) => ({
    label: row.ngram,
    value: row.count,
    badge: withRatio ? fmtRatio(row.ratio) : "",
    detail: isScientific() && row.z ? `z = ${Number(row.z).toFixed(1)}` : "",
    title: withRatio ? `${row.ngram} : ${fmtInt(row.count)} emplois, ${fmtRatio(row.ratio)} plus souvent que la moyenne` : row.ngram,
  }));
}

function wordsBlock(words, who) {
  const distinctive = rowsForNgram(words?.distinctive);
  const common = rowsForNgram(words?.common);
  return `
    <div class="panel-control">${ngramSelect()}</div>
    ${sectionTitle(
      `Ce qui ${who.distinctive}`,
      `Les expressions employées nettement plus que par le reste de l'Assemblée sur la même période, classées par nombre d'emplois. Le badge ×N indique combien de fois plus souvent. Seules les expressions employées au moins 3 fois sont retenues.`,
    )}
    ${barList(phraseRows(distinctive, true), { empty: "Pas assez de texte sur cette période pour dégager des expressions distinctives." })}
    ${sectionTitle(`Expressions les plus fréquentes ${who.common}`, "Les expressions les plus souvent prononcées, qu'elles soient propres à cette sélection ou communes à tous.")}
    ${barList(phraseRows(common, false))}`;
}

const POSITION_LABELS = {
  pour: "Pour",
  contre: "Contre",
  abstention: "Abstention",
  "non-votant": "Non-votant",
  absent: "Absent·e",
};

function positionBadge(position, prefix = "") {
  const key = position || "none";
  const label = POSITION_LABELS[position] || "Sans position majoritaire";
  return `<span class="pos-badge pos-${escapeHtml(key)}">${escapeHtml(prefix)}${escapeHtml(label)}</span>`;
}

function groupChips(groups) {
  const entries = data.partyOrder.filter((party) => groups?.[party]);
  if (!entries.length) {
    return "";
  }
  return `
    <div class="group-chips" aria-label="Position de chaque groupe">
      ${entries
        .map(
          (party) => `
            <span class="group-chip pos-${escapeHtml(groups[party])}" title="${escapeHtml(partyLabel(party))} : ${escapeHtml(POSITION_LABELS[groups[party]] || groups[party])}">
              <span class="swatch" data-style="background:${partyColor(party)}"></span>${escapeHtml(partyLabel(party))}
            </span>`,
        )
        .join("")}
    </div>`;
}

function voteTitle(vote) {
  const title = String(vote.title || "").replace(/\s+/g, " ").trim();
  return title ? `Vote sur ${title}` : `Scrutin n° ${vote.number}`;
}

function voteRow(vote, { person = false, group = false, groups = false } = {}) {
  const result = vote.adopted ? `<span class="vote-result is-adopted">Adopté</span>` : `<span class="vote-result is-rejected">Rejeté</span>`;
  const total = vote.total
    ? `${fmtInt(vote.total.pour)} pour, ${fmtInt(vote.total.contre)} contre, ${fmtInt(vote.total.abstention)} abstentions`
    : "";
  const positions = [];
  if (person) {
    positions.push(positionBadge(vote.position));
    if (vote.groupPosition !== undefined) {
      positions.push(`<span class="vote-group">Son groupe : ${escapeHtml(POSITION_LABELS[vote.groupPosition] || "sans position majoritaire")}</span>`);
    }
    if (vote.deviates) {
      positions.push(`<span class="deviates-flag" title="A voté différemment de la majorité de son groupe">≠ groupe</span>`);
    }
  }
  if (group) {
    positions.push(positionBadge(vote.groupPosition, "Groupe : "));
  }
  return `
    <article class="vote-row">
      <div class="vote-head">
        <span class="vote-date">${escapeHtml(fmtDate(vote.date))}</span>
        ${result}
        ${vote.isKey ? `<span class="vote-key" title="Vote sur l'ensemble d'un texte, motion de censure ou scrutin solennel">Vote clé</span>` : ""}
      </div>
      <p class="vote-title">${escapeHtml(capitalize(voteTitle(vote)))}</p>
      ${vote.dossier ? `<p class="vote-dossier">Dossier : ${escapeHtml(vote.dossier)}</p>` : ""}
      ${positions.length ? `<div class="vote-positions">${positions.join("")}</div>` : ""}
      ${groups ? groupChips(vote.groups) : ""}
      <p class="vote-foot">
        <span>${escapeHtml(total)}</span>
        ${vote.url ? `<a href="${escapeHtml(vote.url)}" target="_blank" rel="noopener">Scrutin n° ${fmtInt(vote.number)} ↗</a>` : ""}
      </p>
    </article>`;
}

function voteList(votes, options = {}, visible = 5) {
  if (!votes?.length) {
    return note(options.empty || "Aucun vote sur cette période.");
  }
  const head = votes.slice(0, visible).map((vote) => voteRow(vote, options)).join("");
  const rest = votes.slice(visible);
  return `
    <div class="vote-list">
      ${head}
      ${
        rest.length
          ? `<details class="more-block"><summary>Voir ${plural(rest.length, "autre vote", "autres votes")}</summary>${rest.map((vote) => voteRow(vote, options)).join("")}</details>`
          : ""
      }
    </div>`;
}

const STANCE_LEVELS = {
  favorable: "Pour",
  "plutot-favorable": "Plutôt pour",
  partage: "Partagé",
  "plutot-defavorable": "Plutôt contre",
  defavorable: "Contre",
  "non-exprime": "Non exprimé",
};

const STANCE_QUOTE_LABELS = { favorable: "Pour", defavorable: "Contre", abstention: "Abstention" };

const STANCE_HELP =
  "Estimation automatique : nous repérons dans les comptes rendus les annonces de vote explicites (« nous voterons ce texte », « je voterai contre »). Les phrases conditionnelles, les souhaits et les questions sont écartés. Sur un échantillon vérifié à la main, 98 % des annonces retenues sont correctes, et 98 % concordent avec le vote réellement exprimé. Lisez toujours la citation.";

function stanceCounts(stance) {
  const parts = [];
  if (stance.favorable) {
    parts.push(plural(stance.favorable, "annonce pour", "annonces pour"));
  }
  if (stance.unfavorable) {
    parts.push(plural(stance.unfavorable, "annonce contre", "annonces contre"));
  }
  if (stance.mixed) {
    parts.push(plural(stance.mixed, "abstention", "abstentions"));
  }
  return parts.join(" · ");
}

function stanceQuote(quote, showSpeaker) {
  return `
    <blockquote class="stance-quote">
      <p>${positionBadge(quote.stance === "defavorable" ? "contre" : quote.stance === "favorable" ? "pour" : "abstention")} « ${escapeHtml(quote.quote)} »</p>
      <footer>
        ${showSpeaker ? `<button class="excerpt-speaker" type="button" data-select-politician="${escapeHtml(quote.politicianId)}">${escapeHtml(quote.speaker)} · ${escapeHtml(partyLabel(quote.party))}</button>` : ""}
        <span>${escapeHtml(fmtDate(quote.date))}${quote.debate ? ` · débat « ${escapeHtml(quote.debate)} »` : ""}</span>
        ${quote.url ? `<a href="${escapeHtml(quote.url)}" target="_blank" rel="noopener">Compte rendu ↗</a>` : ""}
        ${isScientific() ? `<span class="method-tag">${escapeHtml(quote.method === "rule" ? "règle" : quote.method)}</span>` : ""}
      </footer>
    </blockquote>`;
}

function stanceCards(stances, { heading, showSpeaker, empty }) {
  if (!stances?.length) {
    return note(empty);
  }
  return `
    <div class="stance-list">
      ${stances
        .map(
          (stance) => `
            <article class="stance-card">
              <div class="stance-head">
                <span class="stance-level level-${escapeHtml(stance.level)}">${escapeHtml(STANCE_LEVELS[stance.level] || stance.level)}</span>
                <strong>${heading(stance)}</strong>
                <small>${escapeHtml(stanceCounts(stance))}</small>
              </div>
              ${(stance.quotes || []).slice(0, isScientific() ? 3 : 1).map((quote) => stanceQuote(quote, showSpeaker)).join("")}
            </article>`,
        )
        .join("")}
    </div>
    <p class="source-note estimate-note">Estimation automatique à partir des annonces de vote en séance. <a href="${METHOD_URL}#positions">Comment c'est calculé</a></p>`;
}

function renderExcerptList(excerpts, { showSpeaker = true } = {}) {
  if (!excerpts?.length) {
    return note("Aucun extrait pour cette sélection.");
  }
  return `
    <div class="excerpt-list">
      ${excerpts
        .map(
          (excerpt) => `
            <article class="excerpt-card">
              ${showSpeaker ? `<button class="excerpt-speaker" type="button" data-select-politician="${escapeHtml(excerpt.politicianId)}">${escapeHtml(excerpt.speaker)} · ${escapeHtml(partyLabel(excerpt.party))}</button>` : ""}
              <span class="source-note">${escapeHtml(fmtDate(excerpt.date))}${excerpt.debate ? ` · débat « ${escapeHtml(excerpt.debate)} »` : ""}${excerpt.theme ? ` · ${escapeHtml(themeLabel(excerpt.theme))}` : ""}</span>
              <blockquote>${escapeHtml(excerpt.snippet || "")}</blockquote>
              ${excerpt.url ? `<a class="excerpt-link" href="${escapeHtml(excerpt.url)}" target="_blank" rel="noopener">Lire le compte rendu de la séance ↗</a>` : ""}
            </article>`,
        )
        .join("")}
    </div>`;
}

function statGrid(items) {
  return `
    <div class="stat-grid">
      ${items
        .filter(Boolean)
        .map(
          ([label, value, help]) => `
            <div class="stat"${help ? ` title="${escapeHtml(help)}"` : ""}>
              <span>${escapeHtml(label)}</span>
              <strong>${escapeHtml(value)}</strong>
            </div>`,
        )
        .join("")}
    </div>`;
}

function themeRows(themes, { onlyThemes = true } = {}) {
  return (themes || [])
    .filter((row) => !onlyThemes || themeMap.get(row.id)?.type === "theme")
    .map((row) => ({
      label: themeLabel(row.id),
      value: row.speechCount,
      display: row.share !== undefined ? fmtPct(row.share) : fmtInt(row.speechCount),
      title: `${themeLabel(row.id)} : ${plural(row.speechCount, "intervention", "interventions")}`,
      data: { "theme-id": row.id },
    }));
}

function block(title, body, { help = "", id = "" } = {}) {
  return `
    <section class="fiche-block"${id ? ` id="${escapeHtml(id)}"` : ""}>
      ${sectionTitle(title, help, "h3")}
      ${body}
    </section>`;
}

// ---------------------------------------------------------------- deputy

function activitySentence(view) {
  const activity = view.activity || {};
  if (!activity.speeches) {
    return "Aucune intervention en séance publique sur cette période.";
  }
  const parts = [
    `${plural(activity.speeches, "intervention", "interventions")} en séance, au cours de ${plural(activity.sittings, "séance", "séances")}, soit ${fmtCompact(activity.words)} mots.`,
  ];
  if (activity.firstDate && activity.lastDate) {
    parts.push(`Première prise de parole le ${fmtDate(activity.firstDate)}, dernière le ${fmtDate(activity.lastDate)}.`);
  }
  return parts.join(" ");
}

function rolesSentence(view) {
  const roles = view.roles || [];
  if (roles.length < 2) {
    return "";
  }
  return `A parlé successivement comme : ${roles
    .map((role) => `${partyLabel(role.party)} (${plural(role.speeches, "intervention", "interventions")})`)
    .join(", ")}.`;
}

function votesBlock(person, view) {
  const votes = view.votes || {};
  const isMinister = person.party === "GOUV" || (view.roles || []).every((role) => role.party === "GOUV");
  if (!votes.cast) {
    return note(
      isMinister
        ? "Les membres du gouvernement ne prennent pas part aux votes de l'Assemblée."
        : "Aucun vote enregistré sur cette période.",
    );
  }
  const loyalty = votes.comparable ? votes.withGroup / votes.comparable : null;
  const items = [
    ["Votes enregistrés", fmtInt(votes.cast)],
    loyalty !== null
      ? ["Vote comme son groupe", fmtPct(loyalty), `${fmtInt(votes.withGroup)} votes sur ${fmtInt(votes.comparable)} où son groupe avait une position majoritaire`]
      : null,
  ];
  if (!isMinister && votes.keyVotesHeld) {
    items.push([
      "Absent·e aux votes clés",
      `${fmtInt(votes.absentKey)} sur ${fmtInt(votes.keyVotesHeld)}`,
      "Votes clés tenus pendant la période où la personne siégeait, hors motions de censure",
    ]);
  }
  const themeLine =
    state.themeId && votes.themeVotes !== null && votes.themeVotes !== undefined
      ? note(`Dont ${plural(votes.themeVotes, "vote", "votes")} sur des textes du thème « ${themeLabel(state.themeId)} ».`)
      : "";
  return `
    ${statGrid(items)}
    ${themeLine}
    ${
      votes.keyVotesHeld && !isMinister
        ? note("Une absence n'est pas forcément un manque d'assiduité : travaux en commission, mission, délégation de vote non utilisée, congé… Seul le vote exprimé est public.")
        : ""
    }
    <h4 class="sub-title">${state.themeId ? "Ses votes sur ce thème" : "Ses votes sur les textes importants"}</h4>
    ${voteList(votes.list, { person: true, groups: isScientific(), empty: "Aucun vote sur cette sélection." })}
    ${
      votes.deviations?.length
        ? `<h4 class="sub-title">Quand il ou elle a voté autrement que son groupe</h4>${voteList(votes.deviations, { person: true }, 3)}`
        : ""
    }
    ${
      isScientific() && votes.missed?.length
        ? `<h4 class="sub-title">Derniers votes clés manqués</h4>${voteList(votes.missed, {}, 3)}`
        : ""
    }`;
}

function markersBlock(markers) {
  const categories = Object.keys(markers?.markers || {});
  if (!categories.length) {
    return note("Aucun marqueur de style disponible.");
  }
  if (!categories.includes(state.markerCategory)) {
    state.markerCategory = categories[0];
  }
  const labels = { address: "Adresse", procedure: "Séance", stance: "Position", negation: "Négation", pronoun: "Pronoms" };
  const help = {
    address: "Formules d'adresse parlementaire (monsieur le ministre, chers collègues). Taux pour 1 000 mots.",
    negation: "Portée de la négation (ne … pas / jamais / rien / plus).",
    procedure: "Expressions contenant des termes de procédure législative.",
    stance: "Expressions contenant des verbes de position (faut, propose, refuse…).",
    pronoun: "Expressions contenant je / nous / vous.",
  };
  const rate = markers.markerRates?.[state.markerCategory];
  return `
    <div class="subtabs">
      ${categories
        .map(
          (category) => `
            <button class="subtab ${category === state.markerCategory ? "is-active" : ""}" type="button" data-marker-category="${escapeHtml(category)}">
              ${escapeHtml(labels[category] || category)}
            </button>`,
        )
        .join("")}
    </div>
    ${rate !== undefined ? statGrid([["Pour 1 000 mots", Number(rate).toFixed(1)], ["Occurrences", fmtInt(markers.markerCounts?.[state.markerCategory])]]) : ""}
    ${note(help[state.markerCategory] || "")}
    ${barList((markers.markers[state.markerCategory] || []).map((row) => ({ label: row.ngram, value: row.count })))}
    ${note("Calculé sur toute la législature.")}`;
}

function renderPoliticianDetail(personId) {
  const person = politiciansById.get(personId);
  if (!person) {
    return `
      <div class="detail-body">
        <h2>Fiche député</h2>
        ${note("Cliquez sur un siège de l'hémicycle ou cherchez un nom pour ouvrir la fiche : ce qu'il ou elle dit, vote et annonce.")}
      </div>`;
  }
  const path = politicianPath(person.id);
  const view = views.get(path);
  const header = `
    <div class="detail-header">
      <div class="person-title-row">
        <h2>${escapeHtml(person.name)}</h2>
        ${partyPill(person.party)}
      </div>
      <p class="source-note">Sur ${escapeHtml(periodLabel())}${state.themeId ? ` · thème « ${escapeHtml(themeLabel(state.themeId))} »` : ""}</p>
    </div>`;
  if (!view) {
    return `<div class="detail-body">${header}${statusBlock(path)}</div>`;
  }

  const activity = view.activity || {};
  const topThemes = (view.themes || []).filter((row) => themeMap.get(row.id)?.type === "theme").slice(0, 3);
  const themeScore = state.themeId ? (view.themes || []).find((row) => row.id === state.themeId) : null;
  const stances = state.themeId ? (view.stances || []).filter((stance) => stance.theme === state.themeId) : view.stances;

  const brief = `
    <p class="lead-sentence">${escapeHtml(activitySentence(view))}</p>
    ${
      activity.moreActiveThan !== null && activity.moreActiveThan !== undefined && activity.speeches
        ? `<p class="rank-sentence">A pris la parole plus souvent que <strong>${fmtPct(activity.moreActiveThan)}</strong> des députés sur la période.</p>`
        : ""
    }
    ${rolesSentence(view) ? note(rolesSentence(view)) : ""}
    ${
      state.themeId
        ? note(
            themeScore
              ? `Sur « ${themeLabel(state.themeId)} » : ${plural(themeScore.speechCount, "intervention", "interventions")}, soit ${fmtPct(themeScore.share)} de sa parole.`
              : `N'a pas pris la parole sur « ${themeLabel(state.themeId)} » pendant cette période.`,
          )
        : ""
    }
    ${
      topThemes.length
        ? `<div class="chip-row"><span class="chip-row-label">Ses principaux sujets :</span>${topThemes
            .map(
              (row) =>
                `<button class="theme-pill" type="button" data-theme-id="${escapeHtml(row.id)}" title="${fmtPct(row.share)} de ses interventions">${escapeHtml(themeLabel(row.id))} <small>${fmtPct(row.share)}</small></button>`,
            )
            .join("")}</div>`
        : ""
    }`;

  const positions = `
    <h4 class="sub-title">Ses annonces de vote${infoTip(STANCE_HELP)}</h4>
    ${stanceCards(stances, {
      heading: (stance) => `Textes du thème « ${escapeHtml(themeLabel(stance.theme))} »`,
      showSpeaker: false,
      empty: "Aucune annonce de vote explicite repérée sur cette période.",
    })}
    <h4 class="sub-title">Ses votes</h4>
    ${votesBlock(person, view)}`;

  return `
    <div class="detail-body fiche">
      ${header}
      ${block("En bref", brief)}
      ${block("Ses positions", positions, { help: "Ce que la personne a annoncé en séance et ce qu'elle a réellement voté. Les votes viennent des scrutins publics de l'Assemblée." })}
      ${block("Ses mots", wordsBlock(view.words, { distinctive: "le ou la distingue", common: "" }))}
      ${block(state.themeId ? `Ses interventions sur « ${themeLabel(state.themeId)} »` : "Ses interventions", renderExcerptList(view.excerpts, { showSpeaker: false }), {
        help: "Paragraphes entiers tirés du compte rendu officiel, avec le débat d'origine. Un extrait n'est rattaché à un thème que si le débat, le texte examiné ou plusieurs mots-clés concordent.",
      })}
      ${isScientific() ? block("Son style", markersBlock(view.markers)) : ""}
    </div>`;
}

// ---------------------------------------------------------------- group

function groupPicker() {
  const parties = data.parties.filter((party) => party.politicianCount > 0 && (state.showOthers || !isOtherParty(party.id)));
  return `
    <div class="detail-body">
      <h2>Groupes politiques</h2>
      ${note("Choisissez un groupe pour voir ses sujets, ses votes, ses annonces de vote et son vocabulaire.")}
      <div class="group-grid">
        ${parties
          .map(
            (party) => `
              <button class="group-card" type="button" data-select-party="${escapeHtml(party.id)}">
                <span class="swatch" data-style="background:${party.color}"></span>
                <strong>${escapeHtml(party.label)}</strong>
                <small>${escapeHtml(party.name || "")}</small>
                <small>${plural(party.politicianCount, "membre", "membres")}</small>
              </button>`,
          )
          .join("")}
      </div>
    </div>`;
}

function renderPartyPanel() {
  const partyId = currentPartyId();
  if (!partyId) {
    return groupPicker();
  }
  const party = partyMap.get(partyId);
  const path = partyPath(partyId);
  const view = views.get(path);
  const options = data.parties
    .filter((item) => item.politicianCount > 0 && (state.showOthers || !isOtherParty(item.id) || item.id === partyId))
    .map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === partyId ? "selected" : ""}>${escapeHtml(item.label)}</option>`)
    .join("");
  const header = `
    <div class="panel-control">
      <label class="field"><span>Groupe</span><select data-control="party">${options}</select></label>
    </div>
    <div class="panel-title-row">
      <h2>${escapeHtml(party?.name || partyLabel(partyId))}</h2>
      ${partyPill(partyId)}
    </div>
    <p class="source-note">Sur ${escapeHtml(periodLabel())}</p>`;
  if (!view) {
    return `<div class="detail-body">${header}${statusBlock(path)}</div>`;
  }
  const cohesion = view.cohesion || {};
  const stats = statGrid([
    ["Membres", fmtInt(view.stats.members)],
    ["Interventions", fmtCompact(view.stats.speeches)],
    ["Mots prononcés", fmtCompact(view.stats.words)],
    cohesion.comparable ? ["Unité de vote", fmtPct(cohesion.share, 1), "Part des votes individuels conformes à la majorité du groupe"] : null,
  ]);
  const speakers = barList(
    (view.speakers || []).map((speaker) => ({
      label: speaker.name,
      value: speaker.speeches,
      display: fmtInt(speaker.speeches),
      title: `${speaker.name} : ${plural(speaker.speeches, "intervention", "interventions")}, ${fmtCompact(speaker.words)} mots`,
      data: { "select-politician": speaker.id },
    })),
  );
  const languageRow = languageRowForParty(partyId);
  return `
    <div class="detail-body fiche">
      ${header}
      ${stats}
      ${cohesion.comparable ? note(`Sur la période, ses membres ont voté comme la majorité du groupe dans ${fmtPct(cohesion.share, 1)} des cas.`) : ""}
      ${block("Ses sujets", barList(themeRows(view.themes), { limit: 10 }), {
        help: "Part des interventions du groupe consacrées à chaque thème. Une intervention peut relever de plusieurs thèmes. Cliquez pour ouvrir le thème.",
      })}
      ${block(
        "Ses annonces de vote",
        stanceCards(view.stances, {
          heading: (stance) => `Textes du thème « ${escapeHtml(themeLabel(stance.theme))} »`,
          showSpeaker: true,
          empty: "Aucune annonce de vote explicite repérée sur cette période.",
        }),
        { help: STANCE_HELP },
      )}
      ${block("Ses votes sur les textes importants", voteList(view.keyVotes, { group: true, groups: isScientific() }), {
        help: "Position majoritaire du groupe, calculée à partir des votes de ses membres.",
      })}
      ${block("Ses mots", wordsBlock(view.words, { distinctive: "distingue le groupe", common: "du groupe" }))}
      ${block("Ses principaux orateurs", speakers)}
      ${isScientific() ? block("Profil de langage", renderPartyLanguageProfile(languageRow)) : ""}
    </div>`;
}

// ---------------------------------------------------------------- themes

function renderThemeList() {
  const assembly = views.get(assemblyPath());
  const counts = new Map((assembly?.themes || []).map((row) => [row.id, row]));
  const welcome = `
    <div class="welcome-card">
      <h2>Que disent et votent vos députés ?</h2>
      <ul>
        <li><strong>Cliquez sur un siège</strong> pour ouvrir la fiche d'une personne : ses sujets, ses votes, ses annonces de vote et ses mots.</li>
        <li><strong>Choisissez un thème</strong> ci-dessous pour voir qui en parle, comment votent les groupes et ce qu'ils en disent.</li>
        <li><strong>Changez la période</strong> en haut de la page pour comparer une session, les derniers mois ou des dates précises.</li>
      </ul>
      <p class="source-note">Les ${fmtInt(Gate.state.quota?.limit || 10)} premières analyses sont libres. Au-delà, l'accès reste gratuit après confirmation d'un email, pour tenir les robots à distance. <a href="${METHOD_URL}">Méthode et limites</a></p>
    </div>`;
  const domains = catalogDomains()
    .map((domain) => {
      const children = childThemes(domain.id);
      const count = counts.get(domain.id);
      return `
        <section class="domain-card">
          <button class="domain-title" type="button" data-theme-id="${escapeHtml(domain.id)}">
            ${escapeHtml(domain.label)}
            ${count ? `<small>${plural(count.speechCount, "intervention", "interventions")}</small>` : ""}
          </button>
          <div class="theme-pills">
            ${children
              .map((theme) => {
                const row = counts.get(theme.id);
                return `<button class="theme-pill" type="button" data-theme-id="${escapeHtml(theme.id)}">${escapeHtml(theme.label)}${row ? ` <small>${fmtCompact(row.speechCount)}</small>` : ""}</button>`;
              })
              .join("")}
          </div>
        </section>`;
    })
    .join("");
  return `
    <div class="detail-body">
      ${welcome}
      ${sectionTitle("Les thèmes", "Chaque intervention est rattachée à un thème d'abord par le débat en cours (le texte examiné et sa commission), puis, à défaut, par une forte densité de mots-clés. Un seul mot ne suffit jamais.", "h2")}
      <div class="domain-list">${domains}</div>
    </div>`;
}

function renderSeriesChart(view, parties) {
  const months = view.months || [];
  if (months.length < 2 || !parties.length) {
    return note("Période trop courte pour afficher une évolution mois par mois.");
  }
  const lines = parties.map((party) => {
    const byMonth = new Map((view.series?.[party] || []).map((row) => [row.month, row.speechCount]));
    return { party, values: months.map((month) => Number(byMonth.get(month) || 0)) };
  });
  const width = 640;
  const height = 230;
  const pad = { top: 14, right: 12, bottom: 34, left: 44 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const max = Math.max(1, ...lines.flatMap((line) => line.values));
  const xAt = (index) => pad.left + (index / (months.length - 1)) * innerW;
  const yAt = (value) => pad.top + innerH - (value / max) * innerH;
  const grid = [0, 0.5, 1]
    .map((fraction) => {
      const value = Math.round(max * fraction);
      const y = yAt(value);
      return `<line class="topic-chart-grid" x1="${pad.left}" x2="${width - pad.right}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"></line>
        <text class="topic-chart-axis" x="6" y="${(y + 4).toFixed(1)}">${fmtInt(value)}</text>`;
    })
    .join("");
  const step = Math.ceil(months.length / 6);
  const labels = months
    .map((month, index) =>
      index === 0 || index === months.length - 1 || index % step === 0
        ? `<text class="topic-chart-axis" x="${xAt(index).toFixed(1)}" y="${height - 10}" text-anchor="middle">${escapeHtml(fmtMonth(month))}</text>`
        : "",
    )
    .join("");
  const paths = lines
    .map((line) => {
      const d = line.values.map((value, index) => `${index === 0 ? "M" : "L"} ${xAt(index).toFixed(1)} ${yAt(value).toFixed(1)}`).join(" ");
      return `<path class="topic-chart-line" d="${d}" stroke="${partyColor(line.party)}"></path>`;
    })
    .join("");
  return `
    <svg class="topic-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Interventions par mois et par groupe">${grid}${paths}${labels}</svg>
    <div class="topic-legend">
      ${lines.map((line) => `<span class="topic-legend-item"><span class="swatch" data-style="background:${partyColor(line.party)}"></span>${escapeHtml(partyLabel(line.party))}</span>`).join("")}
    </div>`;
}

function renderThemePanel() {
  if (!state.themeId) {
    return renderThemeList();
  }
  const theme = themeMap.get(state.themeId);
  const path = themePath(state.themeId);
  const view = views.get(path);
  const parent = theme?.parent && theme.parent !== theme.id ? catalogDomains().find((domain) => domain.id === theme.parent) : null;
  const header = `
    <button class="back-link" type="button" data-theme-id="">← Tous les thèmes</button>
    <div class="panel-title-row">
      <h2>${escapeHtml(theme?.label || state.themeId)}</h2>
      ${parent ? `<button class="party-pill" type="button" data-theme-id="${escapeHtml(parent.id)}">${escapeHtml(parent.label)}</button>` : theme?.committee ? `<span class="party-pill">${escapeHtml(theme.committee)}</span>` : ""}
    </div>
    <p class="source-note">Sur ${escapeHtml(periodLabel())}</p>`;
  if (!view) {
    return `<div class="detail-body">${header}${statusBlock(path)}</div>`;
  }
  const stats = view.stats || {};
  const ownership = (view.ownership || []).filter((row) => partyVisible(row.party));
  const chartParties = [...ownership].sort((a, b) => b.speechCount - a.speechCount).slice(0, 5).map((row) => row.party);
  const stances = (view.stances || []).filter((stance) => partyVisible(stance.party));
  return `
    <div class="detail-body fiche">
      ${header}
      ${statGrid([
        ["Interventions", fmtInt(stats.speeches)],
        ["Personnes", fmtInt(stats.politicians)],
        ["Part de tous les débats", fmtPct(stats.shareOfAll, 1)],
        ["Scrutins liés", fmtInt(stats.votes)],
      ])}
      ${stats.firstDate ? note(`${plural(stats.debates, "débat consacré", "débats consacrés")} sur la période. Première intervention : ${fmtDate(stats.firstDate)}.`) : ""}
      ${block(
        "Quels groupes en parlent le plus",
        barList(
          ownership.map((row) => ({
            label: partyLabel(row.party),
            value: row.share,
            display: fmtPct(row.share),
            badge: row.lift >= 1.15 ? fmtRatio(row.lift) : "",
            color: partyColor(row.party),
            title: `${partyLabel(row.party)} : ${fmtPct(row.share)} de ses interventions portent sur ce thème (${plural(row.speechCount, "intervention", "interventions")})`,
            data: { "select-party": row.party },
          })),
        ),
        { help: "Part des interventions de chaque groupe consacrées à ce thème. Le badge ×N indique que le groupe y consacre N fois plus de temps de parole que la moyenne de l'Assemblée." },
      )}
      ${block("Évolution mois par mois", renderSeriesChart(view, chartParties), { help: "Nombre d'interventions sur ce thème chaque mois, pour les groupes qui en parlent le plus." })}
      ${block("Comment les groupes ont voté", voteList(view.keyVotes, { groups: true, empty: "Aucun vote clé sur ce thème pendant la période." }, 4), {
        help: "Votes clés liés aux textes de ce thème, avec la position majoritaire de chaque groupe (calculée à partir des votes de ses membres).",
      })}
      ${block(
        "Ce que les groupes ont annoncé",
        stanceCards(stances, {
          heading: (stance) => escapeHtml(partyLabel(stance.party)),
          showSpeaker: true,
          empty: "Aucune annonce de vote explicite repérée sur ce thème pendant la période.",
        }),
        { help: STANCE_HELP },
      )}
      ${block(
        "Qui en parle le plus",
        barList(
          (view.speakers || [])
            .filter((speaker) => partyVisible(speaker.party))
            .map((speaker) => ({
              label: speaker.name,
              detail: partyLabel(speaker.party),
              value: speaker.speechCount,
              color: partyColor(speaker.party),
              data: { "select-politician": speaker.id },
            })),
          { limit: 12 },
        ),
      )}
      ${block("Extraits", renderExcerptList(view.excerpts))}
    </div>`;
}

// ---------------------------------------------------------------- assembly

function renderAssemblyPanel() {
  const path = assemblyPath();
  const view = views.get(path);
  const header = `<h2>L'Assemblée</h2><p class="source-note">Sur ${escapeHtml(periodLabel())}</p>`;
  if (!view) {
    return `<div class="detail-body">${header}${statusBlock(path)}</div>`;
  }
  const totals = view.totals || {};
  const parties = (view.parties || []).filter((row) => partyVisible(row.party));
  return `
    <div class="detail-body fiche">
      ${header}
      ${statGrid([
        ["Interventions", fmtInt(totals.speeches)],
        ["Mots prononcés", fmtCompact(totals.words)],
        ["Séances", fmtInt(totals.sittings)],
        ["Scrutins", fmtInt(totals.votes)],
      ])}
      ${note(`Dont ${plural(totals.keyVotes, "vote clé", "votes clés")} (votes sur l'ensemble d'un texte, motions de censure, scrutins solennels).`)}
      ${block(
        "Temps de parole par groupe",
        barList(
          parties.map((row) => ({
            label: partyLabel(row.party),
            value: row.words,
            display: `${fmtCompact(row.words)} mots`,
            color: partyColor(row.party),
            title: `${partyLabel(row.party)} : ${plural(row.speeches, "intervention", "interventions")}, ${plural(row.speakers, "orateur", "orateurs")}`,
            data: { "select-party": row.party },
          })),
        ),
        { help: "Le gouvernement et les présidents de séance apparaissent si la case « Afficher le gouvernement et les autres intervenants » est cochée." },
      )}
      ${block("Les thèmes les plus débattus", barList(themeRows(view.themes), { limit: 12 }), { help: "Nombre d'interventions rattachées à chaque thème. Cliquez pour ouvrir le thème." })}
      ${block("Les mots de l'hémicycle", `<div class="panel-control">${ngramSelect()}</div>${barList(phraseRows(rowsForNgram(view.words?.common), false))}`)}
    </div>`;
}

// ---------------------------------------------------------------- language style (detailed mode)

const METRIC_LABELS = {
  LD: ["Mots porteurs de sens", "Part des noms, verbes et adjectifs, par rapport aux petits mots grammaticaux."],
  BW: ["Mots longs", "Part des mots de plus de 6 lettres."],
  MWL: ["Longueur des mots", "Nombre moyen de lettres par mot."],
  MSL: ["Longueur des phrases", "Nombre moyen de mots par phrase."],
  TTR: ["Variété du vocabulaire", "Plus le score est élevé, moins le discours se répète."],
};
const pronounKeys = ["nous", "je", "il", "vous"];
const lexicalMetricKeys = ["LD", "BW", "MWL", "MSL", "TTR"];
const palette = ["#2f6f73", "#b35d32", "#6f5b9e", "#2d9b68", "#c43b58", "#3156a3", "#e4a72c", "#8e4bb5"];
const languagePartyNames = {
  LFI_NFP: "La France Insoumise",
  GDR: "Parti communiste français",
  EcoS: "Europe Écologie Les Verts",
  SOC: "Parti socialiste",
  Dem: "Ensemble",
  EPR: "Ensemble",
  HOR: "Ensemble",
  DR: "Les Républicains",
  RN: "Rassemblement national",
};

function languageMetric(key) {
  const source = languageMetricMap.get(key) || { key, unit: "value" };
  const [label, description] = METRIC_LABELS[key] || [source.label || key, "Occurrences pour mille mots."];
  return { key, unit: source.unit || "value", label: `${label}${METRIC_LABELS[key] ? ` (${key})` : ""}`, shortLabel: key, description };
}

function languageValue(row, key) {
  return Number(row?.values?.[key] || 0);
}

function fmtLanguageValue(key, value) {
  const unit = languageMetric(key).unit;
  const number = Number(value || 0);
  const fixed = (amount, digits) =>
    amount.toLocaleString("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  if (unit === "percent") {
    return `${fixed(number * 100, 1)}\u202f%`;
  }
  if (unit === "ratio") {
    return fixed(number, 3);
  }
  if (unit === "perMille") {
    return `${fixed(number, 1)}\u202f‰`;
  }
  if (unit === "chars") {
    return `${fixed(number, 1)} car.`;
  }
  if (unit === "words") {
    return `${fixed(number, 1)} mots`;
  }
  return fixed(number, 2);
}

function languageRowForParty(partyId) {
  const name = languagePartyNames[partyId];
  return name ? (data.languageMarkers?.partyRows || []).find((row) => row.party === name) || null : null;
}

function pronounStack(row) {
  const total = pronounKeys.reduce((sum, key) => sum + languageValue(row, key), 0);
  if (!total) {
    return `<div class="pronoun-stack is-empty"></div>`;
  }
  return `
    <div class="pronoun-stack">
      ${pronounKeys
        .map((key, index) => {
          const value = languageValue(row, key);
          return `<span data-style="width:${((value / total) * 100).toFixed(1)}%; background:${palette[index]}" title="${escapeHtml(key)} ${escapeHtml(fmtLanguageValue(key, value))}"></span>`;
        })
        .join("")}
    </div>`;
}

function pronounLegend() {
  return `<div class="pronoun-legend">${pronounKeys
    .map((key, index) => `<span><span class="swatch" data-style="background:${palette[index]}"></span>${escapeHtml(key)}</span>`)
    .join("")}</div>`;
}

function renderPartyLanguageProfile(row) {
  if (!row) {
    return note("Aucun profil de langage n'est associé à ce groupe dans la source.");
  }
  return `
    ${note(`Source : ${row.party} (profil calculé par parti, pas par groupe parlementaire).`)}
    <div class="language-mini-grid">
      ${lexicalMetricKeys
        .map((key) => {
          const metric = languageMetric(key);
          return `<div class="stat" title="${escapeHtml(metric.description)}"><span>${escapeHtml(metric.shortLabel)}</span><strong>${escapeHtml(fmtLanguageValue(key, languageValue(row, key)))}</strong></div>`;
        })
        .join("")}
    </div>
    <div class="party-pronoun-card">${pronounStack(row)}${pronounLegend()}</div>`;
}

function renderStylePanel() {
  const markers = data.languageMarkers || { metrics: [], partyRows: [], summary: {} };
  const metricKey = state.languageMetric;
  const metric = languageMetric(metricKey);
  const rows = [...(markers.partyRows || [])].sort((a, b) => languageValue(b, metricKey) - languageValue(a, metricKey));
  const values = rows.map((row) => languageValue(row, metricKey));
  const min = Math.min(...values);
  const range = Math.max(0.0001, Math.max(...values) - min);
  return `
    <div class="detail-body language-dashboard">
      <h2>Style de langage${infoTip("Indicateurs lexicaux agrégés par parti politique, calculés sur une source distincte (metrics_CSV). Les partis ne correspondent pas exactement aux groupes parlementaires.")}</h2>
      <div class="panel-control">
        <label class="field">
          <span>Indicateur</span>
          <select data-control="language-metric">
            ${(markers.metrics || [])
              .map((item) => `<option value="${escapeHtml(item.key)}" ${item.key === metricKey ? "selected" : ""}>${escapeHtml(languageMetric(item.key).label)}</option>`)
              .join("")}
          </select>
        </label>
      </div>
      ${note(metric.description)}
      <div class="language-bars">
        ${rows
          .map((row, index) => {
            const value = languageValue(row, metricKey);
            return `
              <div class="language-bar-row">
                <div class="language-bar-label"><span>${escapeHtml(row.party)}</span><strong>${escapeHtml(fmtLanguageValue(metricKey, value))}</strong></div>
                <div class="language-track" aria-hidden="true"><span class="language-fill" data-style="width:${(12 + ((value - min) / range) * 88).toFixed(1)}%; background:${palette[index % palette.length]}"></span></div>
              </div>`;
          })
          .join("")}
      </div>
      <h3 class="section-title">Répartition des pronoms</h3>
      ${pronounLegend()}
      <div class="pronoun-list">
        ${rows
          .map(
            (row) => `
              <div class="pronoun-row">
                <div class="language-bar-label"><span>${escapeHtml(row.party)}</span></div>
                ${pronounStack(row)}
              </div>`,
          )
          .join("")}
      </div>
      ${note(`Source : ${markers.source || ""}`)}
    </div>`;
}

// ---------------------------------------------------------------- render

function renderAnalysis() {
  const renderers = {
    themes: renderThemePanel,
    depute: () => renderPoliticianDetail(state.selectedId),
    groupe: renderPartyPanel,
    assemblee: renderAssemblyPanel,
    style: renderStylePanel,
  };
  analysisContent.innerHTML = (renderers[state.tab] || renderThemePanel)();
}

function renderDialog() {
  const person = politiciansById.get(state.selectedId);
  if (!person) {
    return;
  }
  dialogTitle.textContent = person.name;
  dialogContent.innerHTML = renderPoliticianDetail(person.id);
}

function render() {
  if (!data) {
    return;
  }
  syncControls();
  renderSummary();
  renderSearchResults();
  renderChamber();
  renderAnalysis();
  if (dialog.open) {
    renderDialog();
  }
}

// ---------------------------------------------------------------- actions

function selectPolitician(personId, openDialog = true) {
  const person = politiciansById.get(personId);
  if (!person) {
    return;
  }
  state.selectedId = person.id;
  state.tab = "depute";
  if (isOtherParty(person.party)) {
    state.showOthers = true;
  }
  if (openDialog && !dialog.open) {
    renderDialog();
    dialog.showModal();
  }
  commit();
}

function selectParty(partyId) {
  if (!partyMap.has(partyId)) {
    return;
  }
  state.partyId = partyId;
  state.tab = "groupe";
  if (isOtherParty(partyId)) {
    state.showOthers = true;
  }
  if (dialog.open) {
    dialog.close();
  }
  commit();
}

function selectTheme(themeId) {
  state.themeId = themeMap.has(themeId) ? themeId : "";
  state.themeQuery = "";
  state.themeMenuOpen = false;
  if (state.tab !== "depute" || !state.themeId) {
    state.tab = "themes";
  }
  if (dialog.open && state.tab !== "depute") {
    dialog.close();
  }
  themeSearch.blur();
  commit();
}

function setPeriodPreset(preset) {
  if (preset === "custom" && state.period.preset !== "custom") {
    const { from, to } = periodRange();
    state.period.from = from;
    state.period.to = to;
  }
  state.period.preset = preset;
  commit();
}

function setCustomPeriod() {
  let from = periodFrom.value;
  let to = periodTo.value;
  if (!/^\d{4}-\d{2}$/.test(from) || !/^\d{4}-\d{2}$/.test(to)) {
    return;
  }
  if (from > to) {
    [from, to] = [to, from];
  }
  state.period.from = clampMonth(from);
  state.period.to = clampMonth(to);
  commit();
}

document.body.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }
  const infoButton = target.closest(".info-tip");
  if (infoButton) {
    event.preventDefault();
    event.stopPropagation();
    infoButton.focus();
    return;
  }
  const modeButton = target.closest("[data-audience-mode]");
  if (modeButton) {
    state.mode = modeButton.dataset.audienceMode === "scientific" ? "scientific" : "citizen";
    if (state.tab === "style" && !isScientific()) {
      state.tab = "themes";
    }
    commit();
    return;
  }
  const tab = target.closest("[data-tab]");
  if (tab) {
    state.tab = tab.dataset.tab;
    commit();
    return;
  }
  if (target.closest("[data-open-gate]")) {
    Gate.show();
    return;
  }
  if (target.closest("[data-retry]")) {
    [...viewStatus.entries()].forEach(([path, status]) => status === "error" && viewStatus.delete(path));
    load();
    return;
  }
  const markerButton = target.closest("[data-marker-category]");
  if (markerButton) {
    state.markerCategory = markerButton.dataset.markerCategory;
    render();
    return;
  }
  const personButton = target.closest("[data-select-politician]");
  if (personButton) {
    state.search = "";
    selectPolitician(personButton.dataset.selectPolitician);
    return;
  }
  const partyButton = target.closest("[data-select-party]");
  if (partyButton) {
    selectParty(partyButton.dataset.selectParty);
    return;
  }
  const seatButton = target.closest("[data-seat-metric]");
  if (seatButton) {
    state.seatMetric = seatButton.dataset.seatMetric;
    render();
    return;
  }
  const themeButton = target.closest("[data-theme-id]");
  if (themeButton) {
    selectTheme(themeButton.dataset.themeId);
  }
});

chamberSvg.addEventListener("click", (event) => {
  const dot = event.target.closest("[data-politician-id]");
  if (dot) {
    selectPolitician(dot.dataset.politicianId);
  }
});

chamberSvg.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") {
    return;
  }
  const dot = event.target.closest("[data-politician-id]");
  if (dot) {
    event.preventDefault();
    selectPolitician(dot.dataset.politicianId);
  }
});

partyFilter.addEventListener("change", () => {
  state.partyFilter = partyFilter.value;
  if (state.partyFilter !== "ALL") {
    state.partyId = state.partyFilter;
    state.tab = "groupe";
  }
  commit();
});

searchInput.addEventListener("input", () => {
  state.search = searchInput.value;
  render();
});

themeSearch.addEventListener("focus", () => {
  state.themeMenuOpen = true;
  state.themeQuery = "";
  syncControls();
});

themeSearch.addEventListener("input", () => {
  state.themeQuery = themeSearch.value;
  state.themeMenuOpen = true;
  renderThemeMenu();
});

themeSearch.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    state.themeMenuOpen = false;
    themeSearch.blur();
    syncControls();
  }
});

document.addEventListener("click", (event) => {
  if (state.themeMenuOpen && !event.target.closest(".theme-field")) {
    state.themeMenuOpen = false;
    syncControls();
  }
});

showOthers.addEventListener("change", () => {
  state.showOthers = showOthers.checked;
  if (!state.showOthers && isOtherParty(state.partyFilter)) {
    state.partyFilter = "ALL";
  }
  render();
});

periodSelect.addEventListener("change", () => setPeriodPreset(periodSelect.value));
periodFrom.addEventListener("change", setCustomPeriod);
periodTo.addEventListener("change", setCustomPeriod);

// The deputy modal renders the same controls outside analysisContent.
function handlePanelChange(event) {
  const control = event.target.dataset?.control;
  if (control === "ngram") {
    state.ngram = event.target.value;
    render();
  } else if (control === "party") {
    selectParty(event.target.value);
  } else if (control === "language-metric") {
    state.languageMetric = event.target.value;
    render();
  }
}

analysisContent.addEventListener("change", handlePanelChange);
dialogContent.addEventListener("change", handlePanelChange);

dialog.addEventListener("click", (event) => {
  if (event.target === dialog) {
    dialog.close();
  }
});
$("closeDialog").addEventListener("click", () => dialog.close());

window.addEventListener("polititia:unlocked", () => {
  [...viewStatus.entries()].forEach(([path, status]) => status === "locked" && viewStatus.delete(path));
  load();
});

// ---------------------------------------------------------------- boot

function hydrate(payload) {
  data = payload;
  partyMap = new Map(data.parties.map((party) => [party.id, party]));
  politiciansById = new Map(data.politicians.map((person) => [person.id, person]));
  const catalog = data.analytics?.themes || [];
  themeMap = new Map([...catalog.filter((theme) => theme.type === "domain"), ...catalog.filter((theme) => theme.type !== "domain")].map((theme) => [theme.id, theme]));
  languageMetricMap = new Map((data.languageMarkers?.metrics || []).map((metric) => [metric.key, metric]));
  Gate.updateFrom(payload);
}

async function boot() {
  Gate.bind();
  const response = await fetch("/api/bootstrap", { credentials: "include", headers: { Accept: "application/json" } });
  if (!response.ok) {
    analysisContent.innerHTML = `<div class="detail-body">${note("Les données n'ont pas pu être chargées. Réessayez dans un instant.")}</div>`;
    return;
  }
  hydrate(await response.json());
  if (!data.analytics) {
    analysisContent.innerHTML = `<div class="detail-body">${note("La base d'analyse est absente : lancez build_analytics_db.py puis redémarrez le serveur.")}</div>`;
    return;
  }
  readUrl();
  commit();
}

boot();
