(function adminPage() {
  const $ = (id) => document.getElementById(id);
  const state = { data: null, auth: null, pollTimer: null, turnstileWidget: null };

  const ERROR_MESSAGES = {
    invalid_email: "Cette adresse email n’est pas valide.",
    disposable_email: "Les adresses jetables ne sont pas acceptées.",
    captcha_failed: "La vérification anti-robot a échoué. Réessayez.",
    rate_limited: "Trop de tentatives depuis cette connexion. Réessayez dans une heure.",
    email_daily_limit: "Plusieurs liens ont déjà été envoyés à cette adresse aujourd’hui. Réessayez demain.",
    account_blocked: "Ce compte est bloqué.",
    forbidden: "Requête refusée par le serveur.",
  };

  const numberFormat = new Intl.NumberFormat("fr-FR");
  const dateFormat = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeZone: "Europe/Paris" });
  const dateTimeFormat = new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Paris",
  });
  const dayFormat = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" });
  let regionNames = null;
  try {
    regionNames = new Intl.DisplayNames(["fr"], { type: "region" });
  } catch {
    regionNames = null;
  }

  function el(tag, options = {}, children = []) {
    const node = document.createElement(tag);
    if (options.className) {
      node.className = options.className;
    }
    if (options.text !== undefined) {
      node.textContent = String(options.text);
    }
    if (options.title) {
      node.title = options.title;
    }
    for (const child of children) {
      if (child) {
        node.append(child);
      }
    }
    return node;
  }

  function formatNumber(value) {
    return numberFormat.format(Number(value || 0));
  }

  function formatDate(iso, withTime = false) {
    if (!iso) {
      return "—";
    }
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
      return "—";
    }
    return (withTime ? dateTimeFormat : dateFormat).format(date);
  }

  function countryName(code) {
    if (!code) {
      return "Inconnu";
    }
    try {
      return regionNames?.of(code) || code;
    } catch {
      return code;
    }
  }

  function placeLabel(place) {
    if (!place.country) {
      return "Lieu inconnu";
    }
    return place.city ? `${place.city}, ${countryName(place.country)}` : countryName(place.country);
  }

  function say(text) {
    $("adminStatus").textContent = text;
  }

  function bar(ratio, title) {
    const track = el("div", { className: "admin-bar", title });
    const fill = el("div", { className: "admin-bar-fill" });
    fill.style.width = `${Math.max(2, Math.round(ratio * 100))}%`;
    track.append(fill);
    return track;
  }

  function statCard(label, value, detail) {
    return el("div", { className: "admin-stat" }, [
      el("p", { className: "admin-stat-label", text: label }),
      el("p", { className: "admin-stat-value", text: value }),
      detail ? el("p", { className: "admin-stat-detail", text: detail }) : null,
    ]);
  }

  function renderStats(stats) {
    $("adminStats").replaceChildren(
      statCard("Utilisateurs", formatNumber(stats.users), `dont ${formatNumber(stats.blocked)} bloqué(s)`),
      statCard("Actifs aujourd’hui", formatNumber(stats.activeToday), `${formatNumber(stats.active30)} sur 30 jours`),
      statCard("Requêtes aujourd’hui", formatNumber(stats.requestsToday), "comptes connectés"),
      statCard("Requêtes sur 30 jours", formatNumber(stats.requests30), "comptes connectés"),
      statCard(
        "Visiteurs anonymes (30 j)",
        formatNumber(stats.anonymousDevices30),
        `appareils, ${formatNumber(stats.anonymousAnalyses30)} analyses gratuites`,
      ),
    );
  }

  function sortedUsers() {
    const query = $("userSearch").value.trim().toLowerCase();
    const status = $("userStatus").value;
    const sort = $("userSort").value;
    const users = state.data.users.filter((user) => {
      if (query && !user.email.toLowerCase().includes(query)) {
        return false;
      }
      if (status === "blocked") {
        return user.blocked;
      }
      if (status === "active") {
        return !user.blocked;
      }
      return true;
    });
    const key = {
      createdAt: (user) => user.createdAt || "",
      lastSeen: (user) => user.lastSeen || "",
      last30: (user) => user.requests.last30,
      total: (user) => user.requests.total,
    }[sort];
    return users.sort((a, b) => {
      const left = key(a);
      const right = key(b);
      return left < right ? 1 : left > right ? -1 : 0;
    });
  }

  function placesCell(user) {
    const cell = el("td", { className: "admin-places" });
    if (!user.places.length) {
      cell.textContent = "—";
      return cell;
    }
    for (const place of user.places) {
      cell.append(
        el("span", {
          text: placeLabel(place),
          title: `${formatNumber(place.requests)} requêtes, ${formatNumber(place.signIns)} connexions, vu le ${formatDate(place.lastSeen, true)}`,
        }),
      );
    }
    if (user.placeCount > user.places.length) {
      cell.append(el("span", { className: "source-note", text: `+ ${user.placeCount - user.places.length} autre(s)` }));
    }
    return cell;
  }

  function actionCell(user) {
    const cell = el("td");
    if (user.isAdmin) {
      return cell;
    }
    const button = el("button", {
      className: `page-button admin-action${user.blocked ? "" : " is-danger"}`,
      text: user.blocked ? "Débloquer" : "Bloquer",
    });
    button.type = "button";
    button.addEventListener("click", () => toggleBlock(user, button));
    cell.append(button);
    return cell;
  }

  function renderUsers() {
    const users = sortedUsers();
    const rows = users.map((user) => {
      const status = user.isAdmin
        ? el("span", { className: "admin-pill is-admin", text: "Admin" })
        : el("span", {
            className: `admin-pill${user.blocked ? " is-blocked" : ""}`,
            text: user.blocked ? "Bloqué" : "Actif",
            title: user.blocked ? `Bloqué le ${formatDate(user.blockedAt, true)}` : "",
          });
      const row = el("tr", { className: user.blocked ? "is-blocked" : "" }, [
        el("td", { className: "admin-email", text: user.email }),
        el("td", { text: formatDate(user.createdAt) }),
        el("td", { text: formatDate(user.lastSeen, true) }),
        el("td", { className: "is-number", text: formatNumber(user.requests.today) }),
        el("td", { className: "is-number", text: formatNumber(user.requests.last7) }),
        el("td", { className: "is-number", text: formatNumber(user.requests.last30) }),
        el("td", { className: "is-number", text: formatNumber(user.requests.total) }),
        placesCell(user),
        el("td", {}, [status]),
        actionCell(user),
      ]);
      row.dataset.userId = user.id;
      return row;
    });
    $("userRows").replaceChildren(...rows);
    $("userEmpty").hidden = rows.length > 0;
  }

  function renderDaily(daily) {
    const chart = $("dailyChart");
    const max = Math.max(1, ...daily.map((day) => day.requests));
    const total = daily.reduce((sum, day) => sum + day.requests, 0);
    chart.setAttribute("aria-label", `${formatNumber(total)} requêtes sur 30 jours, au plus ${formatNumber(max)} par jour.`);
    const columns = daily.map((day, index) => {
      const label = dayFormat.format(new Date(`${day.day}T12:00:00Z`));
      const column = el("div", {
        className: "admin-daily-col",
        title: `${label} : ${formatNumber(day.requests)} requêtes, ${formatNumber(day.users)} utilisateur(s)`,
      });
      const fill = el("div", { className: "admin-daily-bar" });
      fill.style.height = `${day.requests ? Math.max(3, Math.round((day.requests / max) * 100)) : 0}%`;
      column.append(el("div", { className: "admin-daily-track" }, [fill]));
      const showLabel = index === 0 || index === daily.length - 1 || index === Math.floor(daily.length / 2);
      column.append(el("span", { className: "admin-daily-label", text: showLabel ? label : "" }));
      return column;
    });
    const scale = el("p", { className: "admin-daily-max source-note", text: `max. ${formatNumber(max)} / jour` });
    chart.replaceChildren(scale, el("div", { className: "admin-daily-cols" }, columns));
  }

  function geoRows(target, items, label) {
    const max = Math.max(1, ...items.map((item) => item.users));
    const rows = items.map((item) =>
      el("tr", {}, [
        el("td", { text: label(item) }),
        el("td", { className: "is-number", text: formatNumber(item.users) }),
        el("td", { className: "is-number", text: formatNumber(item.requests) }),
        el("td", { className: "admin-bar-cell" }, [bar(item.users / max, `${item.users} utilisateur(s)`)]),
      ]),
    );
    if (!rows.length) {
      const empty = el("td", { className: "source-note", text: "Aucune donnée pour le moment." });
      empty.colSpan = 4;
      rows.push(el("tr", {}, [empty]));
    }
    $(target).replaceChildren(...rows);
  }

  function renderGeo(data) {
    const notes = {
      cloudflare: "Pays et ville fournis par Cloudflare à partir de l’adresse IP. L’adresse elle-même n’est pas conservée.",
      mmdb: "Pays et ville déduits de l’adresse IP avec la base DB-IP Lite (précision indicative, surtout pour la ville). L’adresse elle-même n’est pas conservée.",
    };
    $("geoNote").textContent =
      notes[data.geoSource] ||
      "Aucune source de géolocalisation : lancez « npm run geoip » dans server/ (base DB-IP Lite gratuite) ou, si le serveur n’est joignable que par Cloudflare, réglez TRUST_PROXY=cloudflare. En attendant, les lieux restent inconnus.";
    $("geoCredit").hidden = data.geoSource !== "mmdb";
    geoRows("countryRows", data.countries, (item) => countryName(item.country));
    geoRows("cityRows", data.cities, (item) => placeLabel(item));
  }

  const SPOOFED_IP = "203.0.113.7";

  async function fetchIpCheck(headers = {}) {
    const response = await fetch("/api/admin/ip-check", {
      credentials: "include",
      headers: { Accept: "application/json", ...headers },
    }).catch(() => null);
    const report = response?.ok ? await response.json().catch(() => null) : null;
    return { report, status: response?.status || 0 };
  }

  async function loadIpCheck() {
    const { report } = await fetchIpCheck();
    if (!report) {
      $("ipSuggestion").textContent = "Diagnostic indisponible.";
      return;
    }
    const modes = {
      off: "TRUST_PROXY=0 : l’adresse de la connexion est utilisée telle quelle",
      proxies: `TRUST_PROXY=${report.proxyHops} : ${report.proxyHops} proxy(s) de confiance dans X-Forwarded-For`,
      cloudflare: "TRUST_PROXY=cloudflare : l’adresse vient de CF-Connecting-IP",
    };
    $("ipMode").textContent = modes[report.mode] || report.mode;
    $("ipUsed").textContent = report.usedIp;
    $("ipSocket").textContent = report.socketIp;
    $("ipForwarded").textContent = report.forwardedFor.length
      ? report.forwardedFor.map((ip, index) => `${ip} (n°${report.forwardedFor.length - index} depuis la droite)`).join(", ")
      : "absent";
    $("ipCloudflare").textContent = report.cfConnectingIp
      ? `${report.cfConnectingIp}${report.cfCountry ? ` (pays : ${report.cfCountry})` : ""}`
      : "absent";
    const current = report.mode === "proxies" ? String(report.proxyHops) : report.mode === "cloudflare" ? "cloudflare" : "0";
    const settled = current === report.suggestion.trustProxy && report.usedIp === report.suggestion.visitorIp;
    $("ipSuggestion").textContent = settled
      ? `Votre adresse probable : ${report.usedIp}. Le réglage actuel (TRUST_PROXY=${current}) retient bien cette adresse.`
      : `Votre adresse probable : ${report.suggestion.visitorIp}. Valeur suggérée : TRUST_PROXY=${report.suggestion.trustProxy}.`;
    $("ipSuggestionReason").textContent = report.suggestion.reason;
  }

  async function spoofTest() {
    const result = $("ipSpoofResult");
    result.hidden = false;
    result.textContent = "Test en cours…";
    const { report: honest } = await fetchIpCheck();
    if (!honest) {
      result.textContent = "Test impossible : le serveur n’a pas répondu.";
      return;
    }
    // Cloudflare refuses some requests that carry their own CF-Connecting-IP: only forge it when it is trusted.
    const forgedHeaders = { "X-Forwarded-For": SPOOFED_IP };
    if (honest.mode === "cloudflare") {
      forgedHeaders["CF-Connecting-IP"] = SPOOFED_IP;
    }
    const { report: forged, status } = await fetchIpCheck(forgedHeaders);
    if (!forged) {
      result.textContent = status
        ? `La requête contenant une fausse adresse a été refusée avant d’atteindre le serveur (HTTP ${status}) : elle ne peut donc pas tromper le serveur, mais le test n’a pas pu comparer les adresses.`
        : "Test impossible : la requête contenant une fausse adresse n’a pas abouti.";
      return;
    }
    result.textContent =
      forged.usedIp === honest.usedIp && forged.usedIp !== SPOOFED_IP
        ? `Réussi : en envoyant une fausse adresse (${SPOOFED_IP}), le serveur garde ${honest.usedIp}.`
        : `Échec : le serveur a retenu ${forged.usedIp} au lieu de ${honest.usedIp}. Un visiteur peut choisir son adresse : TRUST_PROXY est trop élevé.`;
  }

  function describeJob(job) {
    if (!job) {
      return "";
    }
    if (!job.finishedAt) {
      return `Envoi en cours (lancé ${formatDate(job.startedAt, true)} par ${job.startedBy})…`;
    }
    if (job.error) {
      return `Dernier envoi interrompu : ${job.error}`;
    }
    return `Dernier envoi ${formatDate(job.finishedAt, true)} : ${formatNumber(job.run?.sent)} email(s) envoyé(s), ${formatNumber(job.run?.failed)} échec(s).`;
  }

  async function loadAlerts() {
    const response = await fetch("/api/admin/alerts", { credentials: "include", headers: { Accept: "application/json" } }).catch(() => null);
    const data = response?.ok ? await response.json().catch(() => null) : null;
    if (!data) {
      $("alertSummary").textContent = "Aperçu indisponible (base d’analyse absente ?).";
      return;
    }
    const { preview } = data;
    $("alertSummary").textContent =
      `${formatNumber(data.follows)} suivi(s) par ${formatNumber(data.followers)} compte(s). ` +
      `Données jusqu’au ${formatDate(preview.through)} : ${formatNumber(preview.recipients)} compte(s) à prévenir, ${formatNumber(preview.upToDate)} à jour.`;
    $("alertPreview").replaceChildren(
      ...preview.preview.map((item) => el("li", { text: `${item.email} : « ${item.subject} »` })),
    );
    $("alertTop").replaceChildren(
      ...data.top.map((row) =>
        el("tr", {}, [el("td", { text: `${row.name} (${row.party})` }), el("td", { className: "is-number", text: formatNumber(row.followers) })]),
      ),
    );
    const running = data.job && !data.job.finishedAt;
    const button = $("alertSend");
    button.disabled = !data.hasMailer || running || !preview.recipients;
    button.title = data.hasMailer ? "" : "RESEND_API_KEY et EMAIL_FROM manquent : aucun email ne peut partir.";
    $("alertJob").textContent = data.hasMailer ? describeJob(data.job) : "Envoi impossible : aucun service d’email configuré.";
    clearTimeout(state.alertTimer);
    if (running) {
      state.alertTimer = setTimeout(loadAlerts, 3000);
    }
  }

  async function sendAlerts() {
    if (!window.confirm("Envoyer les alertes maintenant ? Chaque compte concerné recevra un email.")) {
      return;
    }
    $("alertSend").disabled = true;
    const response = await fetch("/api/admin/alerts/send", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: "{}",
    }).catch(() => null);
    if (!response?.ok) {
      say("L’envoi des alertes n’a pas pu démarrer.");
    }
    loadAlerts();
  }

  async function loadCampaigns() {
    const response = await fetch("/api/admin/campaigns", { credentials: "include", headers: { Accept: "application/json" } }).catch(() => null);
    const data = response?.ok ? await response.json().catch(() => null) : null;
    if (!data) {
      $("campaignSummary").textContent = "Mesure indisponible.";
      return;
    }
    $("campaignSummary").textContent = data.total
      ? `${formatNumber(data.total)} visite(s) sur ${data.days} jours : ` +
        data.sources.map((row) => `${row.source} ${formatNumber(row.visits)}`).join(", ") +
        "."
      : `Aucune visite par un lien marqué sur ${data.days} jours.`;
    $("campaignRows").replaceChildren(
      ...data.campaigns.map((row) =>
        el("tr", {}, [
          el("td", { text: row.source || "—" }),
          el("td", { text: row.medium || "—" }),
          el("td", { text: row.campaign || "—" }),
          el("td", { className: "is-number", text: formatNumber(row.visits) }),
          el("td", { className: "is-number", text: formatNumber(row.last7) }),
          el("td", { text: formatDate(row.lastDay) }),
        ]),
      ),
    );
  }

  function render() {
    const data = state.data;
    $("adminLogin").hidden = true;
    $("adminContent").hidden = false;
    $("adminSession").hidden = false;
    $("adminEmail").textContent = data.me.email;
    say(`Données au ${formatDate(data.generatedAt, true)}.`);
    renderStats(data.stats);
    renderUsers();
    renderDaily(data.daily);
    renderGeo(data);
    loadIpCheck();
    loadAlerts();
    loadCampaigns();
  }

  function mountTurnstile() {
    const siteKey = state.auth?.turnstileSiteKey;
    const slot = $("adminTurnstile");
    if (!siteKey || state.turnstileWidget !== null) {
      return;
    }
    slot.hidden = false;
    const renderWidget = () => {
      if (state.turnstileWidget === null && window.turnstile) {
        state.turnstileWidget = window.turnstile.render(slot, { sitekey: siteKey, language: "fr" });
      }
    };
    if (window.turnstile) {
      renderWidget();
      return;
    }
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
    script.async = true;
    script.addEventListener("load", renderWidget);
    document.head.append(script);
  }

  function showLogin(auth, text) {
    state.auth = auth || state.auth;
    state.data = null;
    $("adminContent").hidden = true;
    $("adminLogin").hidden = false;
    say(text || "Connectez-vous avec une adresse administrateur.");
    mountTurnstile();
  }

  function loginMessage(text) {
    const message = $("adminLoginMessage");
    message.textContent = text;
    message.hidden = !text;
  }

  async function load() {
    let response;
    try {
      response = await fetch("/api/admin/overview", { credentials: "include", headers: { Accept: "application/json" } });
    } catch {
      say("Le serveur ne répond pas. Réessayez dans un instant.");
      return false;
    }
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401) {
      $("adminSession").hidden = true;
      showLogin(payload.auth);
      return false;
    }
    if (response.status === 403 && payload.error === "not_admin") {
      $("adminSession").hidden = false;
      $("adminEmail").textContent = payload.session?.email || "";
      showLogin(null, `${payload.session?.email || "Ce compte"} n’est pas une adresse administrateur. Connectez-vous avec une autre adresse.`);
      return false;
    }
    if (!response.ok) {
      say("Impossible de charger les données d’administration.");
      return false;
    }
    stopPolling();
    state.data = payload;
    render();
    return true;
  }

  function stopPolling() {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }

  async function sendLink(event) {
    event.preventDefault();
    const email = $("adminLoginEmail").value.trim();
    const button = $("adminLoginSubmit");
    button.disabled = true;
    loginMessage("");
    try {
      const token =
        window.turnstile && state.turnstileWidget !== null ? window.turnstile.getResponse(state.turnstileWidget) || "" : "";
      const response = await fetch("/api/register", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ email, website: $("adminLoginWebsite").value, turnstileToken: token, returnTo: "/admin" }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        loginMessage(
          payload.error === "resend_cooldown"
            ? `Un lien vient d’être envoyé. Nouvel essai possible dans ${payload.retryAfter || 60} secondes.`
            : ERROR_MESSAGES[payload.error] || "L’envoi du lien a échoué.",
        );
        return;
      }
      loginMessage(`Lien envoyé à ${email}. Ouvrez-le dans ce navigateur : la page se met à jour toute seule.`);
      const dev = $("adminDevLink");
      dev.hidden = !payload.devLink;
      if (payload.devLink) {
        dev.querySelector("a").href = payload.devLink;
      }
      stopPolling();
      state.pollTimer = setInterval(load, 4000);
    } finally {
      button.disabled = false;
      if (window.turnstile && state.turnstileWidget !== null) {
        window.turnstile.reset(state.turnstileWidget);
      }
    }
  }

  async function toggleBlock(user, button) {
    const blocking = !user.blocked;
    const question = blocking
      ? `Bloquer ${user.email} ? Ses sessions sont fermées tout de suite et il ne pourra plus se reconnecter.`
      : `Débloquer ${user.email} ? Il pourra de nouveau se connecter avec son adresse.`;
    if (!window.confirm(question)) {
      return;
    }
    button.disabled = true;
    const response = await fetch(`/api/admin/users/${encodeURIComponent(user.id)}/${blocking ? "block" : "unblock"}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: "{}",
    }).catch(() => null);
    if (!response?.ok) {
      button.disabled = false;
      say(blocking ? "Le blocage a échoué." : "Le déblocage a échoué.");
      return;
    }
    await load();
    say(`${user.email} est ${blocking ? "bloqué" : "débloqué"}.`);
  }

  async function signOut() {
    await fetch("/api/auth/sign-out", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }).catch(() => null);
    $("adminSession").hidden = true;
    load();
  }

  $("adminLoginForm").addEventListener("submit", sendLink);
  $("adminRefresh").addEventListener("click", () => load());
  $("adminSignOut").addEventListener("click", () => signOut());
  $("ipSpoofTest").addEventListener("click", () => spoofTest());
  $("alertSend").addEventListener("click", () => sendAlerts());
  for (const id of ["userSearch", "userStatus", "userSort"]) {
    $(id).addEventListener("input", () => state.data && renderUsers());
  }
  load();
})();
