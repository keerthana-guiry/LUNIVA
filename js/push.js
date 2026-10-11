/* =========================================================
   Luniva — push.js
   Optional daily phone reminder that arrives even when Luniva
   is closed (web push).

   Privacy: the server (Supabase function "luniva-push") only
   stores this device's push address, the chosen hour and the
   time zone. At that hour it sends an EMPTY nudge; the service
   worker (sw.js) then decides what to say from a small summary
   this file saves on the device. Health data never leaves it.

   Loaded on every app page (after sync.js) and on the login and
   sign-up pages (so logging out turns reminders off).
   Requires the Supabase library, config.js, storage.js, app.js.
   ========================================================= */

const PUSH_FUNCTION_NAME = "luniva-push";
const PUSH_STATE_CACHE = "lv-push-state"; // same names as in sw.js
const PUSH_STATE_URL = "push-state.json";
const DEFAULT_REMIND_HOUR = 20;

/* ---------- Device state (luniva_push, never exported) ---------- */

function getPushState() {
  return Object.assign({ enabled: false, hour: DEFAULT_REMIND_HOUR, showDetails: false }, getData(PUSH_STORAGE_KEY) || {});
}

function savePushState(partial) {
  saveData(PUSH_STORAGE_KEY, Object.assign(getPushState(), partial));
}

function isPushSupported() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window &&
    window.isSecureContext && isAuthConfigured();
}

function getTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch (error) {
    return "UTC";
  }
}

/** 20 → "8:00 pm" */
function formatHourLabel(hour) {
  const suffix = hour < 12 ? "am" : "pm";
  return (hour % 12 || 12) + ":00 " + suffix;
}

function base64UrlToBytes(text) {
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "===".slice((base64.length + 3) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function sameBytes(buffer, bytes) {
  if (!buffer) return false;
  const a = new Uint8Array(buffer);
  return a.length === bytes.length && a.every(function (value, index) { return value === bytes[index]; });
}

/* ---------- The on-device summary the service worker reads ---------- */

/** Save what the reminder needs to know (dates and switches only) for sw.js. */
function writeReminderSummary() {
  const push = getPushState();
  if (!push.enabled || !("caches" in window) || !getUser()) return Promise.resolve();
  const settings = getSettings();
  const active = getActivePeriod();
  const logDates = Object.keys(getDailyLogs()).sort();
  const summary = {
    showDetails: !!push.showDetails,
    enabled: settings.notifications || {},
    activeStart: active ? active.startDate : null,
    nextStart: getNextPredictedStart(),
    padDays: settings.padReminderDays || 0,
    lastLogDate: logDates.length ? logDates[logDates.length - 1] : null,
    motivation: typeof MOTIVATION_NOTES !== "undefined" ? MOTIVATION_NOTES : [],
    companion: typeof COMPANION_NOTES !== "undefined" ? COMPANION_NOTES : [],
    testAt: push.testAt || null,
    savedAt: Date.now()
  };
  return caches.open(PUSH_STATE_CACHE).then(function (cache) {
    return cache.put(PUSH_STATE_URL, new Response(JSON.stringify(summary), { headers: { "Content-Type": "application/json" } }));
  }).catch(function () {});
}

function clearReminderSummary() {
  return "caches" in window ? caches.delete(PUSH_STATE_CACHE).catch(function () {}) : Promise.resolve();
}

/* ---------- Turning reminders on and off ---------- */

function pushError(code) {
  const error = new Error(code);
  error.pushCode = code;
  return error;
}

/** The service worker registration, or an error if it isn't running within 10 s. */
function getReadyRegistration() {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise(function (resolve, reject) { setTimeout(function () { reject(pushError("no-worker")); }, 10000); })
  ]);
}

function getPublicPushKey() {
  return getAuthClient().functions.invoke(PUSH_FUNCTION_NAME, { method: "GET" }).then(function (result) {
    if (result.error || !result.data || !result.data.publicKey) throw pushError("server");
    return result.data.publicKey;
  });
}

/** Save (or update) this device's row: push address, hour, time zone. */
function saveDeviceRow(endpoint, hour) {
  return getAuthClient().from("luniva_push")
    .upsert({ endpoint: endpoint, remind_hour: hour, timezone: getTimeZone() }, { onConflict: "endpoint" })
    .then(function (result) { if (result.error) throw result.error; });
}

/** Ask permission, subscribe this browser and register it. Call from a tap. */
function turnOnPush(hour) {
  if (!navigator.onLine) return Promise.reject(pushError("offline"));
  // Must be the first thing after the tap, or browsers ignore it.
  return Promise.resolve(Notification.requestPermission()).then(function (permission) {
    if (permission !== "granted") throw pushError("permission");
    return Promise.all([getReadyRegistration(), getPublicPushKey()]);
  }).then(function (results) {
    const registration = results[0];
    const key = base64UrlToBytes(results[1]);
    return registration.pushManager.getSubscription().then(function (existing) {
      if (existing && sameBytes(existing.options && existing.options.applicationServerKey, key)) return existing;
      return (existing ? existing.unsubscribe() : Promise.resolve()).then(function () {
        return registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      });
    });
  }).then(function (subscription) {
    return saveDeviceRow(subscription.endpoint, hour).then(function () {
      savePushState({ enabled: true, endpoint: subscription.endpoint, hour: hour, timeZone: getTimeZone() });
      return writeReminderSummary();
    });
  });
}

