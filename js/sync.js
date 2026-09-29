/* =========================================================
   Luniva — sync.js
   OPTIONAL encrypted sync of health records to the user's account.

   How it works:
   • The user chooses a sync passphrase. A 256-bit AES-GCM key is
     derived from it in the browser (PBKDF2-SHA-256, 600,000 rounds,
     random salt). The passphrase itself is never stored or sent.
   • Before anything is uploaded, all records are encrypted on this
     device. Supabase (table luniva_sync, one row per account) only
     ever receives ciphertext — nobody can read it without the
     passphrase, including Luniva.
   • This device keeps the derived key in luniva_sync so the user
     isn't asked for the passphrase on every page. Signing out keeps
     it; "Delete Data" or switching accounts removes it.
   • Changes are uploaded a moment after they're saved. On each page
     load Luniva checks whether another device synced; if so, the
     newer records are downloaded (and merged if both changed).

   Requires the Supabase library, config.js, storage.js and app.js.
   ========================================================= */

const SYNC_TABLE = "luniva_sync";
const SYNC_ITERATIONS = 600000;
const MIN_PASSPHRASE_LENGTH = 8;
const SYNC_PUSH_DELAY_MS = 1500;
const SYNC_PROFILE_FIELDS = ["name", "heightCm", "createdAt", "onboardingComplete"];

/* ---------------------------------------------------------
   1. SMALL HELPERS
   --------------------------------------------------------- */

function bytesToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function randomBytes(length) {
  return crypto.getRandomValues(new Uint8Array(length));
}

/** Can this browser do encrypted sync at all? (Needs https + Web Crypto.) */
function isSyncSupported() {
  return !!(window.crypto && crypto.subtle && getAuthClient());
}

/* ---------------------------------------------------------
   2. ENCRYPTION (Web Crypto)
   --------------------------------------------------------- */

/** Passphrase + salt → AES-256-GCM key (slow on purpose, to resist guessing). */
function deriveSyncKey(passphrase, saltBytes, iterations) {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"])
    .then(function (baseKey) {
      return crypto.subtle.deriveKey(
        { name: "PBKDF2", salt: saltBytes, iterations: iterations, hash: "SHA-256" },
        baseKey,
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"]
      );
    });
}

function exportSyncKey(key) {
  return crypto.subtle.exportKey("raw", key).then(bytesToBase64);
}

function importSyncKey(keyBase64) {
  return crypto.subtle.importKey("raw", base64ToBytes(keyBase64), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function encryptRecords(key, records) {
  const iv = randomBytes(12);
  const plain = new TextEncoder().encode(JSON.stringify(records));
  return crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, key, plain).then(function (cipher) {
    return { ciphertext: bytesToBase64(cipher), iv: bytesToBase64(iv) };
  });
}

/** Rejects if the key is wrong (AES-GCM checks integrity). */
function decryptRecords(key, ciphertext, iv) {
  return crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(iv) }, key, base64ToBytes(ciphertext))
    .then(function (plain) { return JSON.parse(new TextDecoder().decode(plain)); });
}

/* ---------------------------------------------------------
   3. THIS DEVICE'S SYNC STATE
   { enabled, keyBase64, salt, iterations, remoteVersion,
     dirty, lastSyncedAt, notice }
   --------------------------------------------------------- */

function getSyncState() {
  const state = getData(SYNC_STORAGE_KEY);
  return state && typeof state === "object" ? state : { enabled: false };
}

function saveSyncState(partial) {
  saveData(SYNC_STORAGE_KEY, Object.assign({}, getSyncState(), partial));
}

/* ---------------------------------------------------------
   4. RECORDS: SNAPSHOT, APPLY, MERGE
   --------------------------------------------------------- */

