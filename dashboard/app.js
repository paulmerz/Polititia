const data = window.DASHBOARD_DATA;

if (!data) {
  throw new Error("Les données du tableau de bord n'ont pas été chargées. Exécutez dashboard/build_dashboard_data.py.");
}

const partyMap = new Map(data.parties.map((party) => [party.id, party]));
const partyOrder = data.partyOrder;
const politiciansById = new Map(data.politicians.map((person) => [person.id, person]));
const chamberSvg = document.getElementById("chamberSvg");
const analysisContent = document.getElementById("analysisContent");
const partyFilter = document.getElementById("partyFilter");
const searchInput = document.getElementById("searchInput");
const searchResults = document.getElementById("searchResults");
const ngramSize = document.getElementById("ngramSize");
const showUnlabeled = document.getElementById("showUnlabeled");
const dialog = document.getElementById("politicianDialog");
const dialogTitle = document.getElementById("dialogTitle");
const dialogContent = document.getElementById("dialogContent");

const tokenLogs = data.politicians.map((person) => Math.log1p(person.surfaceTokenCount || 0));
const minTokenLog = Math.min(...tokenLogs);
const maxTokenLog = Math.max(...tokenLogs);
const languageMarkers = data.languageMarkers || { metrics: [], partyRows: [], summary: {} };
const languageMetricMap = new Map((languageMarkers.metrics || []).map((metric) => [metric.key, metric]));
const pronounKeys = ["nous", "je", "il", "vous"];
const lexicalMetricKeys = ["LD", "BW", "MWL", "MSL", "TTR"];
const languagePalette = ["#2f6f73", "#b35d32", "#6f5b9e", "#2d9b68", "#c43b58", "#3156a3", "#e4a72c"];
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
const partyFamilyLabels = {
  Left: "Gauche",
  Green: "Écologistes",
  Independent: "Indépendants",
  Center: "Centre",
  "Center-right": "Centre droit",
  Right: "Droite",
  "Far right": "Extrême droite",
  Unknown: "Non rattaché",
};
const partySourceLabels = {
  explicit: "explicite",
  inferred_from_labeled_variant: "déduit du groupe",
  unresolved: "non résolu",
};
const markerCategoryLabels = {
  address: "Adresse",
  procedure: "Séance",
  stance: "Position",
  negation: "Négation",
  pronoun: "Pronoms",
};
const honorifics = new Set(["m", "mme", "mlle", "mr", "dr"]);

