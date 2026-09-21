window.PolititiaGate = (function createGate() {
  const state = {
    quota: { limit: 10, used: 0, remaining: 10, unlimited: false },
    session: null,
    auth: { trustEmail: true, hasMailer: false },
  };

  function $(id) {
    return document.getElementById(id);
  }

  function renderChip() {
    const chip = $("quotaChip");
    const sessionLabel = $("sessionLabel");
    if (!chip || !sessionLabel) {
      return;
    }
    if (state.session?.email) {
      chip.hidden = true;
      sessionLabel.hidden = false;
      sessionLabel.textContent = state.session.email;
      return;
    }
    sessionLabel.hidden = true;
    chip.hidden = false;
    const remaining = Number(state.quota.remaining || 0);
    const limit = Number(state.quota.limit || 10);
    chip.textContent = `${remaining}/${limit} analyses`;
    chip.classList.toggle("is-low", remaining <= 2);
  }

  function updateFrom(payload) {
    if (payload?.quota) {
      state.quota = payload.quota;
    }
    if (payload?.session !== undefined) {
      state.session = payload.session;
    }
    if (payload?.auth) {
      state.auth = payload.auth;
    }
    const copy = $("gateCopy");
    if (copy && state.quota?.limit) {
      copy.textContent = `Vous avez utilisé vos ${state.quota.limit} analyses gratuites. L’accès illimité s’ouvre avec un email — c’est la seule contrepartie.`;
    }
    renderChip();
  }

  function showError(message) {
    const error = $("gateError");
    if (!error) {
      return;
    }
    error.textContent = message || "";
    error.hidden = !message;
  }

  function show() {
    const dialog = $("accessGate");
    const hint = $("gateHint");
    if (hint) {
      hint.textContent = state.auth.trustEmail
        ? "L’email débloque l’accès. C’est l’unique contrepartie demandée."
        : "Un lien de connexion va être envoyé à cette adresse.";
    }
    showError("");
    dialog?.showModal();
    $("gateEmail")?.focus();
  }

  function hide() {
    $("accessGate")?.close();
  }

  async function parseResponse(response) {
    const payload = await response.json().catch(() => ({}));
    if (payload.quota || payload.session) {
      updateFrom(payload);
    }
    return payload;
  }

  class GateError extends Error {
    constructor(code, payload) {
      super(code);
      this.code = code;
      this.payload = payload;
    }
  }

  async function fetchPolitician(id) {
    const response = await fetch(`/api/politician/${encodeURIComponent(id)}`, {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    const payload = await parseResponse(response);
    if (response.status === 429 || payload.error === "quota_exceeded") {
      show();
      throw new GateError("quota_exceeded", payload);
    }
    if (!response.ok) {
      throw new GateError(payload.error || "request_failed", payload);
    }
    return payload;
  }

  async function register(email) {
    const response = await fetch("/api/register", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ email }),
    });
    const payload = await parseResponse(response);
    if (!response.ok) {
      const messages = {
        invalid_email: "Email invalide.",
        rate_limited: "Trop de tentatives. Réessayez plus tard.",
        forbidden: "Requête bloquée.",
        mailer_unconfigured: "Envoi d’email indisponible.",
      };
      throw new Error(messages[payload.error] || "Inscription impossible.");
    }
    if (payload.session) {
      state.session = { email };
      state.quota = { limit: 0, used: 0, remaining: 0, unlimited: true };
      renderChip();
    }
    return payload;
  }

  function bind() {
    $("gateForm")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const submit = $("gateSubmit");
      const email = String($("gateEmail")?.value || "");
      showError("");
      if (submit) {
        submit.disabled = true;
      }
      try {
        const result = await register(email);
        if (result.checkEmail) {
          showError("Vérifiez votre boîte mail pour le lien d’accès.");
          return;
        }
        hide();
        window.dispatchEvent(new CustomEvent("polititia:unlocked"));
      } catch (error) {
        showError(error instanceof Error ? error.message : "Inscription impossible.");
      } finally {
        if (submit) {
          submit.disabled = false;
        }
      }
    });
    $("closeGate")?.addEventListener("click", () => hide());
  }

  return { state, updateFrom, show, hide, fetchPolitician, register, bind, renderChip };
})();
