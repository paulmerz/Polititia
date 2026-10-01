// Access layer: metered API calls, the free-analysis counter, the email
// verification gate and the account menu. app.js only calls PolititiaGate.view().
window.PolititiaGate = (function createGate() {
  const state = {
    quota: { limit: 10, used: 0, remaining: 10, unlimited: false },
    session: null,
    auth: { verification: true, exposeMagicLink: false, turnstileSiteKey: null, resendCooldown: 60 },
    email: "",
    resendAt: 0,
    pendingRetry: null,
  };
  const cache = new Map();
  let pollTimer = null;
  let countdownTimer = null;
  let turnstileWidget = null;

  const ERROR_MESSAGES = {
    invalid_email: "Cette adresse email n’est pas valide.",
    disposable_email: "Les adresses jetables (boîtes temporaires) ne sont pas acceptées : elles ne permettent pas de vérifier qu’une personne réelle se connecte.",
    captcha_failed: "La vérification anti-robot a échoué. Réessayez.",
    rate_limited: "Trop de tentatives depuis cette connexion. Réessayez dans une heure.",
    forbidden: "Requête refusée par le serveur.",
    invalid_json: "Requête invalide.",
  };

  function $(id) {
    return document.getElementById(id);
  }

  function newInteractionId() {
    if (window.crypto?.randomUUID) {
      return window.crypto.randomUUID();
    }
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function plural(count, singular, pluralForm) {
    return `${count} ${count > 1 ? pluralForm : singular}`;
  }

  function renderChip() {
    const chip = $("quotaChip");
    const account = $("accountButton");
    if (!chip || !account) {
      return;
    }
    if (state.session?.email) {
      chip.hidden = true;
      account.hidden = false;
      account.textContent = state.session.email;
      return;
    }
    account.hidden = true;
    chip.hidden = false;
    const remaining = Math.max(0, Number(state.quota.remaining || 0));
    chip.textContent = remaining
      ? `${plural(remaining, "analyse gratuite restante", "analyses gratuites restantes")}`
      : "Analyses gratuites épuisées";
    chip.title = `Chaque analyse (un député, un groupe, un thème ou une période) compte une fois. Revoir une analyse déjà consultée est gratuit. Au-delà de ${state.quota.limit || 10}, l’accès reste gratuit après confirmation d’un email.`;
    chip.classList.toggle("is-low", remaining <= 3);
  }

  function updateFrom(payload) {
    if (payload?.quota) {
      state.quota = payload.quota;
    }
    if (payload?.session !== undefined) {
      state.session = payload.session;
    }
    if (payload?.auth) {
      state.auth = { ...state.auth, ...payload.auth };
    }
    renderChip();
  }

  class GateError extends Error {
    constructor(code, payload) {
      super(code);
      this.code = code;
      this.payload = payload;
    }
  }

  // One user action = one interaction id, shared by every request it triggers,
  // so the server counts the action once.
  async function view(path, { interactionId, retry } = {}) {
    if (cache.has(path)) {
      return cache.get(path);
    }
    const response = await fetch(path, {
      credentials: "include",
      headers: { Accept: "application/json", "X-Interaction-Id": interactionId || newInteractionId() },
    });
    const payload = await response.json().catch(() => ({}));
    if (payload.quota || payload.session !== undefined) {
      updateFrom(payload);
    }
    if (response.status === 429 && payload.error === "quota_exceeded") {
      state.pendingRetry = retry || null;
      show();
      throw new GateError("quota_exceeded", payload);
    }
    if (!response.ok) {
      throw new GateError(payload.error || "request_failed", payload);
    }
    cache.set(path, payload);
    return payload;
  }

  function showError(message) {
    const error = $("gateError");
    if (error) {
      error.textContent = message || "";
      error.hidden = !message;
    }
  }

  function setStep(step) {
    $("gateForm").hidden = step !== "form";
    $("gateCheck").hidden = step !== "check";
  }

  function show() {
    const dialog = $("accessGate");
    const limit = state.quota?.limit || 10;
    $("gateLead").textContent = `Vous avez utilisé vos ${limit} analyses gratuites. La suite reste gratuite et illimitée : il suffit de confirmer votre adresse email.`;
    showError("");
    setStep(state.email && Date.now() < state.resendAt + 15 * 60 * 1000 ? "check" : "form");
    if (!dialog.open) {
      dialog.showModal();
    }
    mountTurnstile();
    if (!$("gateForm").hidden) {
      $("gateEmail")?.focus();
    }
  }

  function hide() {
    $("accessGate")?.close();
    stopPolling();
  }

  function mountTurnstile() {
    const siteKey = state.auth.turnstileSiteKey;
    const slot = $("gateTurnstile");
    if (!siteKey || !slot) {
      return;
    }
    slot.hidden = false;
    const render = () => {
      if (turnstileWidget === null && window.turnstile) {
        turnstileWidget = window.turnstile.render(slot, { sitekey: siteKey, language: "fr" });
      }
    };
    if (window.turnstile) {
      render();
      return;
    }
    if (!document.querySelector("script[data-turnstile]")) {
      const script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
      script.async = true;
      script.dataset.turnstile = "true";
      script.addEventListener("load", render);
      document.head.appendChild(script);
    }
  }

  function turnstileToken() {
    if (!state.auth.turnstileSiteKey || !window.turnstile || turnstileWidget === null) {
      return "";
    }
    return window.turnstile.getResponse(turnstileWidget) || "";
  }

  function renderCountdown() {
    const button = $("gateResend");
    if (!button) {
      return;
    }
    const wait = Math.ceil((state.resendAt - Date.now()) / 1000);
    if (wait > 0) {
      button.disabled = true;
      button.textContent = `Renvoyer le lien (${wait} s)`;
      return;
    }
    button.disabled = false;
    button.textContent = "Renvoyer le lien";
    clearInterval(countdownTimer);
    countdownTimer = null;
  }

  function startCountdown(seconds) {
    state.resendAt = Date.now() + seconds * 1000;
    clearInterval(countdownTimer);
    countdownTimer = setInterval(renderCountdown, 1000);
    renderCountdown();
  }

  async function refreshSession() {
    const response = await fetch("/api/quota", { credentials: "include", headers: { Accept: "application/json" } });
    const payload = await response.json().catch(() => ({}));
    updateFrom(payload);
    return payload;
  }

  // The magic link may be opened in another tab: watch for the session cookie.
  function startPolling() {
    stopPolling();
    pollTimer = setInterval(async () => {
      const payload = await refreshSession().catch(() => null);
      if (payload?.session?.email) {
        unlocked();
      }
    }, 4000);
  }

  function stopPolling() {
    clearInterval(pollTimer);
    pollTimer = null;
  }

  function unlocked() {
    stopPolling();
    hide();
    cache.clear();
    const retry = state.pendingRetry;
    state.pendingRetry = null;
    window.dispatchEvent(new CustomEvent("polititia:unlocked"));
    if (retry) {
      retry();
    }
  }

  async function register(email, website) {
    const response = await fetch("/api/register", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ email, website, turnstileToken: turnstileToken(), returnTo: window.location.search }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (payload.error === "resend_cooldown") {
        startCountdown(Number(payload.retryAfter || state.auth.resendCooldown || 60));
        throw new Error(`Un lien vient déjà d’être envoyé à cette adresse. Vous pourrez en demander un nouveau dans ${payload.retryAfter || 60} secondes.`);
      }
      throw new Error(ERROR_MESSAGES[payload.error] || "L’envoi du lien a échoué. Réessayez dans un instant.");
    }
    return payload;
  }

  function showCheckStep(email, payload) {
    state.email = email;
    $("gateSentTo").textContent = email;
    const devBox = $("gateDevLink");
    if (payload.devLink) {
      devBox.hidden = false;
      devBox.querySelector("a").href = payload.devLink;
    } else {
      devBox.hidden = true;
    }
    setStep("check");
    startCountdown(Number(payload.resendIn || state.auth.resendCooldown || 60));
    startPolling();
  }

  async function submit(email) {
    const button = $("gateSubmit");
    showError("");
    button.disabled = true;
    try {
      const payload = await register(email, String($("gateWebsite")?.value || ""));
      showCheckStep(email, payload);
    } catch (error) {
      showError(error instanceof Error ? error.message : "L’envoi du lien a échoué.");
    } finally {
      button.disabled = false;
      if (window.turnstile && turnstileWidget !== null) {
        window.turnstile.reset(turnstileWidget);
      }
    }
  }

  async function resend() {
    const message = $("gateCheckMessage");
    try {
      const payload = await register(state.email, "");
      showCheckStep(state.email, payload);
      message.textContent = "Nouveau lien envoyé. Seul le plus récent fonctionne.";
    } catch (error) {
      message.textContent = error instanceof Error ? error.message : "L’envoi du lien a échoué.";
    }
    message.hidden = false;
  }

  function toast(message, kind = "info") {
    const box = $("toast");
    if (!box) {
      return;
    }
    box.textContent = message;
    box.dataset.kind = kind;
    box.hidden = false;
    clearTimeout(box.timer);
    box.timer = setTimeout(() => {
      box.hidden = true;
    }, 7000);
  }

  function openAccount() {
    $("accountEmail").textContent = state.session?.email || "";
    $("accountMessage").hidden = true;
    $("accountDialog").showModal();
  }

  async function signOut() {
    await fetch("/api/auth/sign-out", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    window.location.reload();
  }

  async function deleteAccount() {
    const confirmed = window.confirm(
      "Supprimer définitivement votre compte ? Votre adresse email et vos sessions seront effacées immédiatement.",
    );
    if (!confirmed) {
      return;
    }
    const response = await fetch("/api/account/delete", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const message = $("accountMessage");
    if (response.ok) {
      message.textContent = "Votre compte a été supprimé.";
      message.hidden = false;
      setTimeout(() => window.location.reload(), 1500);
      return;
    }
    message.textContent = "La suppression a échoué. Réessayez ou écrivez-nous.";
    message.hidden = false;
  }

  // Better Auth redirects to /?verifie=1 once the link is verified, or adds
  // ?error=... when the link is expired or already used.
  function readVerificationResult() {
    const params = new URLSearchParams(window.location.search);
    let changed = false;
    if (params.has("verifie")) {
      toast("Adresse confirmée : l’accès est désormais illimité.", "success");
      params.delete("verifie");
      changed = true;
    }
    if (params.has("error")) {
      toast("Ce lien a expiré ou a déjà servi. Demandez-en un nouveau.", "error");
      params.delete("error");
      changed = true;
    }
    if (changed) {
      const query = params.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
    }
  }

  function bind() {
    $("gateForm")?.addEventListener("submit", (event) => {
      event.preventDefault();
      submit(String($("gateEmail")?.value || "").trim());
    });
    $("gateResend")?.addEventListener("click", () => resend());
    $("gateChangeEmail")?.addEventListener("click", () => {
      stopPolling();
      setStep("form");
      $("gateEmail")?.focus();
    });
    $("gateDone")?.addEventListener("click", async () => {
      const payload = await refreshSession().catch(() => null);
      if (payload?.session?.email) {
        unlocked();
        return;
      }
      const message = $("gateCheckMessage");
      message.textContent = "Pas encore confirmé. Ouvrez le lien reçu dans ce navigateur, puis revenez ici.";
      message.hidden = false;
    });
    $("closeGate")?.addEventListener("click", () => hide());
    $("accessGate")?.addEventListener("close", () => stopPolling());
    $("accountButton")?.addEventListener("click", () => openAccount());
    $("closeAccount")?.addEventListener("click", () => $("accountDialog").close());
    $("signOutButton")?.addEventListener("click", () => signOut());
    $("deleteAccountButton")?.addEventListener("click", () => deleteAccount());
    readVerificationResult();
  }

  return { state, updateFrom, view, newInteractionId, show, hide, bind, renderChip, toast, GateError };
})();
