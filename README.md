# LUNIVA
Luniva — a privacy-first menstrual health & wellness companion. Track periods, flow, pain, sleep, mood and cravings, get cycle predictions and pad reminders, and find comfort in the Companion space. Built with HTML, CSS, Bootstrap 5 and vanilla JavaScript.

*Your Cycle. Your Rhythm. Your Luniva.*

## Running it

No build step is needed. Serve the folder with any static server and open `index.html`, for example:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

Bootstrap 5.3.3, Bootstrap Icons 1.11.3 and Supabase JS 2.117.2 load from the jsDelivr CDN.

## Install as an app

Luniva is a Progressive Web App. On Android/Chrome/Edge an **Install** button appears on the landing page, dashboard and Settings; on iPhone/iPad use Share → Add to Home Screen. Once opened, pages work offline. To force every device to refresh its saved copy after a big change, bump `CACHE_VERSION` in `sw.js`.

## Accounts

Sign-up, email verification codes, login codes, password reset and Google sign-in use **Supabase Auth**. Until you add your project details to `js/config.js`, the sign-up and login pages explain that accounts aren't connected yet. Follow **[SETUP-ACCOUNTS.md](SETUP-ACCOUNTS.md)** to turn them on.

## Privacy

Passwords are handled by Supabase and never stored in the browser. Health records (periods, check-ins, settings, notifications) are stored only in the browser's `localStorage` on each device and are not sent anywhere. Settings → Privacy lets you export all data as JSON or delete it.

## Structure

```
index.html          Landing page (features, how it works, privacy)
signup.html         Create account
login.html          Log in
onboarding.html     4-step setup: name, cycle, tracking, reminders
dashboard.html      Cycle ring, pad reminder, quick stats, check-in, comfort
tracker.html        Calendar, flow per day, "Has your period ended?"
checkin.html        Daily check-in (mood, energy, pain, flow, sleep, cravings…)
insights.html       Averages and patterns drawn with CSS bars
history.html        Filterable table of records (cards on phones)
companion.html      Supportive messages, jokes, questions, tiny challenges
notifications.html  In-app notification centre
settings.html       Profile, cycle, tracking, notifications, privacy, about
privacy.html        Privacy Policy
terms.html          Terms of Use
offline.html        Shown when offline and a page isn't saved yet
manifest.webmanifest  App name, colours, icons (installable PWA)
sw.js               Service worker: offline support (network-first)

css/style.css       All styles (design tokens at the top)
js/config.js        Supabase project URL + public anon key
js/storage.js       The only file that touches localStorage
js/app.js           Date helpers, cycle calculations, toasts, route guard,
                    navigation, shared option lists, dashboard
js/auth.js          Sign up + email code, log in (password / code / Google),
                    password reset, log out, onboarding, settings
js/tracker.js       Period tracker
js/checkin.js       Daily check-in
js/insights.js      Insights and history
js/companion.js     Companion page
js/notifications.js Creates due reminders on every app page + notification centre
assets/images/      Logo
```

App pages load `storage.js`, then `app.js`, then `notifications.js`, then their own script.

## Data (localStorage keys)

| Key | Shape |
| --- | --- |
| `luniva_user` | `{ id, name, email, heightCm, createdAt, onboardingComplete }` |
| `luniva_settings` | `{ cycleLength, periodLength, padReminderDays, trackWeight, tracking{…}, notifications{…} }` |
| `luniva_periods` | `[{ id, startDate, endDate (null while active), status: "active" \| "ended" }]` |
| `luniva_dailyLogs` | `{ "YYYY-MM-DD": { flow, pain, painLocations[], symptoms[], mood, energy, sleep{…}, cravings[], weightKg, notes } }` |
| `luniva_notifications` | `[{ id, type, message, date, read }]` |
| `luniva_auth` | Supabase login session (managed by Supabase; not exported) |

Dates are always local `YYYY-MM-DD` strings (never `toISOString()`), so days don't shift across time zones.

## Key rules

- A period is **never ended automatically**. It ends only when the user confirms an end date; periods active for more than 10 days prompt again.
- Every number is computed from stored data. With too little data, friendly empty states are shown.
- Luniva is a tracking and wellness tool. It does not diagnose or give medical advice.
