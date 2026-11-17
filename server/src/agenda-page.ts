import { addDays, agendaView, type Agenda, type AgendaView, type CommitteeMeeting, type DossierCard } from "./agenda.ts";
import type { Analytics } from "./analytics.ts";
import type { DashboardBundle } from "./data.ts";
import { escapeHtml } from "./mailer.ts";
import { fmtDay, plural } from "./outreach.ts";

// Server-rendered, so the agenda reads without JavaScript and can be indexed.
// Every sentence is a fact from the Assembly's data or from analytics.sqlite;
// nothing here ranks or qualifies a text.

export const AGENDA_PAGE = "agenda.html";
const AGENDA_SLOT = "<!-- agenda -->";
const TEASER_SLOT = "<!-- agenda-accueil -->";
const TEASER_DAYS = 7;
const TEASER_TEXTS = 4;
const TOPICS_SHOWN = 3;
const TOPIC_CHARS = 240;
const ASSEMBLY_URL = "https://www.assemblee-nationale.fr/";

type Parties = Map<string, { label: string; name: string }>;

function partiesOf(bundle: DashboardBundle | null): Parties {
  const parties: Parties = new Map();
  for (const party of (bundle?.parties || []) as Array<{ id?: string; label?: string; name?: string }>) {
    if (party.id) {
      parties.set(party.id, { label: party.label || party.id, name: party.name || party.label || party.id });
    }
  }
  return parties;
}