/**
 * Stop reminders on this device: remove its row (best effort), unsubscribe
 * the browser and forget the summary. Used by "Turn off", log out and
 * Delete Data. Never fails.
 */
function turnOffPush() {
  const push = getData(PUSH_STORAGE_KEY);
  const client = getAuthClient();
  const removeRow = push && push.endpoint && client
    ? client.from("luniva_push").delete().eq("endpoint", push.endpoint).then(function () {}, function () {})
    : Promise.resolve();
  const unsubscribe = "serviceWorker" in navigator
    ? navigator.serviceWorker.getRegistration().then(function (registration) {
      return registration && registration.pushManager ? registration.pushManager.getSubscription() : null;
    }).then(function (subscription) {
      return subscription ? subscription.unsubscribe() : null;
    }).catch(function () {})
    : Promise.resolve();
  return Promise.all([removeRow, unsubscribe]).then(function () {
    deleteData(PUSH_STORAGE_KEY);
    return clearReminderSummary();
  });
}

function updateReminderHour(hour) {
  const push = getPushState();
  savePushState({ hour: hour });
  if (!push.enabled || !push.endpoint) return Promise.resolve();
  return getAuthClient().from("luniva_push")
    .update({ remind_hour: hour, timezone: getTimeZone() })
    .eq("endpoint", push.endpoint)
    .then(function (result) { if (result.error) throw result.error; });
}

/** Ask the server to send a test right now to this account's devices. */
function sendTestPush() {
  savePushState({ testAt: Date.now() });
  return writeReminderSummary().then(function () {
    return getAuthClient().functions.invoke(PUSH_FUNCTION_NAME, { body: { action: "test" } });
  }).then(function (result) {
    if (result.error || !result.data || !result.data.sent) throw pushError("server");
  });
}

/**
 * On app pages: keep the server row in step with this browser. Handles a
 * blocked permission, a renewed push address and a new time zone.
 */
function checkPushSubscription() {
  const push = getPushState();
  if (!push.enabled || !isPushSupported() || !navigator.onLine) return Promise.resolve();
  if (Notification.permission !== "granted") {
    return turnOffPush().then(function () {
      savePushState({ hour: push.hour, showDetails: push.showDetails, notice: "Phone reminders stopped because notifications were blocked." });
    });
  }
  return navigator.serviceWorker.getRegistration().then(function (registration) {
    return registration ? registration.pushManager.getSubscription() : null;
  }).then(function (subscription) {
    if (!subscription) return null; // the worker may still be starting; check again next time
    if (subscription.endpoint === push.endpoint && push.timeZone === getTimeZone()) return null;
    const oldEndpoint = push.endpoint;
    return saveDeviceRow(subscription.endpoint, push.hour).then(function () {
      savePushState({ endpoint: subscription.endpoint, timeZone: getTimeZone() });
      if (oldEndpoint && oldEndpoint !== subscription.endpoint) {
        return getAuthClient().from("luniva_push").delete().eq("endpoint", oldEndpoint).then(function () {});
      }
      return null;
    });
  }).catch(function (error) {
    console.warn("Luniva push check:", error);
  });
}

/* ---------- Settings card (#push-settings) ---------- */

function getPushErrorMessage(error) {
  const code = error && error.pushCode;
  if (code === "permission") return "Notifications weren't allowed. To use phone reminders, allow notifications for Luniva in your browser or phone settings, then try again.";
  if (code === "offline") return "You're offline. Please connect to the internet and try again.";
  if (code === "no-worker") return "Luniva's app files are still loading. Please reload the page and try again.";
  return "Phone reminders couldn't be set up right now. Please try again later.";
}