const COPY = {
  appTitle: "L'hémicycle des idées et des mots",
  appEyebrow: "La parole des députés",
  modeCitizen: "Citoyen",
  modeScientific: "Scientifique",
  modeGroup: "Mode d'affichage",
  search: "Rechercher",
  searchPlaceholder: "Nom",
  party: "Groupe",
  allParties: "Tous les groupes",
  unlabeled: "Non rattachés",
  ngram: { citizen: "Groupes de mots", scientific: "N-gramme" },
  ngram1: { citizen: "1 mot", scientific: "Unigrammes" },
  ngram2: { citizen: "2 mots", scientific: "Bigrammes" },
  ngram3: { citizen: "3 mots", scientific: "Trigrammes" },
  ngram4: { citizen: "4 mots", scientific: "4-grammes" },
  ngramHelp: {
    citizen: "Choisissez si vous comparez des mots isolés ou des suites de 2, 3 ou 4 mots extraits des discours.",
    scientific: "Taille des n-grammes extraits des discours, d'unigrammes à 4-grammes.",
  },
  tabPolitician: "Député",
  tabParty: "Groupe",
  tabMarkers: { citizen: "Style", scientific: "Marqueurs" },
  tabCorpus: "Assemblée",
  politicians: "Députés",
  speeches: "Interventions",
  surfaceTokens: { citizen: "Mots prononcés", scientific: "Tokens de surface" },
  contentTokens: { citizen: "Mots de contenu", scientific: "Tokens de contenu" },
  parties: "Groupes",
  tokens: { citizen: "Mots", scientific: "Tokens" },
  sources: "Sources",
  presidency: "Présidence",
  noMatches: "Aucune correspondance",
  noResults: "Aucun résultat",
  close: "Fermer",
  moreInfo: "Plus d'informations",
  chamberAria: "Carte de l'hémicycle",
  chamberSvgAria: "Répartition des groupes en hémicycle",
  analysisAria: "Sections d'analyse",
  noPhrases: "Aucune expression pour cette sélection.",
  marker: { citizen: "Indicateur", scientific: "Marqueur" },
  noLanguageMarkers: { citizen: "Aucun indicateur de langage disponible.", scientific: "Aucun marqueur de langage disponible." },
  noPronounMarkers: "Aucune donnée de pronoms disponible.",
  languageProfile: "Profil de langage",
  languageProfileHelp: {
    citizen: "Ces indicateurs décrivent comment un groupe s'exprime : part des mots porteurs de sens, mots longs, longueur des phrases et variété du vocabulaire.",
    scientific: "Profil lexical agrégé (LD, BW, MWL, MSL, TTR) et distribution des pronoms.",
  },
  noPartyMarker: "Aucun profil de langage n'a été associé à ce groupe.",
  sourceParty: "Source :",
  pronouns: "Pronoms",
  distinctiveTitle: { citizen: "Ce qui le distingue", scientific: "Phrases TF-IDF" },
  distinctiveHelp: {
    citizen: "Les formules que cette personne emploie plus que le reste de l'Assemblée.",
    scientific: "N-grammes les plus discriminants selon le score TF-IDF par rapport au reste du corpus.",
  },
  topContent: { citizen: "Expressions les plus dites", scientific: "Expressions de contenu" },
  speechMarkers: { citizen: "Signatures oratoires", scientific: "Marqueurs de discours" },
  speechMarkersHelp: {
    citizen: "Repères de langage : formules d'adresse, vocabulaire de séance, prises de position, négations et pronoms qui colorent le discours.",
    scientific: "N-grammes classés en catégories linguistiques : adresse, procédure, position, négation, pronoms.",
  },
  partyCommon: { citizen: "Expressions partagées du groupe", scientific: "N-grammes communs du groupe" },
  partyDistinctive: { citizen: "Expressions caractéristiques du groupe", scientific: "N-grammes distinctifs du groupe" },
  distinctiveHelpParty: {
    citizen: "Les formules que ce groupe emploie plus que les autres groupes.",
    scientific: "N-grammes distinctifs selon le score log-odds par rapport aux autres groupes.",
  },
  commonPhrases: { citizen: "Expressions partagées", scientific: "N-grammes communs" },
  distinctivePhrases: { citizen: "Expressions caractéristiques", scientific: "N-grammes distinctifs" },
  noPolitician: "Aucun député sélectionné.",
  partyAssignment: "Attribution du groupe :",
  languageMarkersTitle: { citizen: "Style de langage", scientific: "Marqueurs linguistiques" },
  languageMarkersHelp: {
    citizen: "Comparez comment les groupes parlent : mots porteurs de sens, mots longs, longueur des phrases, variété du vocabulaire.",
    scientific: "Indicateurs lexicaux agrégés par groupe : LD, BW, MWL, MSL, TTR et pronoms.",
  },
  highest: "Plus élevé",
  mean: "Moyenne",
  lowest: "Plus bas",
  na: "n.d.",
  pronounDistribution: "Répartition des pronoms",
  lexicalMeasures: { citizen: "Mesures de langage", scientific: "Mesures lexicales" },
  dataSource: "Source des données",
  dataSources: "Sources des données",
  corpusTitle: { citizen: "Assemblée", scientific: "Corpus" },
  globalCommon: { citizen: "Expressions partagées à l'Assemblée", scientific: "N-grammes communs globaux" },
  partyVolume: "Volume par groupe",
  charsUnit: "car.",
  wordsUnit: "mots",
  seatSpeeches: "interventions",
};

