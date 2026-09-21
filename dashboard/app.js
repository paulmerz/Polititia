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
  address: "Formules d'adresse parlementaire uniquement (monsieur le ministre, chers collègues). Taux : occurrences pour 1 000 mots.",
  negation: "Portée de la négation (ne … pas / jamais / rien / plus), pas les comparatifs comme plus de ou les plus.",
  procedure: "Collocations qui contiennent des termes de procédure législative.",
  stance: "Collocations qui contiennent des verbes de position (faut, propose, refuse…).",
  pronoun: "Collocations qui contiennent je / nous / vous.",
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
  seatWords: { citizen: "mots", scientific: "tokens" },
  seatSize: "Taille des sièges",
  seatSpeechesBtn: "Interventions",
  seatWordsBtn: { citizen: "Mots", scientific: "Tokens" },
  seatScaleSpeeches: "interventions",
  seatScaleWords: { citizen: "mots", scientific: "tokens" },
  seatScaleNote: {
    citizen: "La surface du cercle suit le volume, plafonnée au 90e percentile pour que les valeurs extrêmes partagent la plus grande taille. Le survol affiche les deux comptes.",
    scientific: "L'aire du siège suit la métrique, plafonnée au 90e percentile. Le survol affiche interventions et tokens.",
  },
  seatScaleAria: "Légende de taille des sièges",
  themeField: { citizen: "Enjeu", scientific: "Thème" },
  allThemes: { citizen: "Tous les enjeux", scientific: "Tous les thèmes" },
  searchInTheme: "Nom, dans cet enjeu",
  tabTheme: { citizen: "Enjeu", scientific: "Thème" },
  tabThemes: { citizen: "Sujets", scientific: "Thèmes" },
  onTheme: { citizen: "Sur l'enjeu", scientific: "Sur le thème" },
  themeSpeeches: { citizen: "Interventions sur l'enjeu", scientific: "Discours du thème" },
  openedBy: "Ouvert par",
  trend: "Tendance",
  trendNew: "Nouveau",
  trendRising: "En hausse",
  trendFalling: "En baisse",
  trendStable: "Stable",
  themeSignal: "Signal",
  themeDomain: "Domaine",
  politiciansOnTheme: "députés",
  openedOn: "ouvert le",
  clearTheme: "Retirer l'enjeu",
  noThemeMatches: "Personne n'aborde cet enjeu dans le filtre actuel",
  chooseTheme: "Choisissez un enjeu pour ouvrir la lentille.",
  trajectory: "Trajectoire",
  whoOverinvests: { citizen: "Qui insiste davantage", scientific: "Sur-investissement" },
  excerpts: "Extraits",
  noExcerpts: "Aucun extrait pour cette sélection.",
  noOwnership: "Aucun score d'appropriation pour cet enjeu.",
  firstMention: "Première mention",
  themeShare: "Part",
  hasNotAddressed: "n'a pas abordé",
  inCurrentIndex: "dans l'index actuel.",
  onThemeShare: "sur l'enjeu, part du temps de parole",
  hasNotAddressedTheme: "n'a pas abordé cet enjeu",
  themeSpeechesShort: "interventions sur l'enjeu",
  first: "première",
  otherThemes: { citizen: "Autres sujets", scientific: "Autres thèmes" },
  themesMissing: "Les sujets lexicaux manquent. Lancez analyze_topics.py puis dashboard/build_dashboard_data.py.",
  themesIntro: {
    citizen: "Champs de parole extraits des interventions. La part indique le pourcentage des discours du groupe rattachés à chaque sujet.",
    scientific: "Champs lexicaux issus de TF-IDF + NMF sur les interventions. Les parts sont le pourcentage des discours du groupe assignés à chaque thème.",
  },
  partyLexicalFields: { citizen: "Champs de parole du groupe", scientific: "Champs lexicaux du groupe" },
  noMonthlySeries: "Aucune série mensuelle pour ce groupe.",
  topicChartAria: "Part des sujets dans le temps",
  perThousand: "Pour 1 000 mots",
  hits: "Occurrences",
  noThemeData: "La lentille d'enjeux est vide. Lancez extract_speeches.py puis analyze_themes.py.",
  themeDomains: "Domaines",
  themeSignals: "Signaux",
  tooFewTrajectory: "Trop peu d'occurrences pour une trajectoire.",
  weeklyShareAria: "Part hebdomadaire par groupe",
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
    return copy("trendNew");
  }
  if (trend === "rising") {
    return copy("trendRising");
  }
  if (trend === "falling") {
    return copy("trendFalling");
  }
  return copy("trendStable");
}

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
  document.getElementById("partyFilterLabel").textContent = copy("party");
  document.getElementById("unlabeledLabel").textContent = copy("unlabeled");
  const themeLabel = document.getElementById("themeFieldLabel");
  if (themeLabel) {
    themeLabel.textContent = copy("themeField");
  }
  const seatSizeLabel = document.getElementById("seatSizeLabel");
  if (seatSizeLabel) {
    seatSizeLabel.textContent = copy("seatSize");
  }
  const seatGroup = document.getElementById("seatSizeGroup");
  if (seatGroup) {
    seatGroup.setAttribute("aria-label", copy("seatSize"));
  }
  const speechesButton = document.querySelector('[data-seat-metric="speeches"]');
  const wordsButton = document.querySelector('[data-seat-metric="tokens"]');
  if (speechesButton) {
    speechesButton.textContent = copy("seatSpeechesBtn");
  }
  if (wordsButton) {
    wordsButton.textContent = copy("seatWordsBtn");
  }
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
  const themeTabButton = document.querySelector('[data-tab="theme"]');
  if (themeTabButton) {
    themeTabButton.textContent = copy("tabTheme");
  }
  const themesTabButton = document.querySelector('[data-tab="themes"]');
  if (themesTabButton) {
    themesTabButton.textContent = copy("tabThemes");
  }
}

