(function accountPage() {
  const status = document.getElementById("accountStatus");
  const actions = document.getElementById("accountActions");
  const message = document.getElementById("accountMessage");
  if (!status || !actions) {
    return;
  }

  function say(text) {
    message.textContent = text;
    message.hidden = !text;
  }

  async function refresh() {
    try {
      const response = await fetch("/api/quota", { credentials: "include", headers: { Accept: "application/json" } });
      const payload = await response.json();
      if (payload.session?.email) {
        status.textContent = `Connecté avec ${payload.session.email}.`;
        actions.hidden = false;
      } else {
        const remaining = payload.quota?.remaining;
        status.textContent =
          remaining === undefined
            ? "Vous n’êtes pas connecté."
            : `Vous n’êtes pas connecté. Analyses gratuites restantes sur cet appareil : ${remaining}.`;
        actions.hidden = true;
      }
    } catch {
      status.textContent = "Impossible de vérifier votre session pour le moment.";
    }
  }

  document.getElementById("signOutButton")?.addEventListener("click", async () => {
    await fetch("/api/auth/sign-out", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    say("Vous êtes déconnecté.");
    refresh();
  });

  document.getElementById("deleteAccountButton")?.addEventListener("click", async () => {
    if (!window.confirm("Supprimer définitivement votre compte et votre adresse email ?")) {
      return;
    }
    const response = await fetch("/api/account/delete", { method: "POST", credentials: "include" });
    say(response.ok ? "Votre compte et votre adresse ont été supprimés." : "La suppression a échoué. Réessayez.");
    refresh();
  });

  refresh();
})();