const METRIC_COPY = {
  LD: {
    citizen: {
      label: "Mots porteurs de sens",
      shortLabel: "Sens",
      description: "Part des noms, verbes et adjectifs, par rapport aux petits mots grammaticaux.",
    },
    scientific: {
      label: "Densité lexicale (LD)",
      shortLabel: "LD",
      description: "Part des mots lexicaux / de contenu (LD).",
    },
  },
  BW: {
    citizen: {
      label: "Mots longs",
      shortLabel: "Longs",
      description: "Part des mots de plus de 6 lettres.",
    },
    scientific: {
      label: "Mots longs (BW)",
      shortLabel: "BW",
      description: "Part des mots de plus de 6 caractères (BW).",
    },
  },
  MWL: {
    citizen: {
      label: "Longueur des mots",
      shortLabel: "Mots",
      description: "Nombre moyen de lettres par mot.",
    },
    scientific: {
      label: "Longueur moyenne des mots (MWL)",
      shortLabel: "MWL",
      description: "Longueur moyenne des mots en caractères (MWL).",
    },
  },
  MSL: {
    citizen: {
      label: "Longueur des phrases",
      shortLabel: "Phrases",
      description: "Nombre moyen de mots par phrase.",
    },
    scientific: {
      label: "Longueur moyenne des phrases (MSL)",
      shortLabel: "MSL",
      description: "Longueur moyenne des phrases en mots (MSL).",
    },
  },
  TTR: {
    citizen: {
      label: "Variété du vocabulaire",
      shortLabel: "Variété",
      description: "Diversité des mots employés : plus le score est élevé, moins le discours se répète.",
    },
    scientific: {
      label: "Ratio types/tokens (TTR)",
      shortLabel: "TTR",
      description: "Type-token ratio, mesure de diversité lexicale (TTR).",
    },
  },
  nous: {
    citizen: { label: "nous", shortLabel: "nous", description: "Occurrences pour mille mots." },
    scientific: { label: "nous", shortLabel: "nous", description: "Occurrences pour mille mots." },
  },
  je: {
    citizen: { label: "je", shortLabel: "je", description: "Occurrences pour mille mots." },
    scientific: { label: "je", shortLabel: "je", description: "Occurrences pour mille mots." },
  },
  il: {
    citizen: { label: "il", shortLabel: "il", description: "Occurrences pour mille mots." },
    scientific: { label: "il", shortLabel: "il", description: "Occurrences pour mille mots." },
  },
  vous: {
    citizen: { label: "vous", shortLabel: "vous", description: "Occurrences pour mille mots." },
    scientific: { label: "vous", shortLabel: "vous", description: "Occurrences pour mille mots." },
  },
};

const state = {
  audienceMode: "citizen",
  activeTab: "politician",
  selectedId: null,
  selectedParty: "ALL",
  partyFilter: "ALL",
  ngram: "2",
  markerCategory: null,
  languageMetric: "LD",
  search: "",
  showUnlabeled: false,
};

function isScientific() {
  return state.audienceMode === "scientific";
}

function copy(key) {
  const entry = COPY[key];
  if (entry == null) {
    return key;
  }
  if (typeof entry === "string") {
    return entry;
  }
  return isScientific() ? entry.scientific : entry.citizen;
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
  return Number(value || 0).toLocaleString("fr-FR");
}

function fmtCompact(value) {
  return Intl.NumberFormat("fr-FR", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(Number(value || 0));
}

function languageMetric(key) {
  const source = languageMetricMap.get(key) || { key, unit: "value" };
  const localized = METRIC_COPY[key]?.[state.audienceMode] || {};
  return {
    key,
    unit: source.unit || "value",
    label: localized.label || source.label || key,
    shortLabel: localized.shortLabel || source.shortLabel || key,
    description: localized.description || source.description || "",
  };
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
    return `${Number(value || 0).toFixed(1)} ${copy("charsUnit")}`;
  }
  if (unit === "words") {
    return `${Number(value || 0).toFixed(1)} ${copy("wordsUnit")}`;
  }
  return Number(value || 0).toFixed(2);
}

function languageColor(index) {
  return languagePalette[index % languagePalette.length];
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
  if (partyId === "UNLABELED") {
    return copy("unlabeled");
  }
  return partyMap.get(partyId)?.label || partyId;
}

function partyColor(partyId) {
  return partyMap.get(partyId)?.color || "#8f969e";
}

function partyFamilyLabel(family) {
  return partyFamilyLabels[family] || family || "";
}

function partySourceLabel(source) {
  let text = String(source || "");
  Object.entries(partySourceLabels)
    .sort((a, b) => b[0].length - a[0].length)
    .forEach(([key, label]) => {
      text = text.replaceAll(key, label);
    });
  return text;
}