function capitalize(text: string): string {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

function dayLabel(date: string, today: string): string {
  const options: Intl.DateTimeFormatOptions = { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" };
  if (date.slice(0, 4) !== today.slice(0, 4)) {
    options.year = "numeric";
  }
  const label = new Intl.DateTimeFormat("fr-FR", options).format(new Date(`${date}T12:00:00Z`));
  return capitalize(label.replace(/^(\S+) 1 /, "$1 1er "));
}

function timeLabel(startsAt: string): string {
  const [hours, minutes] = startsAt.slice(11, 16).split(":");
  if (!hours) {
    return "";
  }
  return minutes && minutes !== "00" ? `${Number(hours)} h ${minutes}` : `${Number(hours)} h`;
}

function builtAtLabel(builtAt: string): string {
  const date = new Date(builtAt);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const parts = new Intl.DateTimeFormat("en-GB", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "Europe/Paris",
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return `${fmtDay(`${value("year")}-${value("month")}-${value("day")}`)} à ${Number(value("hour"))} h ${value("minute")}`;
}

function monthLabel(day: string): string {
  return new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${day.slice(0, 7)}-15T12:00:00Z`));
}

function procedureLabel(procedure: string): string {
  return capitalize(procedure.replace(/-Article\s*(\S+)/i, " (article $1)"));
}

function groupLabel(group: string, parties: Parties): string {
  const party = parties.get(group);
  if (!party) {
    return group ? escapeHtml(group) : "";
  }
  return `<abbr title="${escapeHtml(party.name)}">${escapeHtml(party.label)}</abbr>`;
}

function coauthorsText(count: number): string {
  return count > 0 ? ` et ${plural(count, "autre auteur", "autres auteurs")}` : "";
}

function depositText(card: DossierCard, feminine: boolean): string {
  return card.depositedOn ? `, ${feminine ? "déposée" : "déposé"} le ${fmtDay(card.depositedOn)}` : "";
}

// "Proposition de loi de Mme X (SOC) et 2 autres auteurs, déposée le 4 mars 2025".
export function originLine(card: DossierCard, parties: Parties): string {
  const author = card.author;
  const name = author ? escapeHtml(author.name) : "";
  const group = author?.group ? ` (${groupLabel(author.group, parties)})` : "";
  const others = author ? coauthorsText(author.coauthors) : "";
  if (card.kind === "projet") {
    const senate = card.origin === "senat" ? ", examiné d’abord par le Sénat" : "";
    return `Projet de loi du Gouvernement${senate}${depositText(card, false)}`;
  }
  if (card.kind === "proposition") {
    if (card.origin === "senat") {
      return `Proposition de loi sénatoriale${name ? `, déposée par ${name}${others}` : ""}${card.depositedOn ? ` le ${fmtDay(card.depositedOn)}` : ""}`;
    }
    return `Proposition de loi${name ? ` de ${name}${group}${others}` : ""}${depositText(card, true)}`;
  }
  if (card.kind === "resolution") {
    return `Proposition de résolution${name ? ` de ${name}${group}${others}` : ""}${depositText(card, true)}`;
  }
  return escapeHtml(card.procedure);
}

function cardTitle(card: DossierCard): string {
  return escapeHtml(card.title || card.subject || card.uid);
}

function themesLine(card: DossierCard, view: AgendaView): string {
  if (!card.themes.length) {
    return "";
  }
  const since = view.memorySince ? ` depuis ${monthLabel(view.memorySince)}` : "";
  const themes = card.themes.map((theme) => {
    const link = `<a href="/hemicycle?theme=${encodeURIComponent(theme.id)}">${escapeHtml(theme.label)}</a>`;
    if (!view.memorySince) {
      return link;
    }
    return `${link} : ${plural(theme.speeches, "intervention", "interventions")} et ${plural(theme.keyVotes, "vote clé", "votes clés")}${since}`;
  });
  return `<p class="agenda-text-line"><span class="agenda-label">${card.themes.length > 1 ? "Thèmes" : "Thème"}</span> ${themes.join(" ; ")}</p>`;
}

function memoryBlock(card: DossierCard, view: AgendaView): string {
  const memory = card.memory;
  if (!memory) {
    return "";
  }
  if (!memory.speeches && !memory.votes) {
    return `<p class="agenda-memory agenda-memory-empty">Aucune intervention ni aucun scrutin en séance rattachés à ce texte depuis ${monthLabel(view.memorySince)} dans nos données.</p>`;
  }
  const lines: string[] = [];
  if (memory.speeches) {
    const last = memory.lastDate ? ` ; la dernière le ${fmtDay(memory.lastDate)}` : "";
    const sittings = memory.sittings === 1 ? "en une séance" : `au cours de ${plural(memory.sittings, "séance", "séances")}`;
    lines.push(`<p>${plural(memory.speeches, "intervention", "interventions")} sur ce texte, ${sittings}${last}.</p>`);
  }
  if (memory.votes) {
    lines.push(`<p>${plural(memory.votes, "scrutin public", "scrutins publics")} sur ce texte.</p>`);
  }
  if (memory.keyVotes.length) {
    const votes = memory.keyVotes
      .map(
        (vote) =>
          `<li>${fmtDay(vote.date)} : ${escapeHtml(vote.title)}, <strong>${vote.adopted ? "adopté" : "rejeté"}</strong> (<a href="${escapeHtml(vote.url)}">scrutin n° ${vote.number}</a>)</li>`,
      )
      .join("");
    lines.push(`<ul class="agenda-votes">${votes}</ul>`);
  }
  return `<div class="agenda-memory"><h4>Déjà en séance</h4>${lines.join("")}</div>`;
}

function dossierCard(card: DossierCard, view: AgendaView, parties: Parties): string {
  const origin = originLine(card, parties);
  const committee = card.committee
    ? `<p class="agenda-text-line"><span class="agenda-label">Commission saisie au fond</span> ${escapeHtml(card.committee)}</p>`
    : "";
  return `<article class="agenda-text" id="texte-${escapeHtml(card.uid)}">
  <h3>${cardTitle(card)}</h3>
  ${origin ? `<p class="agenda-text-origin">${origin}</p>` : ""}
  ${committee}
  ${themesLine(card, view)}
  ${memoryBlock(card, view)}
  <p class="agenda-text-link"><a href="${escapeHtml(card.url)}">Le dossier sur le site de l’Assemblée nationale</a></p>
</article>`;
}

function itemMeta(item: { state: string; type: string; procedure: string; dossiers: string[] }, known: Set<string>): string {
  const parts: string[] = [];
  if (/vote/i.test(item.type)) {
    parts.push(`<span class="agenda-badge">${escapeHtml(item.type)}</span>`);
  }
  if (item.state === "eventuel") {
    parts.push(`<span class="agenda-badge agenda-badge-soft">Inscription éventuelle</span>`);
  }
  if (item.procedure) {
    parts.push(`<span class="agenda-procedure">${escapeHtml(procedureLabel(item.procedure))}</span>`);
  }
  for (const uid of item.dossiers.filter((uid) => known.has(uid))) {
    parts.push(`<a href="#texte-${escapeHtml(uid)}">Le texte et ce qui en a déjà été dit</a>`);
  }
  return parts.length ? `<p class="agenda-item-meta">${parts.join(" ")}</p>` : "";
}

function committeeItem(meeting: CommitteeMeeting): string {
  const flags = [meeting.openToPress ? "ouverte à la presse" : "", meeting.video ? "retransmise" : ""].filter(Boolean);
  const topics = meeting.topics.slice(0, TOPICS_SHOWN).map((topic) => {
    const text = topic.replace(/^[\s–—-]+/, "");
    return `<li>${escapeHtml(text.length > TOPIC_CHARS ? `${text.slice(0, TOPIC_CHARS - 1).trimEnd()}…` : text)}</li>`;
  });
  const more = meeting.topics.length > TOPICS_SHOWN ? `<li class="agenda-more">et ${plural(meeting.topics.length - TOPICS_SHOWN, "autre point", "autres points")}</li>` : "";
  const organ = meeting.organ
    ? `<strong${meeting.organName && meeting.organName !== meeting.organ ? ` title="${escapeHtml(meeting.organName)}"` : ""}>${escapeHtml(meeting.organ)}</strong>`
    : "<strong>Réunion</strong>";
  return `<li><span class="agenda-time">${timeLabel(meeting.startsAt)}</span> ${organ}${flags.length ? ` <span class="agenda-flags">(${flags.join(", ")})</span>` : ""}${topics.length || more ? `<ul class="agenda-topics">${topics.join("")}${more}</ul>` : ""}</li>`;
}

export function renderAgenda(view: AgendaView, bundle: DashboardBundle | null): string {
  const parties = partiesOf(bundle);
  const known = new Set(view.dossiers.map((card) => card.uid));
  const updated = builtAtLabel(view.builtAt);
  const until = view.lastConfirmedSitting ? ` Les séances sont annoncées jusqu’au ${fmtDay(view.lastConfirmedSitting)}.` : "";
  const intro = `<section class="page-card agenda-intro">
  <p>Ordre du jour publié par l’Assemblée nationale${updated ? `, mis à jour le ${updated}` : ""}.${until}
  Il est fixé par la Conférence des présidents et peut changer jusqu’à la séance : un point « éventuel » n’est pas encore confirmé.</p>
</section>`;

  const sittingDays = view.days.filter((day) => day.sittings.length);
  const sittings = sittingDays.length
    ? sittingDays
        .map((day) => {
          const blocks = day.sittings
            .map((sitting) => {
              const items = sitting.items.length
                ? `<ol class="agenda-items">${sitting.items
                    .map((item) => `<li><p class="agenda-item-subject">${escapeHtml(item.subject)}</p>${itemMeta(item, known)}</li>`)
                    .join("")}</ol>`
                : `<p class="agenda-empty">Ordre du jour pas encore publié.</p>`;
              const flags = [sitting.state === "eventuel" ? "séance éventuelle" : "", sitting.video ? "retransmise" : ""].filter(Boolean);
              return `<div class="agenda-sitting"><p class="agenda-time">${timeLabel(sitting.startsAt)}${flags.length ? ` <span class="agenda-flags">(${flags.join(", ")})</span>` : ""}</p>${items}</div>`;
            })
            .join("");
          return `<div class="agenda-day" id="jour-${day.date}"><h3>${dayLabel(day.date, view.today)}</h3>${blocks}</div>`;
        })
        .join("")
    : `<p class="agenda-empty">Aucune séance publique n’est annoncée pour le moment.</p>`;

  const texts = view.dossiers.length
    ? `<section class="page-card agenda-texts" aria-labelledby="agendaTexts">
  <h2 id="agendaTexts">Les textes au programme</h2>
  <p class="agenda-note">Pour chaque texte : qui l’a déposé, la commission qui l’a examiné, son thème et ce que Polititia a déjà relevé en séance publique.</p>
  ${view.dossiers.map((card) => dossierCard(card, view, parties)).join("")}
</section>`
    : "";

  const committeeDays = view.days.filter((day) => day.committees.length);
  const committees = committeeDays.length
    ? `<section class="page-card agenda-committees" aria-labelledby="agendaCommittees">
  <h2 id="agendaCommittees">En commission cette semaine</h2>
  ${committeeDays
    .map(
      (day) =>
        `<details class="agenda-committee-day"><summary>${dayLabel(day.date, view.today)} · ${plural(day.committees.length, "réunion", "réunions")}</summary><ul>${day.committees
          .map(committeeItem)
          .join("")}</ul></details>`,
    )
    .join("")}
</section>`
    : "";

  return `${intro}
<section class="page-card agenda-sittings" aria-labelledby="agendaSittings">
  <h2 id="agendaSittings">En séance publique</h2>
  ${sittings}
</section>
${texts}
${committees}`;
}

function unavailable(): string {
  return `<section class="page-card"><p>L’agenda n’est pas disponible pour le moment. L’ordre du jour officiel est publié sur le
  <a href="${ASSEMBLY_URL}">site de l’Assemblée nationale</a>.</p></section>`;
}

export function withAgenda(
  html: string,
  agenda: Agenda | null,
  analytics: Analytics | null,
  bundle: DashboardBundle | null,
  today: string,
): string {
  let body = unavailable();
  if (agenda) {
    try {
      body = renderAgenda(agendaView(agenda, analytics, today), bundle);
    } catch (error) {
      console.error("Agenda page failed:", error);
    }
  }
  return html.replace(AGENDA_SLOT, body);
}

// Home page: the texts coming up in the next days, nothing when there are none.
export function renderAgendaTeaser(view: AgendaView, bundle: DashboardBundle | null): string {
  const parties = partiesOf(bundle);
  const until = addDays(view.today, TEASER_DAYS - 1);
  const cards = view.dossiers.filter((card) => card.firstDate <= until).slice(0, TEASER_TEXTS);
  if (!cards.length) {
    return "";
  }
  const items = cards
    .map(
      (card) => `<li>
      <span class="landing-agenda-date">${dayLabel(card.firstDate, view.today)}</span>
      <a href="/agenda#texte-${escapeHtml(card.uid)}">${cardTitle(card)}</a>
      <span class="landing-agenda-origin">${originLine({ ...card, depositedOn: "" }, parties)}</span>
    </li>`,
    )
    .join("");
  return `<section class="landing-section landing-agenda" aria-labelledby="agendaTitle">
  <h2 id="agendaTitle">Cette semaine à l’Assemblée</h2>
  <ul class="landing-agenda-list">${items}</ul>
  <p class="landing-more"><a href="/agenda">Tout l’agenda, et ce qui a déjà été dit sur chaque texte</a></p>
</section>`;
}

export function withAgendaTeaser(
  html: string,
  agenda: Agenda | null,
  analytics: Analytics | null,
  bundle: DashboardBundle | null,
  today: string,
): string {
  let teaser = "";
  if (agenda) {
    try {
      teaser = renderAgendaTeaser(agendaView(agenda, analytics, today, { days: TEASER_DAYS, committeeDays: 0 }), bundle);
    } catch (error) {
      console.error("Agenda teaser failed:", error);
    }
  }
  return html.replace(TEASER_SLOT, teaser);
}
