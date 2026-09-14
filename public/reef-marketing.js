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
  const artwork = (() => {
    try {
      return new URL("welcome-popup-art.png", script.src).href;
    } catch {
      return "";
    }
  })();
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
  (async () => {
      let singleOptIn = false;
      let couponDays = 14;
      let dismissalDays = 7;
      let delaySeconds = 10;
      try {
        const config = await post({ action: "config" });
        if (!config.enabled) return;
        singleOptIn = config.singleOptIn === true;
        couponDays = config.couponDays || 14;
        dismissalDays = Number.isInteger(config.dismissalDays)
          ? Math.max(0, Math.min(30, config.dismissalDays))
          : 7;
        delaySeconds = Number.isInteger(config.delaySeconds)
          ? Math.max(0, Math.min(300, config.delaySeconds))
          : 10;
      } catch {
        return;
      }
      await new Promise((resolve) =>
        setTimeout(resolve, pending ? 0 : delaySeconds * 1000),
      );
      if (
        !pending &&
        dismissalDays > 0 &&
        Date.now() - Number(storage.get("reef-marketing-dismissed") || 0) <
          dismissalDays * 86400000
      )
        return;
      const style = document.createElement("style");
      style.textContent = `
        .reef-signup-dialog {
          width: min(452px, calc(100vw - 24px));
          max-width: none;
          max-height: min(662px, calc(100dvh - 24px));
          padding: 0;
          border: 0;
          border-radius: 22px;
          overflow: auto;
          color: #111;
          background: #fff;
          box-shadow: 0 24px 90px rgba(0, 0, 0, .4);
          font-family: Arial, Helvetica, sans-serif;
        }
        .reef-signup-dialog::backdrop { background: rgba(20, 38, 49, .68); }
        .reef-signup-shell { display: grid; grid-template-columns: 1fr 1fr; min-height: 660px; }
        .reef-signup-copy {
          position: relative;
          z-index: 1;
          display: flex;
          flex-direction: column;
          justify-content: center;
          padding: 30px 22px 24px;
          background: #fff;
        }
        .reef-signup-art {
          min-width: 0;
          background: #7ad8df center / cover no-repeat;
        }
        .reef-signup-close {
          position: absolute;
          z-index: 2;
          top: 9px;
          right: 9px;
          display: grid;
          width: 40px;
          height: 40px;
          place-items: center;
          padding: 0;
          border: 2px solid #34444d;
          border-radius: 999px;
          background: rgba(255,255,255,.92);
          color: #34444d;
          font-size: 31px;
          font-weight: 300;
          line-height: 1;
          cursor: pointer;
        }
        .reef-signup-eyebrow,
        .reef-signup-family,
        .reef-signup-offer,
        .reef-signup-detail { margin: 0; text-align: center; }
        .reef-signup-eyebrow { font-size: 16px; font-weight: 700; line-height: 1.05; }
        .reef-signup-family { margin-top: 18px; font-size: 18px; font-style: italic; font-weight: 700; line-height: 1; }
        .reef-signup-offer { margin-top: 25px; color: #dc421e; font-size: 40px; font-weight: 900; line-height: .92; }
        .reef-signup-offer span { display: block; margin-top: 8px; font-size: 20px; }
        .reef-signup-detail { margin-top: 30px; font-size: 17px; font-weight: 700; line-height: 1.05; }
        .reef-signup-step { margin-top: 24px; }
        .reef-signup-intro { display: none; }
        .reef-signup-step form { display: grid; gap: 10px; }
        .reef-signup-field { display: grid; gap: 6px; }
        .reef-signup-field > span { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
        .reef-signup-field input {
          box-sizing: border-box;
          width: 100%;
          min-height: 51px;
          padding: 13px 14px;
          border: 1px solid #5d6265;
          border-radius: 3px;
          background: #fff;
          color: #111;
          font: inherit;
        }
        .reef-signup-field input:focus { outline: 3px solid rgba(22, 128, 145, .25); border-color: #167f90; }
        .reef-signup-consent {
          display: grid;
          grid-template-columns: 15px 1fr;
          gap: 7px;
          align-items: start;
          font-size: 10px;
          line-height: 1.25;
        }
        .reef-signup-consent input { width: 15px; height: 15px; margin: 0; accent-color: #d9792b; }
        .reef-signup-submit,
        .reef-signup-step button {
          width: 100%;
          min-height: 47px;
          padding: 10px 14px;
          border: 0;
          border-radius: 7px;
          background: #e99d48;
          color: #fff;
          font: 700 18px/1 Arial, Helvetica, sans-serif;
          cursor: pointer;
        }
        .reef-signup-submit:hover,
        .reef-signup-step button:hover { background: #dd8b31; }
        .reef-signup-submit:disabled,
        .reef-signup-step button:disabled { cursor: wait; opacity: .62; }
        .reef-signup-status { min-height: 0; margin: 12px 0 0; color: #9b2f21; font-size: 12px; line-height: 1.3; }
        .reef-signup-status:empty { display: none; }
        .reef-signup-step .retry { margin-top: 8px; background: transparent; color: #315e69; font-size: 12px; text-decoration: underline; }
        @media (max-width: 520px) {
          .reef-signup-dialog { width: min(390px, calc(100vw - 20px)); max-height: calc(100dvh - 20px); border-radius: 18px; }
          .reef-signup-shell { grid-template-columns: 1fr; min-height: 0; }
          .reef-signup-art { grid-row: 1; min-height: 190px; background-position: center 43%; }
          .reef-signup-copy { grid-row: 2; padding: 22px 24px 24px; }
          .reef-signup-eyebrow { font-size: 15px; }
          .reef-signup-family { margin-top: 10px; }
          .reef-signup-offer { margin-top: 15px; font-size: 36px; }
          .reef-signup-detail { margin-top: 18px; font-size: 16px; }
          .reef-signup-step { margin-top: 17px; }
        }
        @media (max-height: 620px) and (min-width: 521px) {
          .reef-signup-shell { min-height: 560px; }
          .reef-signup-copy { padding-top: 24px; padding-bottom: 18px; }
          .reef-signup-family { margin-top: 10px; }
          .reef-signup-offer { margin-top: 16px; }
          .reef-signup-detail { margin-top: 18px; }
          .reef-signup-step { margin-top: 16px; }
        }
      `;
      const dialog = document.createElement("dialog");
      dialog.className = "reef-signup-dialog";
      dialog.setAttribute("aria-labelledby", "reef-signup-title");
      dialog.innerHTML =
        '<button type="button" class="reef-signup-close" aria-label="Close signup form">×</button>' +
        '<div class="reef-signup-shell"><section class="reef-signup-copy" aria-labelledby="reef-signup-title">' +
        '<p class="reef-signup-eyebrow">Want to save more, and<br>spend more time reefing?</p>' +
        '<h2 class="reef-signup-family" id="reef-signup-title">Join our Reefing<br>Family!</h2>' +
        '<p class="reef-signup-offer">10% OFF<span>Entire Order</span></p>' +
        '<p class="reef-signup-detail">Save 10% OFF your<br>first order and receive<br>exclusive deals weekly!</p>' +
        '<div class="reef-signup-step"></div><p class="reef-signup-status" role="status" aria-live="polite"></p>' +
        '</section><div class="reef-signup-art" role="img" aria-label="Two clownfish swimming through coral"></div></div>';
      dialog.querySelector(".reef-signup-art").style.backgroundImage = artwork
        ? `url("${artwork}")`
        : "none";
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
        style.remove();
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
          '<p>If this address is eligible, check your inbox to confirm the email subscription.</p><button type="button">I confirmed my email</button><p><button type="button" class="retry">Use a different email or try again later</button></p>';
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
            if (result.purpose === "resubscribe") {
              finish();
              panel.textContent = "Your email subscription is active again.";
            } else if (result.smsEnabled) sms();
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
          '<p class="reef-signup-intro">Get 10% off your first order after confirming your email.</p><form>' +
          '<label class="reef-signup-field"><span>Email</span><input name="email" type="email" autocomplete="email" placeholder="Email" aria-label="Email" required></label>' +
          '<label class="reef-signup-consent"><input type="checkbox" name="consent" required><span>I agree to receive marketing emails from Corals Anonymous. I can unsubscribe at any time.</span></label>' +
          '<input name="website" tabindex="-1" aria-hidden="true" autocomplete="off" style="display:none">' +
          '<button class="reef-signup-submit" type="submit">Continue</button></form>';
        if (singleOptIn) panel.querySelector("p").textContent = "Sign up for emails and get 10% off your first order. Your personal offer lasts " + couponDays + " days.";
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
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            });
            if (result.completed) {
              finish();
              panel.textContent = "Thanks for joining our reefing community!";
              status.textContent = result.message;
              return;
            }
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
      dialog.querySelector(".reef-signup-close").onclick = close;
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
      document.head.append(style);
      document.body.append(dialog);
      dialog.showModal();
      event("FORM_VIEWED");
      window.addEventListener("focus", refresh);
      if (session) {
        waiting();
        await refresh();
      } else emailForm();
    })();
})();