function markerCategoryLabel(category) {
  return markerCategoryLabels[category] || category;
}

function selectedPolitician() {
  return politiciansById.get(state.selectedId) || data.politicians[0];
}

function shortPoliticianName(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
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
  const initial = Array.from(rest[0])[0] || "";
  return `${initial.toUpperCase()}. ${rest.slice(1).join(" ")}`;
}

function chooseInitialPolitician() {
  const ranked = [...data.politicians]
    .filter((person) => person.party !== "UNLABELED")
    .sort((a, b) => (b.surfaceTokenCount || 0) - (a.surfaceTokenCount || 0));
  state.selectedId = (ranked[0] || data.politicians[0])?.id || null;
  state.selectedParty = selectedPolitician()?.party || "ALL";
}

function infoTip(helpKey) {
  const text = copy(helpKey);
  if (!text) {
    return "";
  }
  return `
    <button class="info-tip" type="button" aria-label="${escapeHtml(copy("moreInfo"))}">
      <span aria-hidden="true">?</span>
      <span class="info-tip-bubble">${escapeHtml(text)}</span>
    </button>
  `;
}

function labeledTitle(tag, labelKey, helpKey) {
  return `<${tag} class="section-title">${escapeHtml(copy(labelKey))}${helpKey ? infoTip(helpKey) : ""}</${tag}>`;
}

function headingWithTip(tag, text, helpKey) {
  return `<${tag} class="section-title">${escapeHtml(text)}${helpKey ? infoTip(helpKey) : ""}</${tag}>`;
}

function ngramOptionsHtml(selected) {
  return ["1", "2", "3", "4"]
    .map(
      (value) =>
        `<option value="${value}" ${selected === value ? "selected" : ""}>${escapeHtml(copy(`ngram${value}`))}</option>`,
    )
    .join("");
}

function setAudienceMode(mode) {
  state.audienceMode = mode === "scientific" ? "scientific" : "citizen";
  document.body.dataset.mode = state.audienceMode;
  render();
}

function renderChrome() {
  document.title = copy("appTitle");
  document.getElementById("appEyebrow").textContent = copy("appEyebrow");
  document.getElementById("appTitle").textContent = copy("appTitle");
  document.getElementById("searchLabel").textContent = copy("search");
  searchInput.placeholder = copy("searchPlaceholder");
  document.getElementById("partyFilterLabel").textContent = copy("party");
  document.getElementById("unlabeledLabel").textContent = copy("unlabeled");
  document.getElementById("ngramFieldLabel").innerHTML = `${escapeHtml(copy("ngram"))}${infoTip("ngramHelp")}`;
  document.getElementById("chamberPanel").setAttribute("aria-label", copy("chamberAria"));
  chamberSvg.setAttribute("aria-label", copy("chamberSvgAria"));
  document.getElementById("analysisTabs").setAttribute("aria-label", copy("analysisAria"));
  document.getElementById("closeDialog").setAttribute("aria-label", copy("close"));
  document.querySelector(".mode-toggle").setAttribute("aria-label", copy("modeGroup"));
  document.querySelector('[data-audience-mode="citizen"]').textContent = copy("modeCitizen");
  document.querySelector('[data-audience-mode="scientific"]').textContent = copy("modeScientific");
  document.querySelectorAll("[data-audience-mode]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.audienceMode === state.audienceMode);
  });
  document.querySelector('[data-tab="politician"]').textContent = copy("tabPolitician");
  document.querySelector('[data-tab="party"]').textContent = copy("tabParty");
  document.querySelector('[data-tab="markers"]').textContent = copy("tabMarkers");
  document.querySelector('[data-tab="corpus"]').textContent = copy("tabCorpus");
}

function renderSummary() {
  const metrics = [
    [copy("politicians"), data.meta.politicians],
    [copy("speeches"), data.meta.totalSpeeches],
    [copy("surfaceTokens"), data.meta.totalSurfaceTokens],
    [copy("parties"), data.meta.eligibleParties.length],
  ];
  document.getElementById("summaryStrip").innerHTML = metrics
    .map(
      ([label, value]) => `
        <div class="metric">
          <span class="metric-value">${fmtCompact(value)}</span>
          <span class="metric-label">${escapeHtml(label)}</span>
        </div>
      `,
    )
    .join("");
}