/** Everything that gets synced, as one object. */
function takeSnapshot() {
  const user = getUser() || {};
  const profile = {};
  SYNC_PROFILE_FIELDS.forEach(function (field) {
    if (user[field] !== undefined) profile[field] = user[field];
  });
  return {
    format: 1,
    profile: profile,
    settings: getData(STORAGE_KEYS.settings),
    periods: getData(STORAGE_KEYS.periods) || [],
    dailyLogs: getDailyLogs(),
    notifications: getData(STORAGE_KEYS.notifications) || []
  };
}

let applyingRemoteRecords = false;

/** Replace this device's records with a snapshot (keeps account id/email). */
function applySnapshot(snapshot) {
  applyingRemoteRecords = true;
  try {
    const profile = {};
    SYNC_PROFILE_FIELDS.forEach(function (field) {
      if (snapshot.profile && snapshot.profile[field] !== undefined) profile[field] = snapshot.profile[field];
    });
    updateData(STORAGE_KEYS.user, profile);
    if (snapshot.settings) saveData(STORAGE_KEYS.settings, snapshot.settings);
    saveData(STORAGE_KEYS.periods, Array.isArray(snapshot.periods) ? snapshot.periods : []);
    saveData(STORAGE_KEYS.dailyLogs, snapshot.dailyLogs && typeof snapshot.dailyLogs === "object" ? snapshot.dailyLogs : {});
    saveData(STORAGE_KEYS.notifications, Array.isArray(snapshot.notifications) ? snapshot.notifications : []);
  } finally {
    applyingRemoteRecords = false;
  }
}

/**
 * Combine two snapshots when BOTH devices changed since the last sync.
 * Nothing is thrown away: periods, days and notifications are joined,
 * and where the same item exists on both, this device's copy wins.
 */
function mergeSnapshots(local, remote) {
  // Periods: by id, then one period per start date (this device wins).
  const byStart = {};
  (remote.periods || []).concat(local.periods || []).forEach(function (period) {
    if (period && period.startDate) byStart[period.startDate] = period;
  });

  // Daily logs: every date from both; fields on the same date are combined.
  const dailyLogs = {};
  const remoteLogs = remote.dailyLogs || {};
  const localLogs = local.dailyLogs || {};
  Object.keys(remoteLogs).concat(Object.keys(localLogs)).forEach(function (date) {
    dailyLogs[date] = Object.assign({}, remoteLogs[date] || {}, localLogs[date] || {});
  });

  const notificationsById = {};
  (remote.notifications || []).concat(local.notifications || []).forEach(function (item) {
    if (item && item.id) notificationsById[item.id] = item;
  });

  const profile = Object.assign({}, remote.profile || {}, local.profile || {});
  profile.onboardingComplete = !!((local.profile && local.profile.onboardingComplete) ||
    (remote.profile && remote.profile.onboardingComplete));

  return {
    format: 1,
    profile: profile,
    settings: local.settings || remote.settings || null,
    periods: Object.keys(byStart).map(function (date) { return byStart[date]; }),
    dailyLogs: dailyLogs,
    notifications: Object.keys(notificationsById).map(function (id) { return notificationsById[id]; })
  };
}

/** Does this device hold any records worth merging? */
function hasLocalRecords() {
  return getPeriods().length > 0 || Object.keys(getDailyLogs()).length > 0;
}

/* ---------------------------------------------------------
   5. TALKING TO SUPABASE
   --------------------------------------------------------- */

function getSignedInUserId() {
  const client = getAuthClient();
  if (!client) return Promise.resolve(null);
  return client.auth.getSession().then(function (result) {
    return result.data && result.data.session ? result.data.session.user.id : null;
  });
}

function fetchRemoteRow(userId) {
  return getAuthClient().from(SYNC_TABLE)
    .select("ciphertext, iv, salt, iterations, updated_at")
    .eq("user_id", userId)
    .maybeSingle()
    .then(function (result) {
      if (result.error) throw result.error;
      return result.data;
    });
}

