/* =========================================================
   Luniva — push-setup.js
   One-time helper for the site owner (push-setup.html).
   Creates the VAPID key pair and schedule secret IN THE BROWSER
   and shows them with the function code and SQL, ready to copy.
   Nothing here is sent anywhere.
   ========================================================= */

function toBase64Url(bytes) {
  let binary = "";
  bytes.forEach(function (byte) { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomHex(length) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, function (byte) { return byte.toString(16).padStart(2, "0"); }).join("");
}

function createSecrets() {
  return crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]).then(function (pair) {
    return Promise.all([crypto.subtle.exportKey("raw", pair.publicKey), crypto.subtle.exportKey("jwk", pair.privateKey)]);
  }).then(function (keys) {
    return {
      VAPID_PUBLIC_KEY: toBase64Url(new Uint8Array(keys[0])),
      VAPID_PRIVATE_KEY: keys[1].d,
      CRON_SECRET: randomHex(32)
    };
  });
}

function scheduleSql(secret) {
  const url = String(LUNIVA_CONFIG.supabaseUrl || "").replace(/\/+$/, "") + "/functions/v1/luniva-push";
  return [
    "-- ---------------------------------------------------------",
    "-- Schedule: check for due reminders every 15 minutes",
    "-- ---------------------------------------------------------",
    "create extension if not exists pg_cron with schema pg_catalog;",
    "create extension if not exists pg_net with schema extensions;",
    "",
    "select cron.unschedule(jobid) from cron.job where jobname = 'luniva-push';",
    "",
    "select cron.schedule('luniva-push', '*/15 * * * *', $job$",
    "  select net.http_post(",
    "    url := '" + url + "',",
    "    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '" + secret + "'),",
    "    body := jsonb_build_object('action', 'send'),",
    "    timeout_milliseconds := 15000",
    "  );",
    "$job$);"
  ].join("\n");
}

function loadText(path) {
  return fetch(path, { cache: "no-store" }).then(function (response) {
    if (!response.ok) throw new Error(path + " " + response.status);
    return response.text();
  });
}

function showSecrets(secrets) {
  document.getElementById("setup-secrets").innerHTML = Object.keys(secrets).map(function (name) {
    return '<div class="setup-secret">' +
      '<div class="setup-secret-name"><code>' + name + "</code>" +
      '<button type="button" class="btn btn-outline-luniva btn-sm" data-copy="secret-' + name + '"><i class="bi bi-clipboard" aria-hidden="true"></i> Copy value</button></div>' +
      '<input class="form-control" id="secret-' + name + '" readonly value="' + secrets[name] + '" aria-label="' + name + ' value">' +
      "</div>";
  }).join("");
}

function copyFrom(id, button) {
  const element = document.getElementById(id);
  const text = element.value !== undefined ? element.value : element.textContent;
  const done = function () {
    const label = button.innerHTML;
    button.innerHTML = '<i class="bi bi-check2" aria-hidden="true"></i> Copied';
    setTimeout(function () { button.innerHTML = label; }, 1600);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, function () { selectText(element); });
  } else {
    selectText(element);
  }
}

function selectText(element) {
  if (element.select) { element.select(); return; }
  const range = document.createRange();
  range.selectNodeContents(element);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

function initPushSetup() {
  const alertBox = document.getElementById("setup-alert");
  const fail = function (message) {
    alertBox.textContent = message;
    alertBox.classList.add("is-visible");
  };

  if (!window.isSecureContext || !window.crypto || !crypto.subtle) {
    fail("Please open this page on the live https:// site.");
    return;
  }

  document.addEventListener("click", function (event) {
    const button = event.target.closest("[data-copy]");
    if (button) copyFrom(button.getAttribute("data-copy"), button);
  });

  Promise.all([
    createSecrets(),
    loadText("supabase/functions/luniva-push/index.ts"),
    loadText("supabase/luniva_push.sql")
  ]).then(function (results) {
    showSecrets(results[0]);
    document.getElementById("setup-code").textContent = results[1];
    document.getElementById("setup-sql").textContent = results[2].trim() + "\n\n" + scheduleSql(results[0].CRON_SECRET) + "\n";
  }).catch(function (error) {
    console.warn("Luniva push setup:", error);
    fail("Something didn't load. Please check your connection and reload the page.");
  });
}

initPushSetup();