function populatePartyFilter() {
  const options = [
    `<option value="ALL">${escapeHtml(copy("allParties"))}</option>`,
    ...data.parties
      .filter((party) => party.politicianCount > 0)
      .map(
        (party) =>
          `<option value="${escapeHtml(party.id)}">${escapeHtml(partyLabel(party.id))} (${party.politicianCount})</option>`,
      ),
  ];
  partyFilter.innerHTML = options.join("");
}

function syncControls() {
  renderChrome();
  populatePartyFilter();
  partyFilter.value = state.partyFilter;
  searchInput.value = state.search;
  ngramSize.innerHTML = ngramOptionsHtml(state.ngram);
  ngramSize.value = state.ngram;
  showUnlabeled.checked = state.showUnlabeled;
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.toggle("is-active", tab.dataset.tab === state.activeTab);
  });
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

function seatRadius(person) {
  const value = Math.log1p(person.surfaceTokenCount || 0);
  const scaled = (value - minTokenLog) / Math.max(0.0001, maxTokenLog - minTokenLog);
  return 3.4 + scaled * 5.8;
}

function layoutPartySeats(people, sector, { labeled = false } = {}) {
  const rows = labeled
    ? Math.min(10, Math.max(4, Math.ceil(people.length / 8)))
    : Math.min(8, Math.max(2, Math.ceil(Math.sqrt(people.length / 1.6))));
  const inner = labeled ? 175 : 116;
  const outer = labeled ? 502 : 486;
  const radii = Array.from({ length: rows }, (_, rowIndex) =>
    rows === 1 ? inner : inner + ((outer - inner) * rowIndex) / (rows - 1),
  );
  const weights = radii.map((radius) => (labeled ? radius : 1));
  const totalWeight = weights.reduce((sum, value) => sum + value, 0) || 1;
  const counts = weights.map((weight) => Math.max(1, Math.round((weight / totalWeight) * people.length)));
  while (counts.reduce((sum, value) => sum + value, 0) > people.length) {
    const richest = counts.reduce((best, value, index) => (value >= counts[best] ? index : best), 0);
    if (counts[richest] <= 1) {
      break;
    }
    counts[richest] -= 1;
  }
  while (counts.reduce((sum, value) => sum + value, 0) < people.length) {
    counts[counts.length - 1] += 1;
  }

  const rowGroups = counts.map(() => []);
  let cursor = 0;
  counts.forEach((count, rowIndex) => {
    rowGroups[rowIndex] = people.slice(cursor, cursor + count);
    cursor += count;
  });

  const seats = [];
  const gap = Math.min(labeled ? 1.2 : 2.4, sector.width / 7);
  const start = sector.start - gap;
  const end = sector.end + gap;

  rowGroups.forEach((group, rowIndex) => {
    if (!group.length) {
      return;
    }
    group.forEach((person, index) => {
      const fraction = (index + 0.5) / group.length;
      const theta = start + (end - start) * fraction;
      seats.push({ person, ...polarPoint(500, 585, radii[rowIndex], theta) });
    });
  });

  return seats;
}

function seatLabelPoint(x, y, extra) {
  const dx = x - 500;
  const dy = y - 585;
  const dist = Math.hypot(dx, dy) || 1;
  return {
    x: x + (dx / dist) * extra,
    y: y + (dy / dist) * extra,
  };
}