function deleteRemoteRow(userId) {
  return getAuthClient().from(SYNC_TABLE).delete().eq("user_id", userId).then(function (result) {
    if (result.error) throw result.error;
  });
}

/** Encrypt this device's records and upload them. */
function uploadRecords(userId, key, state) {
  const startCount = syncChangeCount;
  return encryptRecords(key, takeSnapshot()).then(function (encrypted) {
    return getAuthClient().from(SYNC_TABLE).upsert({
      user_id: userId,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      salt: state.salt,
      iterations: state.iterations
    }).select("updated_at").single();
  }).then(function (result) {
    if (result.error) throw result.error;
    const changedDuringUpload = syncChangeCount !== startCount;
    saveSyncState({
      remoteVersion: result.data.updated_at,
      lastSyncedAt: new Date().toISOString(),
      dirty: changedDuringUpload
    });
    if (changedDuringUpload) scheduleSyncPush();
  });
}

/* ---------------------------------------------------------
   6. THE SYNC ENGINE
   --------------------------------------------------------- */

let syncChangeCount = 0;
let syncPushTimer = null;
let syncInProgress = null;

/** Called by storage.js whenever a synced key is saved. */
function markRecordsChanged() {
  if (applyingRemoteRecords) return;
  const state = getSyncState();
  if (!state.enabled) return;
  syncChangeCount++;
  if (!state.dirty) saveSyncState({ dirty: true });
  scheduleSyncPush();
}

function scheduleSyncPush() {
  clearTimeout(syncPushTimer);
  syncPushTimer = setTimeout(function () { syncNow(); }, SYNC_PUSH_DELAY_MS);
}

/** Turn sync off on this device only (e.g. passphrase changed elsewhere). */
function pauseSyncHere(notice) {
  saveSyncState({ enabled: false, keyBase64: null, dirty: false, notice: notice });
}

/**
 * Bring this device and the account in line. Resolves to one of:
 * "off", "offline", "unavailable", "signed-out", "up-to-date",
 * "pushed", "pulled", "merged", "removed", "rekeyed".
 */
function syncNow() {
  if (syncInProgress) {
    return syncInProgress.then(function () { return syncNow(); });
  }
  const state = getSyncState();
  if (!state.enabled || !state.keyBase64) return Promise.resolve("off");
  if (!navigator.onLine) return Promise.resolve("offline");
  if (!isSyncSupported()) return Promise.resolve("unavailable");

  syncInProgress = getSignedInUserId().then(function (userId) {
    if (!userId) return "signed-out";
    return Promise.all([fetchRemoteRow(userId), importSyncKey(state.keyBase64)]).then(function (results) {
      const remote = results[0];
      const key = results[1];

      if (!remote) {
        if (state.remoteVersion) {
          pauseSyncHere("Encrypted sync was turned off from another device.");
          return "removed";
        }
        return uploadRecords(userId, key, state).then(function () { return "pushed"; });
      }

      if (remote.salt !== state.salt) {
        pauseSyncHere("Your sync passphrase was changed on another device. Enter the new passphrase to keep syncing.");
        return "rekeyed";
      }

      const remoteChanged = remote.updated_at !== state.remoteVersion;
      if (!remoteChanged) {
        if (!getSyncState().dirty) return "up-to-date";
        return uploadRecords(userId, key, getSyncState()).then(function () { return "pushed"; });
      }

      return decryptRecords(key, remote.ciphertext, remote.iv).then(function (remoteRecords) {
        if (getSyncState().dirty) {
          applySnapshot(mergeSnapshots(takeSnapshot(), remoteRecords));
          return uploadRecords(userId, key, getSyncState()).then(function () { return "merged"; });
        }
        applySnapshot(remoteRecords);
        saveSyncState({ remoteVersion: remote.updated_at, lastSyncedAt: new Date().toISOString(), dirty: false });
        return "pulled";
      });
    });
  }).catch(function (error) {
    console.warn("Luniva sync:", error);
    return "error";
  }).then(function (result) {
    syncInProgress = null;
    renderSyncSettings();
    return result;
  });

  return syncInProgress;
}

