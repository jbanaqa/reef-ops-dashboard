/* Install with data-endpoint pointing to /api/marketing/storefront. */
(() => {
  const script = document.currentScript,
    endpoint = script?.dataset.endpoint;
  if (!endpoint) return;
  const storage = {
    get: (k) => {
      try {
        return localStorage.getItem(k);
      } catch {
        return null;
      }
    },
    set: (k, v) => {
      try {
        localStorage.setItem(k, v);
      } catch {}
    },
    remove: (k) => {
      try {
        localStorage.removeItem(k);
      } catch {}
    },
  };
  const anonymousId = storage.get("reef-marketing-anon") || crypto.randomUUID();
  storage.set("reef-marketing-anon", anonymousId);
  const post = async (body) => {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, anonymousId }),
    });
    const data = await response.json();
    if (!response.ok)
      throw Error(data.error || "Signup is temporarily unavailable.");
    return data;
  };
  const event = (type) =>
    post({
      action: "event",
      type,
      id: crypto.randomUUID(),
      device: innerWidth < 700 ? "mobile" : "desktop",
    }).catch(() => {});
  // Invoke behavior tracking only after the storefront grants analytics permission.
  window.reefMarketingEvent = (type, productId) =>
    post({ action: "event", type, productId, id: crypto.randomUUID() }).catch(
      () => {},
    );
  const pending = storage.get("reef-marketing-session");
  if (
    !pending &&
    (script.dataset.knownCustomer === "true" ||
      storage.get("reef-marketing-submitted"))
  )
    return;
  if (
    !pending &&
    Date.now() - Number(storage.get("reef-marketing-dismissed") || 0) <
      7 * 86400000
  )
    return;
  setTimeout(
    async () => {
      try {
        if (!(await post({ action: "config" })).enabled) return;
      } catch {
        return;
      }
      const dialog = document.createElement("dialog");
      dialog.style.cssText =
        "border:0;border-radius:18px;padding:28px;max-width:440px;width:calc(100% - 32px);font-family:Arial;color:#163b3b;box-shadow:0 20px 80px #0005";
      dialog.innerHTML =
        '<button aria-label="Close" style="float:right;border:0;background:transparent;font-size:24px">×</button><h2>Welcome to Corals Anonymous</h2><div class="reef-signup-step"></div><p role="status"></p>';
      const panel = dialog.querySelector(".reef-signup-step"),
        status = dialog.querySelector('[role="status"]');
      let session = pending,
        closed = false;
      const finish = () => {
        storage.set("reef-marketing-submitted", "1");
        storage.remove("reef-marketing-session");
        session = null;
      };
      const close = () => {
        closed = true;
        storage.set("reef-marketing-dismissed", String(Date.now()));
        event("FORM_DISMISSED");
        window.removeEventListener("focus", refresh);
        dialog.close();
        dialog.remove();
      };
      const sms = () => {
        panel.innerHTML =
          '<p>Email confirmed. Add optional text alerts:</p><form><label>Phone (include country code)<input name="phone" type="tel" required></label><label><input name="consent" type="checkbox" required> I agree to recurring automated marketing texts. Consent is not a condition of purchase. Message and data rates may apply. Reply STOP to cancel.</label><p><button type="submit">Sign up for texts</button><button type="button">No thanks</button></p></form>';
        const form = panel.querySelector("form");
        form.querySelector('[type="button"]').onclick = () => {
          finish();
          close();
        };
        form.onsubmit = async (e) => {
          e.preventDefault();
          const button = form.querySelector('[type="submit"]');
          button.disabled = true;
          try {
            const f = new FormData(form);
            await post({
              action: "sms",
              session,
              phone: f.get("phone"),
              smsConsent: f.get("consent") === "on",
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            });
            finish();
            panel.textContent = "You are signed up for text alerts.";
            status.textContent = "";
          } catch (error) {
            status.textContent = error.message;
            button.disabled = false;
          }
        };
      };
      const waiting = () => {
        panel.innerHTML =
          '<p>If this address is eligible, check your inbox to confirm signup. Your offer follows confirmation.</p><button type="button">I confirmed my email</button><p><button type="button" class="retry">Use a different email or try again later</button></p>';
        panel.querySelector("button").onclick = refresh;
        panel.querySelector(".retry").onclick = () => {
          storage.remove("reef-marketing-session");
          session = null;
          emailForm();
        };
      };
      async function refresh() {
        if (!session || closed) return;
        try {
          const result = await post({ action: "status", session });
          if (closed) return;
          if (result.confirmed) {
            if (result.smsEnabled) sms();
            else {
              finish();
              panel.textContent =
                "Email confirmed. Your offer will arrive by email.";
            }
            status.textContent = "";
          } else {
            status.textContent = result.known
              ? "Confirmation is still pending. Check your inbox, then try again."
              : "This signup cannot be resumed. You can request another email when eligible.";
          }
        } catch (error) {
          status.textContent = error.message;
        }
      }
      function emailForm() {
        status.textContent = "";
        panel.innerHTML =
          '<p>Get 10% off your first order after confirming your email.</p><form><label>Email <input name="email" type="email" required></label><label><input type="checkbox" name="consent" required> I agree to receive marketing emails.</label><input name="website" tabindex="-1" aria-hidden="true" style="display:none"><p><button type="submit">Sign up</button></p></form>';
        const form = panel.querySelector("form");
        form.onsubmit = async (e) => {
          e.preventDefault();
          const button = form.querySelector("button");
          button.disabled = true;
          try {
            const f = new FormData(form);
            const result = await post({
              action: "signup",
              email: f.get("email"),
              emailConsent: f.get("consent") === "on",
              website: f.get("website"),
            });
            session = result.session;
            storage.set("reef-marketing-session", session);
            waiting();
            status.textContent = result.message;
          } catch (error) {
            status.textContent = error.message;
            button.disabled = false;
          }
        };
      }
      dialog.querySelector("button").onclick = close;
      dialog.addEventListener("cancel", (e) => {
        e.preventDefault();
        close();
      });
      dialog.addEventListener("click", (e) => {
        if (e.target === dialog) {
          const r = dialog.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            close();
        }
      });
      document.body.append(dialog);
      dialog.showModal();
      event("FORM_VIEWED");
      window.addEventListener("focus", refresh);
      if (session) {
        waiting();
        await refresh();
      } else emailForm();
    },
    pending ? 0 : 10000,
  );
})();
