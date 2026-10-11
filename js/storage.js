/* =========================================================
   Luniva — storage.js
   The ONLY file that touches localStorage directly.
   Every other script reads and writes data through these
   helper functions, so the storage layer can later be swapped
   for a real backend without rewriting the pages.
   ========================================================= */

// All data keys used by Luniva. No other keys are ever created.
const STORAGE_KEYS = {
  user: "luniva_user",
  settings: "luniva_settings",
  periods: "luniva_periods",
  dailyLogs: "luniva_dailyLogs",
  notifications: "luniva_notifications"
};

const STORAGE_PREFIX = "luniva_";

// The login session saved by Supabase Auth (see config.js / auth.js).
// It shares the luniva_ prefix so clearAllData() also logs the user out,
// but it is never included in data exports.
const AUTH_STORAGE_KEY = "luniva_auth";

// Encrypted-sync settings for THIS device (see sync.js). Holds the
// device's encryption key, so it is never exported.
const SYNC_STORAGE_KEY = "luniva_sync";

// Phone-reminder settings for THIS device (see push.js). Never exported.
const PUSH_STORAGE_KEY = "luniva_push";

// Keys whose contents are included in encrypted sync.
const SYNCED_KEYS = ["luniva_user", "luniva_settings", "luniva_periods", "luniva_dailyLogs", "luniva_notifications"];

// Optional function called after a synced key is saved (set by sync.js).
let onSyncedDataChange = null;

/**
 * Read a key and return the parsed value, or null if it is missing
 * or the stored JSON is corrupted (so a bad value never crashes a page).
 */
function getData(key) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    return JSON.parse(raw);
  } catch (error) {
    console.warn("Luniva: could not read '" + key + "'", error);
    return null;
  }
}

/** Save a value under a key, overwriting whatever was there. */
function saveData(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    if (onSyncedDataChange && SYNCED_KEYS.indexOf(key) !== -1) onSyncedDataChange(key);
    return true;
  } catch (error) {
    console.error("Luniva: could not save '" + key + "'", error);
    return false;
  }
}

/**
 * Merge a partial object into the object already stored under a key.
 * Example: updateData("luniva_user", { name: "Asha" }) keeps email etc.
 */
function updateData(key, partialObject) {
  const current = getData(key);
  const base = current && typeof current === "object" && !Array.isArray(current) ? current : {};
  const merged = Object.assign({}, base, partialObject);
  saveData(key, merged);
  return merged;
}

/** Remove a single key. */
function deleteData(key) {
  try {
    localStorage.removeItem(key);
  } catch (error) {
    console.error("Luniva: could not delete '" + key + "'", error);
  }
}

/** Remove every key that starts with "luniva_". */
function clearAllData() {
  try {
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.indexOf(STORAGE_PREFIX) === 0) keysToRemove.push(key);
    }
    keysToRemove.forEach(function (key) {
      localStorage.removeItem(key);
    });
  } catch (error) {
    console.error("Luniva: could not clear data", error);
  }
}

/** Remove the user's Luniva data (and this device's sync set-up) but keep the login session. */
function clearUserData() {
  Object.keys(STORAGE_KEYS).forEach(function (name) {
    deleteData(STORAGE_KEYS[name]);
  });
  deleteData(SYNC_STORAGE_KEY);
  deleteData(PUSH_STORAGE_KEY);
}

/** Collect all luniva_* data into one object (used by Export Data). */
function getAllData() {
  const allData = {};
  Object.keys(STORAGE_KEYS).forEach(function (name) {
    const key = STORAGE_KEYS[name];
    allData[key] = getData(key);
  });
  return allData;
}