function renderChamber() {
  const visible = getVisiblePoliticians();
  const sectors = buildSectors(visible);
  const showSeatNames = state.partyFilter !== "ALL";
  chamberSvg.replaceChildren();

  [116, 169, 222, 275, 328, 381, 434, 486].forEach((radius) => {
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

    if (sector.width > 7 && !showSeatNames) {
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
  tribuneText.textContent = copy("presidency");
  chamberSvg.appendChild(tribuneText);

  if (!visible.length) {
    const empty = svgEl("text", { x: 500, y: 300, class: "empty-label" });
    empty.textContent = copy("noMatches");
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
    people.sort((a, b) => (b.surfaceTokenCount || 0) - (a.surfaceTokenCount || 0));
    allSeats.push(...layoutPartySeats(people, sector, { labeled: showSeatNames }));
  });

  const dots = svgEl("g");
  const names = svgEl("g", { class: "seat-names", "aria-hidden": "true" });
  const nameSize = visible.length > 90 ? 6.8 : visible.length > 50 ? 7.6 : visible.length > 28 ? 8.6 : 10;

  allSeats.forEach(({ person, x, y }) => {
    const dot = svgEl("circle", {
      cx: x.toFixed(1),
      cy: y.toFixed(1),
      r: seatRadius(person).toFixed(2),
      fill: partyColor(person.party),
      class: `seat-dot${person.id === state.selectedId ? " is-selected" : ""}`,
      tabindex: 0,
      role: "button",
      "aria-label": `${person.name}, ${partyLabel(person.party)}`,
      "data-politician-id": person.id,
    });
    const title = svgEl("title");
    title.textContent = `${person.name} - ${partyLabel(person.party)} - ${fmtInt(person.speechCount)} ${copy("seatSpeeches")}`;
    dot.appendChild(title);
    dots.appendChild(dot);

    if (showSeatNames) {
      const extra = 7 + seatRadius(person);
      const point = seatLabelPoint(x, y, extra);
      const label = svgEl("text", {
        x: point.x.toFixed(1),
        y: point.y.toFixed(1),
        class: "seat-name",
        "font-size": String(nameSize),
      });
      label.textContent = shortPoliticianName(person.name);
      names.appendChild(label);
    }
  });
  chamberSvg.appendChild(dots);
  if (showSeatNames) {
    chamberSvg.appendChild(names);
  }
  renderLegend(byParty);
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
    : `<span class="source-note">${escapeHtml(copy("noResults"))}</span>`;
}

function phraseList(rows, options = {}) {
  const useScore = isScientific() && options.scoreLabel;
  const metric = useScore ? options.metric || "count" : "count";
  const scoreLabel = useScore ? options.scoreLabel : null;
  const scoreDigits = options.scoreDigits ?? 2;
  const maxValue = Math.max(
    1,
    ...rows.map((row) => Math.abs(Number(row[metric] ?? row.count ?? 0))),
  );
  if (!rows.length) {
    return `<p class="source-note">${escapeHtml(copy("noPhrases"))}</p>`;
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
      <span>${escapeHtml(copy("marker"))}</span>
      <select id="${escapeHtml(selectId)}">
        ${(languageMarkers.metrics || [])
          .map((metric) => {
            const display = languageMetric(metric.key);
            return `
              <option value="${escapeHtml(metric.key)}" ${metric.key === state.languageMetric ? "selected" : ""}>
                ${escapeHtml(display.label)}
              </option>
            `;
          })
          .join("")}
      </select>
    </label>
  `;
}

function renderLanguageMetricChart(metricKey) {
  const rows = languageRowsForMetric(metricKey);
  if (!rows.length) {
    return `<p class="source-note">${escapeHtml(copy("noLanguageMarkers"))}</p>`;
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
    return `<p class="source-note">${escapeHtml(copy("noPronounMarkers"))}</p>`;
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
  const rows = [...(languageMarkers.partyRows || [])].sort((a, b) => a.party.localeCompare(b.party, "fr"));
  if (!rows.length) {
    return "";
  }

  return `
    <div class="language-table-wrap">
      <table class="language-table">
        <thead>
          <tr>
            <th>${escapeHtml(copy("party"))}</th>
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
      ${labeledTitle("h3", "languageProfile", "languageProfileHelp")}
      <p class="source-note">${escapeHtml(copy("noPartyMarker"))}</p>
    `;
  }

  return `
    ${labeledTitle("h3", "languageProfile", "languageProfileHelp")}
    <p class="source-note">${escapeHtml(copy("sourceParty"))} ${escapeHtml(row.party)}</p>
    <div class="language-mini-grid">
      ${lexicalMetricKeys
        .map((key) => {
          const metric = languageMetric(key);
          return `
            <div class="stat" title="${escapeHtml(metric.description)}">
              <span>${escapeHtml(metric.shortLabel)}</span>
              <strong>${escapeHtml(fmtLanguageValue(key, languageValue(row, key)))}</strong>
            </div>
          `;
        })
        .join("")}
    </div>
    <div class="party-pronoun-card">
      <div class="language-bar-label">
        <span>${escapeHtml(copy("pronouns"))}</span>
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
              ${escapeHtml(markerCategoryLabel(category))}
            </button>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderPoliticianDetail(personId) {
  const person = politiciansById.get(personId);
  if (!person) {
    return `<div class="detail-body"><p class="source-note">${escapeHtml(copy("noPolitician"))}</p></div>`;
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
      <div class="detail-header">
        <div class="person-title-row">
          <h2>${escapeHtml(person.name)}</h2>
          <span class="party-pill">
            <span class="swatch" style="background:${partyColor(person.party)}"></span>
            ${escapeHtml(partyLabel(person.party))}
          </span>
        </div>
        <div class="stat-grid">
          <div class="stat"><span>${escapeHtml(copy("speeches"))}</span><strong>${fmtInt(person.speechCount)}</strong></div>
          <div class="stat"><span>${escapeHtml(copy("tokens"))}</span><strong>${fmtInt(person.surfaceTokenCount)}</strong></div>
          <div class="stat"><span>${escapeHtml(copy("sources"))}</span><strong>${fmtInt(person.sourcePathCount)}</strong></div>
        </div>
        <p class="source-note">${escapeHtml(copy("partyAssignment"))} ${escapeHtml(partySourceLabel(person.partySource))}</p>
      </div>

      ${labeledTitle("h3", "distinctiveTitle", "distinctiveHelp")}
      ${phraseList(tfidfRows, {
        metric: "tf_idf_vs_rest",
        scoreLabel: "tf_idf_vs_rest",
        scoreDigits: 4,
      })}

      ${labeledTitle("h3", "topContent")}
      ${phraseList(contentRows)}

      ${labeledTitle("h3", "speechMarkers", "speechMarkersHelp")}
      ${markerCategory}
      ${phraseList(markerRows)}

      ${labeledTitle("h3", "partyCommon")}
      ${phraseList(partyPhrases.common?.[state.ngram] || [])}

      ${labeledTitle("h3", "partyDistinctive", "distinctiveHelpParty")}
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
        `<option value="${escapeHtml(party.id)}" ${party.id === selectedParty ? "selected" : ""}>${escapeHtml(partyLabel(party.id))}</option>`,
    )
    .join("");
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
          <span>${escapeHtml(copy("party"))}</span>
          <select id="partyPanelSelect">${partyOptions(partyId)}</select>
        </label>
        <label class="field">
          <span class="field-heading">${escapeHtml(copy("ngram"))}${infoTip("ngramHelp")}</span>
          <select id="partyPanelNgram">
            ${ngramOptionsHtml(state.ngram)}
          </select>
        </label>
      </div>
      <div class="panel-title-row">
        <h2>${escapeHtml(partyLabel(partyId))}</h2>
        <span class="party-pill">
          <span class="swatch" style="background:${partyColor(partyId)}"></span>
          ${escapeHtml(partyFamilyLabel(party?.family))}
        </span>
      </div>
      <div class="stat-grid">
        <div class="stat"><span>${escapeHtml(copy("politicians"))}</span><strong>${fmtInt(party?.politicianCount)}</strong></div>
        <div class="stat"><span>${escapeHtml(copy("speeches"))}</span><strong>${fmtInt(party?.speechCount)}</strong></div>
        <div class="stat"><span>${escapeHtml(copy("tokens"))}</span><strong>${fmtInt(party?.analysisTokenCount)}</strong></div>
      </div>
      ${renderPartyLanguageProfile(languageRow)}
      <div class="two-column">
        <section>
          ${labeledTitle("h3", "commonPhrases")}
          ${phraseList(phrases.common?.[state.ngram] || [])}
        </section>
        <section>
          ${labeledTitle("h3", "distinctivePhrases", "distinctiveHelpParty")}
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
      <h2 class="panel-heading">${escapeHtml(copy("languageMarkersTitle"))}${infoTip("languageMarkersHelp")}</h2>
      <div class="stat-grid">
        <div class="stat"><span>${escapeHtml(copy("parties"))}</span><strong>${fmtInt(languageMarkers.partyRows?.length || 0)}</strong></div>
        <div class="stat"><span>${escapeHtml(copy("highest"))} (${escapeHtml(metric.shortLabel)})</span><strong>${escapeHtml(
          highest ? fmtLanguageValue(state.languageMetric, languageValue(highest, state.languageMetric)) : copy("na"),
        )}</strong></div>
        <div class="stat"><span>${escapeHtml(copy("mean"))} (${escapeHtml(metric.shortLabel)})</span><strong>${escapeHtml(
          summary.mean === undefined ? copy("na") : fmtLanguageValue(state.languageMetric, summary.mean),
        )}</strong></div>
      </div>

      ${headingWithTip("h3", metric.label, "languageMarkersHelp")}
      <p class="source-note">${escapeHtml(metric.description || "")}</p>
      ${renderLanguageMetricChart(state.languageMetric)}

      ${labeledTitle("h3", "pronounDistribution")}
      ${renderPronounDistribution()}

      ${labeledTitle("h3", "lexicalMeasures")}
      ${renderLanguageMatrix()}

      <p class="source-note section-title">${escapeHtml(copy("dataSource"))}</p>
      <p class="source-note">${escapeHtml(languageMarkers.source || data.meta.sources.languageMarkers || "")}</p>
      <p class="source-note">${escapeHtml(lowest ? `${copy("lowest")} (${metric.shortLabel}) : ${lowest.party}` : "")}</p>
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
          <span class="field-heading">${escapeHtml(copy("ngram"))}${infoTip("ngramHelp")}</span>
          <select id="corpusPanelNgram">
            ${ngramOptionsHtml(state.ngram)}
          </select>
        </label>
      </div>
      <h2>${escapeHtml(copy("corpusTitle"))}</h2>
      <div class="stat-grid">
        <div class="stat"><span>${escapeHtml(copy("speeches"))}</span><strong>${fmtInt(data.meta.totalSpeeches)}</strong></div>
        <div class="stat"><span>${escapeHtml(copy("surfaceTokens"))}</span><strong>${fmtInt(data.meta.totalSurfaceTokens)}</strong></div>
        <div class="stat"><span>${escapeHtml(copy("contentTokens"))}</span><strong>${fmtInt(data.meta.totalAnalysisTokens)}</strong></div>
      </div>

      ${labeledTitle("h3", "globalCommon")}
      ${phraseList(globalRows)}

      ${labeledTitle("h3", "partyVolume")}
      <div class="phrase-list">
        ${rankedParties
          .map((party) => {
            const width = Math.max(4, (party.analysisTokenCount / maxTokens) * 100);
            return `
              <div class="phrase-row">
                <div class="phrase-track">
                  <span class="phrase-bar" style="width:${width.toFixed(1)}%; background:${party.color}22"></span>
                  <span class="phrase-text">${escapeHtml(partyLabel(party.id))}</span>
                </div>
                <span class="phrase-count">${fmtCompact(party.analysisTokenCount)}</span>
              </div>
            `;
          })
          .join("")}
      </div>
      <p class="source-note section-title">${escapeHtml(copy("dataSources"))}</p>
      <p class="source-note">${Object.values(data.meta.sources).map(escapeHtml).join("<br />")}</p>
    </div>
  `;
}

function renderAnalysis() {
  if (state.activeTab === "party") {
    analysisContent.innerHTML = renderPartyPanel();
  } else if (state.activeTab === "markers") {
    analysisContent.innerHTML = renderLanguageMarkersPanel();
  } else if (state.activeTab === "corpus") {
    analysisContent.innerHTML = renderCorpusPanel();
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
  renderSummary();
  renderSearchResults();
  renderChamber();
  renderAnalysis();
  if (dialog.open) {
    renderDialog();
  }
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

document.body.addEventListener("click", (event) => {
  const infoButton = event.target.closest(".info-tip");
  if (infoButton) {
    event.preventDefault();
    event.stopPropagation();
    infoButton.focus();
    return;
  }

  const modeButton = event.target.closest("[data-audience-mode]");
  if (modeButton) {
    setAudienceMode(modeButton.dataset.audienceMode);
    return;
  }

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

ngramSize.addEventListener("change", () => {
  state.ngram = ngramSize.value;
  render();
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
  if (event.target.id === "partyPanelNgram" || event.target.id === "corpusPanelNgram") {
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
render();