/* ---------------------------------------------------------
   7. TURNING SYNC ON AND OFF
   --------------------------------------------------------- */

/** First device: create a passphrase and upload encrypted records. */
function createSync(passphrase) {
  return getSignedInUserId().then(function (userId) {
    if (!userId) throw new Error("signed-out");
    const salt = randomBytes(16);
    return deriveSyncKey(passphrase, salt, SYNC_ITERATIONS).then(exportSyncKey).then(function (keyBase64) {
      saveSyncState({
        enabled: true,
        keyBase64: keyBase64,
        salt: bytesToBase64(salt),
        iterations: SYNC_ITERATIONS,
        remoteVersion: null,
        dirty: true,
        notice: null
      });
      return importSyncKey(keyBase64).then(function (key) {
        return uploadRecords(userId, key, getSyncState());
      });
    });
  });
}

/**
 * Another device already syncs: unlock with the passphrase, then
 * combine its records with anything already on this device.
 * Rejects with Error("wrong-passphrase") if it doesn't match.
 */
function joinSync(passphrase) {
  return getSignedInUserId().then(function (userId) {
    if (!userId) throw new Error("signed-out");
    return fetchRemoteRow(userId).then(function (remote) {
      if (!remote) throw new Error("no-remote");
      return deriveSyncKey(passphrase, base64ToBytes(remote.salt), remote.iterations).then(function (key) {
        return decryptRecords(key, remote.ciphertext, remote.iv)
          .catch(function () { throw new Error("wrong-passphrase"); })
          .then(function (remoteRecords) {
            const mergeNeeded = hasLocalRecords();
            applySnapshot(mergeNeeded ? mergeSnapshots(takeSnapshot(), remoteRecords) : remoteRecords);
            return exportSyncKey(key).then(function (keyBase64) {
              saveSyncState({
                enabled: true,
                keyBase64: keyBase64,
                salt: remote.salt,
                iterations: remote.iterations,
                remoteVersion: remote.updated_at,
                lastSyncedAt: new Date().toISOString(),
                dirty: mergeNeeded,
                notice: null
              });
              if (mergeNeeded) return importSyncKey(keyBase64).then(function (k) { return uploadRecords(userId, k, getSyncState()); });
            });
          });
      });
    });
  });
}

/** Turn sync off. With deleteCopy, the encrypted copy on the account is removed too. */
function stopSync(deleteCopy) {
  const done = function () { saveData(SYNC_STORAGE_KEY, { enabled: false }); };
  if (!deleteCopy) {
    done();
    return Promise.resolve();
  }
  return getSignedInUserId().then(function (userId) {
    if (!userId) throw new Error("signed-out");
    return deleteRemoteRow(userId);
  }).then(done);
}

/** Forgotten passphrase: delete the unreadable copy and start again. */
function resetSync(newPassphrase) {
  return getSignedInUserId().then(function (userId) {
    if (!userId) throw new Error("signed-out");
    return deleteRemoteRow(userId);
  }).then(function () {
    saveData(SYNC_STORAGE_KEY, { enabled: false });
    return createSync(newPassphrase);
  });
}

/** Is there an encrypted copy on the account? (No passphrase needed to ask.) */
function remoteCopyExists() {
  if (!isSyncSupported() || !navigator.onLine) return Promise.resolve(false);
  return getSignedInUserId().then(function (userId) {
    if (!userId) return false;
    return fetchRemoteRow(userId).then(function (row) { return !!row; });
  }).catch(function () { return false; });
}

/** For "Delete Data": remove the synced copy if this device syncs. */
function deleteSyncedCopyIfAny() {
  if (!getSyncState().enabled) return Promise.resolve();
  return stopSync(true).catch(function () {});
}

