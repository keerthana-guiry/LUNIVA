/* =========================================================
   Luniva — sw.js (service worker)
   Lets Luniva be installed as an app and open without internet.

   Strategy:
   • Luniva's own files (pages, CSS, JS, images): NETWORK FIRST —
     always fetch the newest version when online, fall back to the
     saved copy when offline. So updates appear straight away.
   • Libraries from the CDN (Bootstrap, icons, Supabase): CACHE FIRST —
     their URLs include a fixed version number, so a saved copy is
     always correct.
   • Login requests to Supabase are never cached.

   It also shows the daily phone reminder (see js/push.js). The push
   from the server is empty; the wording is worked out here from a
   small summary the app saves on this device ("lv-push-state").

   Change CACHE_VERSION to force every device to refresh its copy.
   ========================================================= */

const CACHE_VERSION = "luniva-v4";

// Everything needed to open the app offline.
const APP_SHELL = [
  "./",
  "index.html",
  "login.html",
  "signup.html",
  "onboarding.html",
  "dashboard.html",
  "tracker.html",
  "checkin.html",
  "insights.html",
  "history.html",
  "companion.html",
  "notifications.html",
  "settings.html",
  "privacy.html",
  "terms.html",
  "feedback.html",
  "offline.html",
  "manifest.webmanifest",
  "css/style.css",
  "js/config.js",
  "js/storage.js",
  "js/app.js",
  "js/auth.js",
  "js/tracker.js",
  "js/checkin.js",
  "js/insights.js",
  "js/companion.js",
  "js/notifications.js",
  "js/sync.js",
  "js/feedback.js",
  "js/push.js",
  "assets/images/logo.svg",
  "assets/images/logo-full.png",
  "assets/images/icon-192.png",
  "assets/images/icon-512.png",
  "assets/images/apple-touch-icon.png"
];

const CDN_FILES = [
  "https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css",
  "https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js",
  "https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css",
  "https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/fonts/bootstrap-icons.woff2?dd67030699838ea613ee6dbda90effa6",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js"
];

// Install: save the app shell. CDN files are saved one by one so a single
// failure (e.g. a slow network) doesn't stop the app from installing.
self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(function (cache) {
      return cache.addAll(APP_SHELL).then(function () {
        return Promise.all(CDN_FILES.map(function (url) {
          return cache.add(new Request(url, { mode: "cors" })).catch(function () {});
        }));
      });
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

// Activate: delete caches from older versions.
self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(names
        .filter(function (name) { return name.indexOf("luniva-") === 0 && name !== CACHE_VERSION; })
        .map(function (name) { return caches.delete(name); }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

/** Save a successful response for later, without blocking the page. */
function saveCopy(request, response) {
  if (!response || !response.ok) return;
  const copy = response.clone();
  caches.open(CACHE_VERSION).then(function (cache) { cache.put(request, copy); });
}

self.addEventListener("fetch", function (event) {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Luniva's own files: network first, saved copy when offline.
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(request)
        .then(function (response) {
          saveCopy(request, response);
          return response;
        })
        .catch(function () {
          return caches.match(request, { ignoreSearch: true }).then(function (cached) {
            if (cached) return cached;
            if (request.mode === "navigate") return caches.match("offline.html");
            return Response.error();
          });
        })
    );
    return;
  }

  // Versioned CDN libraries: cache first.
  if (url.hostname === "cdn.jsdelivr.net") {
    event.respondWith(
      caches.match(request).then(function (cached) {
        return cached || fetch(request).then(function (response) {
          saveCopy(request, response);
          return response;
        });
      })
    );
  }

  // Everything else (e.g. Supabase login requests) goes straight to the network.
});

/* ---------------------------------------------------------
   DAILY PHONE REMINDER (web push)
   --------------------------------------------------------- */

const PUSH_STATE_CACHE = "lv-push-state";
const PUSH_STATE_URL = "push-state.json";

function readPushState() {
  return caches.open(PUSH_STATE_CACHE)
    .then(function (cache) { return cache.match(PUSH_STATE_URL); })
    .then(function (response) { return response ? response.json() : null; })
    .catch(function () { return null; });
}

function localDateString(date) {
  return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
}

/** Whole days from a to b (YYYY-MM-DD), using local noon to avoid clock-change issues. */
function daysFromTo(a, b) {
  const pa = a.split("-").map(Number), pb = b.split("-").map(Number);
  return Math.round((new Date(pb[0], pb[1] - 1, pb[2], 12) - new Date(pa[0], pa[1] - 1, pa[2], 12)) / 86400000);
}

/** Decide today's reminder from the saved summary. Never needs the network. */
function buildReminder(state, now) {
  const today = localDateString(now);
  const on = state.enabled || {};
  const details = !!state.showDetails;
  const discreet = { body: "A gentle reminder from Luniva 🌙 Tap to see what's coming up.", url: "dashboard.html" };
  const pick = function (list) { return list && list.length ? list[now.getDate() % list.length] : null; };

  if (state.testAt && now.getTime() - state.testAt < 10 * 60 * 1000) {
    return { tag: "luniva-test", body: "Reminders are working 🎉 This is how Luniva will remind you each day.", url: "settings.html" };
  }

  if (state.activeStart) {
    const day = daysFromTo(state.activeStart, today) + 1;
    if (day >= 1 && (on.checkin || on.period) && state.lastLogDate !== today) {
      return details
        ? { body: "Day " + day + " of your period. How's your flow today? Tap to log it.", url: "checkin.html" }
        : discreet;
    }
  } else if (state.nextStart) {
    const until = daysFromTo(today, state.nextStart);
    const when = until === 0 ? "today" : "in about " + until + (until === 1 ? " day" : " days");
    if (on.pad && until >= 0 && until <= (state.padDays || 0)) {
      return details ? { body: "Your period may start " + when + ". You might want to carry a pad 👜", url: "tracker.html" } : discreet;
    }
    if (on.period && until >= 0 && until <= 3) {
      return details ? { body: "Your period may start " + when + ". 🔔", url: "tracker.html" } : discreet;
    }
  }

  if (on.checkin && state.lastLogDate !== today) {
    return { body: "How are you feeling today? Take a minute for your daily check-in 📝", url: "checkin.html" };
  }
  const note = (on.motivation && pick(state.motivation)) || (on.companion && pick(state.companion));
  if (note) return { body: note, url: on.motivation ? "dashboard.html" : "companion.html" };
  return { body: "A gentle moment for yourself today 🌙", url: "dashboard.html" };
}

self.addEventListener("push", function (event) {
  event.waitUntil(readPushState().then(function (state) {
    const note = buildReminder(state || {}, new Date());
    return self.registration.showNotification("Luniva", {
      body: note.body,
      icon: "assets/images/icon-192.png",
      tag: note.tag || "luniva-daily",
      data: { url: note.url }
    });
  }));
});

// Tapping the reminder opens (or focuses) Luniva on the right page.
self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "dashboard.html", self.registration.scope).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (windows) {
    for (const client of windows) {
      if ("focus" in client && "navigate" in client) {
        return client.navigate(target)
          .then(function (opened) { return (opened || client).focus(); })
          .catch(function () { return self.clients.openWindow(target); });
      }
    }
    return self.clients.openWindow(target);
  }));
});