function renderSummary() {
  const theme = selectedTheme();
  const metrics = theme
    ? [
        [copy("onTheme"), `${fmtInt(theme.politicianCount)} / ${fmtInt(data.meta.politicians)}`],
        [copy("themeSpeeches"), theme.speechCount],
        [copy("openedBy"), partyLabel(theme.openerParty) || copy("na")],
        [copy("trend"), trendLabel(theme.trend)],
      ]
    : [
        [copy("politicians"), data.meta.politicians],
        [copy("speeches"), data.meta.totalSpeeches],
        [copy("surfaceTokens"), data.meta.totalSurfaceTokens],
        [copy("parties"), data.meta.eligibleParties.length],
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
  sections.push(`<button class="theme-option ${state.themeId ? "" : "is-active"}" type="button" data-theme-id="">${escapeHtml(copy("allThemes"))}</button>`);
  if (!catalogThemes().length) {
    sections.push(`<p class="source-note theme-option-label">${escapeHtml(copy("noThemeData"))}</p>`);
  }
  if (domains.length) {
    sections.push(`<div class="theme-group-label">${escapeHtml(copy("themeDomains"))}</div>`);
    domains.forEach((theme) => {
      sections.push(`
        <button class="theme-option ${theme.id === state.themeId ? "is-active" : ""}" type="button" data-theme-id="${escapeHtml(theme.id)}">
          ${escapeHtml(theme.label)}
          <small>${fmtInt(theme.speechCount)} ${escapeHtml(copy("seatSpeeches"))} · ${fmtInt(theme.politicianCount)} ${escapeHtml(copy("politiciansOnTheme"))}</small>
        </button>
      `);
    });
  }
  if (signals.length) {
    sections.push(`<div class="theme-group-label">${escapeHtml(copy("themeSignals"))}</div>`);
    signals.forEach((theme) => {
      sections.push(`
        <button class="theme-option ${theme.id === state.themeId ? "is-active" : ""}" type="button" data-theme-id="${escapeHtml(theme.id)}">
          ${escapeHtml(theme.label)}
          <small>${escapeHtml(trendLabel(theme.trend))} · ${fmtInt(theme.speechCount)} ${escapeHtml(copy("seatSpeeches"))}</small>
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
      <button type="button" data-clear-theme="true" aria-label="${escapeHtml(copy("clearTheme"))}">x</button>
    </span>
    <span class="theme-context-meta">
      ${theme.type === "emerging" ? escapeHtml(copy("themeSignal")) : escapeHtml(copy("themeDomain"))}
      · ${fmtInt(theme.politicianCount)} ${escapeHtml(copy("politiciansOnTheme"))}
      · ${escapeHtml(copy("openedOn"))} ${escapeHtml(theme.firstDate || copy("na"))}
    </span>
  `;
}

function syncControls() {
  renderChrome();
  populatePartyFilter();
  partyFilter.value = state.partyFilter;
  searchInput.value = state.search;
  searchInput.placeholder = selectedTheme() ? copy("searchInTheme") : copy("searchPlaceholder");
  if (themeSearch) {
    themeSearch.value = selectedTheme() && !state.themeMenuOpen ? selectedTheme().label : state.themeQuery;
    themeSearch.placeholder = selectedTheme() ? selectedTheme().label : copy("allThemes");
  }
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
      ? `${seatTooltip(person)} - ${fmtInt(score.speechCount)} ${copy("themeSpeechesShort")} - ${copy("first")} ${score.firstDate || copy("na")}`
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
  return `${person.name} - ${partyLabel(person.party)} - ${fmtInt(person.speechCount)} ${copy("seatSpeeches")} · ${fmtCompact(person.surfaceTokenCount)} ${copy("seatWords")}`;
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
    empty.textContent = selectedTheme() ? copy("noThemeMatches") : copy("noMatches");
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
  const names = svgEl("g", { class: "seat-names", "aria-hidden": "true" });
  const nameSize = visible.length > 90 ? 6.8 : visible.length > 50 ? 7.6 : visible.length > 28 ? 8.6 : 10;

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
      ? `, ${fmtInt(score.speechCount)} ${copy("onThemeShare")} ${fmtShare(share)}`
      : themed
        ? `, ${copy("hasNotAddressedTheme")}`
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
      ? `${seatTooltip(person)} - ${fmtInt(score.speechCount)} ${copy("themeSpeechesShort")} - ${copy("first")} ${score.firstDate || copy("na")}`
      : seatTooltip(person);
    dot.appendChild(title);
    dots.appendChild(dot);

    if (showSeatNames) {
      const extra = 7 + radius;
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
  const unit = isSpeeches ? copy("seatScaleSpeeches") : copy("seatScaleWords");
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
    <span>${escapeHtml(copy("seatScaleNote"))} (${escapeHtml(unit)})</span>
    <span class="seat-size-key" aria-label="${escapeHtml(copy("seatScaleAria"))}">${key}</span>
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

function ngramSelect(selectId) {
  return `
    <label class="field">
      <span class="field-heading">${escapeHtml(copy("ngram"))}${infoTip("ngramHelp")}</span>
      <select id="${escapeHtml(selectId)}">
        ${ngramOptionsHtml(state.ngram)}
      </select>
    </label>
  `;
}

function renderExcerptList(excerpts) {
  if (!excerpts?.length) {
    return `<p class="source-note">${escapeHtml(copy("noExcerpts"))}</p>`;
  }
  return `
    <div class="excerpt-list">
      ${excerpts
        .map(
          (excerpt) => `
            <button class="excerpt-card" type="button" data-select-politician="${escapeHtml(excerpt.politicianId)}">
              <span class="source-note">${escapeHtml(excerpt.date || copy("na"))} · ${escapeHtml(excerpt.speaker)} · ${escapeHtml(partyLabel(excerpt.party))}</span>
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
    return `<p class="source-note theme-note">${escapeHtml(copy("hasNotAddressed"))} ${escapeHtml(theme.label)} ${escapeHtml(copy("inCurrentIndex"))}</p>`;
  }
  return `
    <h3 class="section-title">${escapeHtml(copy("onTheme"))} ${escapeHtml(theme.label)}</h3>
    <div class="stat-grid">
      <div class="stat"><span>${escapeHtml(copy("themeSpeeches"))}</span><strong>${fmtInt(score.speechCount)}</strong></div>
      <div class="stat"><span>${escapeHtml(copy("themeShare"))}</span><strong>${escapeHtml(fmtShare(score.share))}</strong></div>
      <div class="stat"><span>${escapeHtml(copy("firstMention"))}</span><strong>${escapeHtml(score.firstDate || copy("na"))}</strong></div>
    </div>
    ${renderExcerptList(excerpts)}
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
      <div class="panel-control">
        ${ngramSelect("politicianPanelNgram")}
      </div>
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
      ${renderThemeLensNote(person)}

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
      ${renderMarkerRate(phrases, state.markerCategory)}
      <p class="source-note">${escapeHtml(markerHelp[state.markerCategory] || "")}</p>
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

function renderThemeChart(themeId) {
  const series = data.partyThemeSeries?.[themeId] || {};
  const weeks = [...new Set(Object.values(series).flatMap((rows) => rows.map((row) => row.week)))].sort();
  if (weeks.length < 2) {
    return `<p class="source-note">${escapeHtml(copy("tooFewTrajectory"))}</p>`;
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
    <svg class="theme-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(copy("weeklyShareAria"))}">
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
    return `<p class="source-note">${escapeHtml(copy("noOwnership"))}</p>`;
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
    return `<div class="detail-body"><p class="source-note">${escapeHtml(copy("chooseTheme"))}</p></div>`;
  }
  return `
    <div class="detail-body">
      <div class="panel-title-row">
        <h2>${escapeHtml(theme.label)}</h2>
        <span class="party-pill">${theme.type === "emerging" ? escapeHtml(copy("themeSignal")) : escapeHtml(copy("themeDomain"))}</span>
      </div>
      <div class="stat-grid">
        <div class="stat"><span>${escapeHtml(copy("speeches"))}</span><strong>${fmtInt(theme.speechCount)}</strong></div>
        <div class="stat"><span>${escapeHtml(copy("politicians"))}</span><strong>${fmtInt(theme.politicianCount)}</strong></div>
        <div class="stat"><span>${escapeHtml(copy("openedBy"))}</span><strong>${escapeHtml(partyLabel(theme.openerParty) || copy("na"))}</strong></div>
      </div>
      <p class="source-note">${escapeHtml(trendLabel(theme.trend))} · ${escapeHtml(copy("first"))} ${escapeHtml(theme.firstDate || copy("na"))}</p>
      <h3 class="section-title">${escapeHtml(copy("trajectory"))}</h3>
      ${renderThemeChart(theme.id)}
      <h3 class="section-title">${escapeHtml(copy("whoOverinvests"))}</h3>
      ${renderOwnership(theme.id)}
      <h3 class="section-title">${escapeHtml(copy("excerpts"))}</h3>
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
      <div class="stat"><span>${escapeHtml(copy("perThousand"))}</span><strong>${Number(rate).toFixed(1)}</strong></div>
      <div class="stat"><span>${escapeHtml(copy("hits"))}</span><strong>${fmtInt(count)}</strong></div>
    </div>
  `;
}

function topicColor(topicId) {
  return topicPalette[Number(topicId) % topicPalette.length];
}

function renderTopicChart(months, lines) {
  if (!months.length || !lines.length) {
    return `<p class="source-note">${escapeHtml(copy("noMonthlySeries"))}</p>`;
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
    <svg class="topic-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(copy("topicChartAria"))}">
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
        <h2>${escapeHtml(copy("tabThemes"))}</h2>
        <p class="source-note">${escapeHtml(copy("themesMissing"))}</p>
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
      label: copy("otherThemes"),
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
          <span>${escapeHtml(copy("party"))}</span>
          <select id="themesPartySelect">${partyOptions(partyId)}</select>
        </label>
      </div>
      <h2>${escapeHtml(copy("tabThemes"))}</h2>
      <p class="source-note">${escapeHtml(copy("themesIntro"))}</p>
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
      <h3 class="section-title">${escapeHtml(copy("partyLexicalFields"))}</h3>
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
  renderSummary();
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

if (themeSearch) {
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
}

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
render();