/* ---------------------------------------------------------
   8. PASSPHRASE WINDOW (one modal, three modes)
   create — choose a new passphrase
   unlock — enter the existing passphrase
   stop   — confirm turning sync off
   --------------------------------------------------------- */

let syncModal = null;
let syncModalMode = "create";
let syncModalDone = null;

function friendlySyncError(error) {
  const message = (error && error.message) || "";
  if (message === "wrong-passphrase") return "That passphrase doesn't match. Please check it and try again.";
  if (message === "signed-out") return "Please log in again, then try once more.";
  if (message === "no-remote") return "There are no synced records on your account yet.";
  if (!navigator.onLine || message.toLowerCase().indexOf("fetch") !== -1) return "You're offline. Connect to the internet and try again.";
  return "Something went wrong. Please try again in a moment.";
}

function buildSyncModal() {
  const wrapper = document.createElement("div");
  wrapper.innerHTML =
    '<div class="modal fade" id="sync-modal" tabindex="-1" aria-labelledby="sync-modal-title" aria-hidden="true">' +
      '<div class="modal-dialog modal-dialog-centered"><div class="modal-content">' +
        '<form id="sync-form" novalidate>' +
          '<div class="modal-header">' +
            '<h2 class="modal-title fs-5" id="sync-modal-title"></h2>' +
            '<button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>' +
          '</div>' +
          '<div class="modal-body">' +
            '<p class="text-muted-soft" id="sync-modal-intro"></p>' +
            '<div id="sync-alert" class="alert-inline mb-3" role="alert"></div>' +
            '<div id="sync-pass-fields">' +
              '<label class="form-label" for="sync-passphrase">Sync passphrase</label>' +
              '<div class="input-with-action mb-3">' +
                '<input class="form-control" type="password" id="sync-passphrase" autocomplete="new-password" aria-describedby="sync-passphrase-error">' +
                '<button class="input-action" type="button" id="sync-toggle-pass" aria-label="Show passphrase" aria-pressed="false"><i class="bi bi-eye" aria-hidden="true"></i></button>' +
                '<div class="invalid-feedback" id="sync-passphrase-error"></div>' +
              '</div>' +
              '<div id="sync-confirm-wrap" class="mb-3">' +
                '<label class="form-label" for="sync-passphrase-confirm">Confirm passphrase</label>' +
                '<input class="form-control" type="password" id="sync-passphrase-confirm" autocomplete="new-password" aria-describedby="sync-passphrase-confirm-error">' +
                '<div class="invalid-feedback" id="sync-passphrase-confirm-error"></div>' +
              '</div>' +
              '<div class="form-check" id="sync-ack-wrap">' +
                '<input class="form-check-input" type="checkbox" id="sync-ack" aria-describedby="sync-ack-error">' +
                '<label class="form-check-label small" for="sync-ack">I understand that if I forget this passphrase, my synced records can\'t be recovered — not even by Luniva.</label>' +
                '<div class="invalid-feedback" id="sync-ack-error"></div>' +
              '</div>' +
              '<p class="small mt-2 mb-0" id="sync-forgot-wrap"><a href="#" id="sync-forgot">Forgot your passphrase?</a></p>' +
            '</div>' +
            '<div id="sync-stop-fields">' +
              '<div class="form-check">' +
                '<input class="form-check-input" type="checkbox" id="sync-delete-copy" checked>' +
                '<label class="form-check-label" for="sync-delete-copy">Also delete my encrypted copy from my account</label>' +
              '</div>' +
              '<p class="small text-muted-soft mt-2 mb-0">Your records stay on this device either way.</p>' +
            '</div>' +
          '</div>' +
          '<div class="modal-footer">' +
            '<button type="button" class="btn btn-ghost" data-bs-dismiss="modal">Cancel</button>' +
            '<button type="submit" class="btn btn-luniva" id="sync-submit"></button>' +
          '</div>' +
        '</form>' +
      '</div></div>' +
    '</div>';
  document.body.appendChild(wrapper.firstChild);

  const form = document.getElementById("sync-form");
  const passInput = document.getElementById("sync-passphrase");
  const confirmInput = document.getElementById("sync-passphrase-confirm");
  const ackInput = document.getElementById("sync-ack");
  clearErrorOnInput([passInput, confirmInput, ackInput]);

  document.getElementById("sync-toggle-pass").addEventListener("click", function () {
    const hidden = passInput.type === "password";
    passInput.type = hidden ? "text" : "password";
    confirmInput.type = passInput.type;
    this.setAttribute("aria-pressed", String(hidden));
    this.querySelector("i").className = hidden ? "bi bi-eye-slash" : "bi bi-eye";
  });

  document.getElementById("sync-forgot").addEventListener("click", function (event) {
    event.preventDefault();
    setSyncModalMode("reset");
  });

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    submitSyncModal();
  });

  syncModal = new bootstrap.Modal(document.getElementById("sync-modal"));
}