function renderPushSettings() {
  const box = document.getElementById("push-settings");
  if (!box) return;
  const push = getPushState();
  const iosNeedsInstall = isIOSDevice() && !isInstalledApp();

  let body;
  if (iosNeedsInstall) {
    body = '<p class="calm-note mb-0"><i class="bi bi-phone" aria-hidden="true"></i><span>On iPhone and iPad, first add Luniva to your Home Screen ' +
      '(tap <strong>Share</strong> <i class="bi bi-box-arrow-up" aria-hidden="true"></i> then <strong>Add to Home Screen</strong>), ' +
      "then open Luniva from there to turn on phone reminders. Needs iOS 16.4 or newer.</span></p>";
  } else if (!isPushSupported()) {
    body = '<p class="text-muted-soft mb-0">This browser can\'t show phone reminders. They work in Chrome, Edge, Firefox and Samsung Internet, and in Luniva installed on an iPhone.</p>';
  } else if (!push.enabled && Notification.permission === "denied") {
    body = '<p class="calm-note mb-0"><i class="bi bi-bell-slash" aria-hidden="true"></i><span>Notifications are blocked for Luniva. ' +
      "Allow them in your browser or phone settings, then come back here.</span></p>";
  } else {
    const hourOptions = Array.from({ length: 24 }, function (_, hour) {
      return '<option value="' + hour + '"' + (hour === push.hour ? " selected" : "") + ">" + formatHourLabel(hour) + "</option>";
    }).join("");
    body =
      (push.notice ? '<p class="calm-note mb-3"><i class="bi bi-info-circle" aria-hidden="true"></i><span>' + escapeHtml(push.notice) + "</span></p>" : "") +
      '<p class="sync-status"><span class="status-dot' + (push.enabled ? " status-synced" : "") + '" aria-hidden="true"></span>' +
        (push.enabled ? "<strong>On</strong> · Every day at " + formatHourLabel(push.hour) + " on this device"
          : "<strong>Off</strong> · One gentle reminder a day, even when Luniva is closed.") + "</p>" +
      '<div class="push-options">' +
        '<div><label class="form-label" for="push-hour">Remind me at</label>' +
        '<select class="form-select" id="push-hour">' + hourOptions + "</select></div>" +
        '<div class="toggle-row">' +
          '<div class="toggle-text"><label for="push-details">Show period details in reminders</label>' +
          '<small id="push-details-hint">When off, period reminders just say "A gentle reminder from Luniva" — handy if others can see your screen.</small></div>' +
          '<div class="form-check form-switch"><input class="form-check-input" type="checkbox" role="switch" id="push-details" aria-describedby="push-details-hint"' +
            (push.showDetails ? " checked" : "") + "></div>" +
        "</div>" +
      "</div>" +
      '<div class="d-flex flex-wrap gap-2">' +
        (push.enabled
          ? '<button type="button" class="btn btn-outline-luniva" id="push-test"><i class="bi bi-send" aria-hidden="true"></i> Send a test</button>' +
            '<button type="button" class="btn btn-ghost" id="push-off">Turn off</button>'
          : '<button type="button" class="btn btn-luniva" id="push-on"><i class="bi bi-bell" aria-hidden="true"></i> Turn on phone reminders</button>') +
      "</div>";
  }

  box.innerHTML =
    '<h3 class="push-title"><span aria-hidden="true">📲</span> Phone reminders</h3>' +
    '<p class="small text-muted-soft">What the reminder says is worked out on this device from the reminders you\'ve switched on above. ' +
    "Your health data is never sent anywhere.</p>" + body;

  bindPushSettings();
}

function bindPushSettings() {
  const hourSelect = document.getElementById("push-hour");
  if (!hourSelect) return;

  hourSelect.addEventListener("change", function () {
    const hour = Number(hourSelect.value);
    updateReminderHour(hour).then(function () {
      if (getPushState().enabled) showToast("You'll get your reminder at " + formatHourLabel(hour) + ".", "success");
      renderPushSettings();
    }).catch(function () {
      showToast("Couldn't change the time right now. Please try again.", "warning");
    });
  });

  document.getElementById("push-details").addEventListener("change", function () {
    savePushState({ showDetails: this.checked });
    writeReminderSummary();
    showToast("Reminder preferences saved.", "info");
  });

  const onButton = document.getElementById("push-on");
  if (onButton) {
    onButton.addEventListener("click", function () {
      setBusy(onButton, true, "Turning on…");
      savePushState({ notice: null });
      turnOnPush(Number(hourSelect.value)).then(function () {
        showToast("Phone reminders are on 🌙", "success");
        renderPushSettings();
      }).catch(function (error) {
        console.warn("Luniva push:", error);
        setBusy(onButton, false);
        showToast(getPushErrorMessage(error), "warning");
        if (error && error.pushCode === "permission") renderPushSettings();
      });
    });
  }

  const offButton = document.getElementById("push-off");
  if (offButton) {
    offButton.addEventListener("click", function () {
      const keep = getPushState();
      setBusy(offButton, true, "Turning off…");
      turnOffPush().then(function () {
        savePushState({ hour: keep.hour, showDetails: keep.showDetails });
        showToast("Phone reminders are off.", "info");
        renderPushSettings();
      });
    });
  }

  const testButton = document.getElementById("push-test");
  if (testButton) {
    testButton.addEventListener("click", function () {
      setBusy(testButton, true, "Sending…");
      sendTestPush().then(function () {
        setBusy(testButton, false);
        showToast("Test sent — it should arrive in a few seconds.", "success");
      }).catch(function (error) {
        console.warn("Luniva push test:", error);
        setBusy(testButton, false);
        showToast(navigator.onLine ? "The test couldn't be sent. Please try again later." : "You're offline. Please try again when you're connected.", "warning");
      });
    });
  }
}

/* ---------- Start-up ---------- */

if (typeof IS_APP_PAGE !== "undefined" && IS_APP_PAGE && APP_PAGE_ALLOWED) {
  if (getPushState().enabled) {
    writeReminderSummary();
    checkPushSubscription();
    // Refresh the summary whenever Luniva goes to the background.
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") writeReminderSummary();
    });
  }
  renderPushSettings();
}