const SYNC_MODAL_TEXT = {
  create: {
    title: "Turn on encrypted sync",
    intro: "Choose a sync passphrase. Your records are encrypted on this device with it before they're saved to your account, so only someone with the passphrase can read them — not even Luniva. You'll need it once on each new device.",
    button: "Encrypt & turn on"
  },
  unlock: {
    title: "Restore your synced records",
    intro: "Your account has encrypted records from another device. Enter your sync passphrase to unlock them on this device.",
    button: "Unlock records"
  },
  reset: {
    title: "Start fresh with a new passphrase",
    intro: "Without the old passphrase, your synced copy can't be read by anyone. Starting fresh deletes that copy and saves this device's records with a new passphrase. Records on your other devices stay on those devices.",
    button: "Delete old copy & start fresh"
  },
  stop: {
    title: "Turn off encrypted sync?",
    intro: "This device will stop syncing.",
    button: "Turn off sync"
  }
};

function setSyncModalMode(mode) {
  syncModalMode = mode;
  const text = SYNC_MODAL_TEXT[mode];
  const choosing = mode === "create" || mode === "reset";
  document.getElementById("sync-modal-title").textContent = text.title;
  document.getElementById("sync-modal-intro").textContent = text.intro;
  document.getElementById("sync-submit").textContent = text.button;
  document.getElementById("sync-pass-fields").hidden = mode === "stop";
  document.getElementById("sync-stop-fields").hidden = mode !== "stop";
  document.getElementById("sync-confirm-wrap").hidden = !choosing;
  document.getElementById("sync-ack-wrap").hidden = !choosing;
  document.getElementById("sync-forgot-wrap").hidden = mode !== "unlock";
  document.getElementById("sync-passphrase").setAttribute("autocomplete", choosing ? "new-password" : "current-password");
  document.getElementById("sync-submit").className = mode === "reset" || mode === "stop" ? "btn btn-danger-soft" : "btn btn-luniva";
  hideFormAlert(document.getElementById("sync-alert"));
  ["sync-passphrase", "sync-passphrase-confirm", "sync-ack"].forEach(function (id) {
    clearFieldError(document.getElementById(id));
  });
}

/** Open the window. Resolves true when the action finished, false if cancelled. */
function openSyncModal(mode) {
  if (!syncModal) buildSyncModal();
  document.getElementById("sync-passphrase").value = "";
  document.getElementById("sync-passphrase-confirm").value = "";
  document.getElementById("sync-ack").checked = false;
  document.getElementById("sync-delete-copy").checked = true;
  setSyncModalMode(mode);
  return new Promise(function (resolve) {
    let finished = false;
    syncModalDone = function () { finished = true; };
    document.getElementById("sync-modal").addEventListener("hidden.bs.modal", function () {
      resolve(finished);
    }, { once: true });
    syncModal.show();
  });
}

function submitSyncModal() {
  const passInput = document.getElementById("sync-passphrase");
  const confirmInput = document.getElementById("sync-passphrase-confirm");
  const ackInput = document.getElementById("sync-ack");
  const submitButton = document.getElementById("sync-submit");
  const alertBox = document.getElementById("sync-alert");
  const mode = syncModalMode;
  hideFormAlert(alertBox);

  let action;
  if (mode === "stop") {
    const deleteCopy = document.getElementById("sync-delete-copy").checked;
    action = stopSync(deleteCopy).then(function () {
      showToast(deleteCopy ? "Sync is off and your encrypted copy was deleted." : "Sync is off on this device.", "info");
    });
  } else {
    [passInput, confirmInput, ackInput].forEach(clearFieldError);
    const passphrase = passInput.value;
    if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
      setFieldError(passInput, "Use at least " + MIN_PASSPHRASE_LENGTH + " characters — a short sentence works well.");
      passInput.focus();
      return;
    }
    if (mode !== "unlock") {
      if (confirmInput.value !== passphrase) {
        setFieldError(confirmInput, "Passphrases don't match yet.");
        confirmInput.focus();
        return;
      }
      if (!ackInput.checked) {
        setFieldError(ackInput, "Please confirm you understand this first.");
        ackInput.focus();
        return;
      }
    }
    if (mode === "create") {
      action = createSync(passphrase).then(function () { showToast("Encrypted sync is on 🔒", "success"); });
    } else if (mode === "reset") {
      action = resetSync(passphrase).then(function () { showToast("Started fresh — encrypted sync is on 🔒", "success"); });
    } else {
      action = joinSync(passphrase).then(function () { showToast("Your records are restored and syncing 🔒", "success"); });
    }
  }

  setBusy(submitButton, true, mode === "stop" ? "Turning off…" : mode === "unlock" ? "Unlocking…" : "Encrypting…");
  action.then(function () {
    setBusy(submitButton, false);
    if (syncModalDone) syncModalDone();
    syncModal.hide();
    renderSyncSettings();
    renderRestoreBanner();
  }).catch(function (error) {
    setBusy(submitButton, false);
    showFormAlert(alertBox, escapeHtml(friendlySyncError(error)));
    if (mode !== "stop") passInput.focus();
  });
}

/* ---------------------------------------------------------
   9. PAGE UI: Settings card + "restore" banners
   --------------------------------------------------------- */

function formatSyncTime(isoString) {
  if (!isoString) return "not yet";
  const date = new Date(isoString);
  const today = todayString();
  const day = toDateString(date);
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return day === today ? "today at " + time : formatDisplayDate(day) + " at " + time;
}

/** Settings → "Encrypted sync" card (element #sync-settings). */
function renderSyncSettings() {
  const box = document.getElementById("sync-settings");
  if (!box) return;
  const state = getSyncState();

  if (!isSyncSupported()) {
    box.innerHTML = '<p class="text-muted-soft mb-0">Encrypted sync isn\'t available in this browser right now.</p>';
    return;
  }

  const notice = state.notice
    ? '<p class="calm-note mb-3"><i class="bi bi-info-circle" aria-hidden="true"></i><span>' + escapeHtml(state.notice) + "</span></p>"
    : "";

  if (state.enabled) {
    box.innerHTML = notice +
      '<p class="sync-status"><span class="status-dot status-synced" aria-hidden="true"></span><strong>On</strong> · Last synced ' +
      escapeHtml(formatSyncTime(state.lastSyncedAt)) + (state.dirty ? " · changes waiting to sync" : "") + "</p>" +
      '<p class="small text-muted-soft">Your records are encrypted on this device before they\'re saved to your account.</p>' +
      '<div class="d-flex flex-wrap gap-2">' +
        '<button type="button" class="btn btn-outline-luniva" id="sync-now"><i class="bi bi-arrow-repeat" aria-hidden="true"></i> Sync now</button>' +
        '<button type="button" class="btn btn-ghost" id="sync-stop">Turn off sync</button>' +
      "</div>";
    document.getElementById("sync-now").addEventListener("click", function () {
      const button = this;
      setBusy(button, true, "Syncing…");
      syncNow().then(function (result) {
        setBusy(button, false);
        const messages = {
          "up-to-date": "Everything is up to date.", pushed: "Synced.", pulled: "Updated from your other device.",
          merged: "Combined with your other device.", offline: "You're offline — Luniva will sync when you reconnect.",
          error: "Couldn't sync right now. Please try again later."
        };
        showToast(messages[result] || "Synced.", result === "error" ? "warning" : "success");
        if (result === "pulled" || result === "merged") setTimeout(function () { location.reload(); }, 900);
      });
    });
    document.getElementById("sync-stop").addEventListener("click", function () { openSyncModal("stop"); });
    return;
  }

  box.innerHTML = notice +
    '<p class="sync-status"><span class="status-dot" aria-hidden="true"></span><strong>Off</strong> · Your records are only on this device.</p>' +
    '<ul class="sync-points">' +
      '<li><i class="bi bi-lock" aria-hidden="true"></i> Records are encrypted on your device with a passphrase only you know.</li>' +
      '<li><i class="bi bi-phone" aria-hidden="true"></i> Use Luniva on more than one device and keep a safe backup.</li>' +
      '<li><i class="bi bi-eye-slash" aria-hidden="true"></i> Nobody — not even Luniva — can read your synced records.</li>' +
    "</ul>" +
    '<button type="button" class="btn btn-luniva" id="sync-start"><i class="bi bi-shield-lock" aria-hidden="true"></i> Turn on encrypted sync</button>';
  document.getElementById("sync-start").addEventListener("click", function () {
    const button = this;
    setBusy(button, true, "Checking…");
    remoteCopyExists().then(function (exists) {
      setBusy(button, false);
      openSyncModal(exists ? "unlock" : "create").then(function (done) {
        if (done && exists) setTimeout(function () { location.reload(); }, 900);
      });
    });
  });
}

/**
 * Dashboard / onboarding banner (#sync-restore-banner): shown when the
 * account has an encrypted copy but this device isn't syncing yet.
 */
function renderRestoreBanner() {
  const banner = document.getElementById("sync-restore-banner");
  if (!banner) return;
  if (getSyncState().enabled) {
    banner.hidden = true;
    return;
  }
  remoteCopyExists().then(function (exists) {
    banner.hidden = !exists;
    if (!exists || banner.getAttribute("data-ready")) return;
    banner.setAttribute("data-ready", "1");
    banner.querySelector("[data-sync-restore]").addEventListener("click", function () {
      openSyncModal("unlock").then(function (done) {
        if (!done) return;
        const user = getUser() || {};
        setTimeout(function () {
          window.location.href = user.onboardingComplete ? "dashboard.html" : "onboarding.html";
        }, 900);
      });
    });
  });
}

/* ---------------------------------------------------------
   START-UP
   --------------------------------------------------------- */

onSyncedDataChange = markRecordsChanged;

(function startSync() {
  const pageReady = typeof APP_PAGE_ALLOWED === "undefined" || APP_PAGE_ALLOWED;
  if (!pageReady) return;

  renderSyncSettings();
  renderRestoreBanner();

  if (getSyncState().enabled) {
    syncNow().then(function (result) {
      // Another device changed records: reload so every number is fresh.
      if (result === "pulled" || result === "merged") {
        showToast("Updated with changes from your other device.", "info");
        setTimeout(function () { location.reload(); }, 900);
      }
    });
  }

  window.addEventListener("online", function () {
    if (getSyncState().enabled) syncNow();
  });
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden" && getSyncState().dirty) syncNow();
  });
})();
