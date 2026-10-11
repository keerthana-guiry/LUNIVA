# Turning on Luniva accounts (Supabase)

Luniva uses **Supabase Auth** for sign-up, email verification codes, login codes, password reset and Google sign-in. Supabase stores passwords securely on its servers, so they are never saved in the browser. Health data still stays on each person's device.

This takes about 20–30 minutes the first time. Nothing here costs money on the free plans.

---

## 1. Create a Supabase project

1. Go to **https://supabase.com** → **Start your project** → sign in (GitHub is easiest).
2. Click **New project**. Pick a name (e.g. `luniva`), choose a strong database password (save it somewhere safe), and pick the region closest to your users (e.g. *Mumbai* for India).
3. Wait about 2 minutes for it to finish setting up.

## 2. Copy your project details into `js/config.js`

1. In Supabase, open **Project Settings → API** (or **Data API**).
2. Copy the **Project URL** and the **anon public** key.
3. Paste them into `js/config.js`:

```js
const LUNIVA_CONFIG = {
  supabaseUrl: "https://YOUR-PROJECT.supabase.co",
  supabaseAnonKey: "eyJhbGciOi..."
};
```

The **anon** key is meant to be public, so it's safe in the website. **Never** paste the `service_role` key anywhere in this project.

## 3. Make the emails send 6-digit codes

Luniva asks people to type a code (it works on phones without switching apps). The default Supabase emails send links instead, so change three templates.

Go to **Authentication → Emails → Templates** (older dashboards: **Authentication → Email Templates**) and, in each template below, make sure the body contains `{{ .Token }}`:

**Confirm signup**
```html
<h2>Welcome to Luniva 🌙</h2>
<p>Your verification code is:</p>
<p style="font-size:28px;font-weight:bold;letter-spacing:6px">{{ .Token }}</p>
<p>Enter it in Luniva to verify your email. If you didn't sign up, you can ignore this email.</p>
```

**Magic Link** (used for "Email me a login code")
```html
<h2>Your Luniva login code</h2>
<p style="font-size:28px;font-weight:bold;letter-spacing:6px">{{ .Token }}</p>
<p>This code expires soon. If you didn't try to log in, you can ignore this email.</p>
```

**Reset Password**
```html
<h2>Reset your Luniva password</h2>
<p>Your reset code is:</p>
<p style="font-size:28px;font-weight:bold;letter-spacing:6px">{{ .Token }}</p>
<p>If you didn't ask to reset your password, you can ignore this email.</p>
```

Also check **Authentication → Sign In / Providers → Email**:
- **Enable Email provider**: on
- **Confirm email**: on (this is what requires the code before first login)
- **Email OTP Length**: 6 (the Luniva code box expects exactly 6 digits)
- **Minimum password length**: 8

## 4. Set up real email sending (needed before launch)

Supabase's built-in email service is only for testing: it sends just a few emails per hour and **only to email addresses of your Supabase team members**. Real users won't receive codes until you connect your own email sender.

1. Create a free account with an email service such as **Resend** (resend.com) or **Brevo** (brevo.com), and verify your sending domain (or use their test domain while testing).
2. In Supabase open **Project Settings → Authentication → SMTP Settings** (or **Authentication → Emails → SMTP Settings**) → **Enable custom SMTP**, and paste the host, port, username and password from that service. Set the sender name to `Luniva`.

## 5. Tell Supabase where your website lives

**Authentication → URL Configuration**
- **Site URL**: your live site, e.g. `https://myluniva.netlify.app`
- **Redirect URLs**: add each place Luniva runs, ending in `/login.html`:
  - `https://myluniva.netlify.app/login.html`
  - `http://localhost:8000/login.html` (for testing on your computer)

Google sign-in only returns people to URLs on this list.

## 6. Turn on "Continue with Google"

**a) In Google Cloud**
1. Go to **https://console.cloud.google.com** → create a project (e.g. `Luniva`).
2. **APIs & Services → OAuth consent screen**: choose **External**, fill in the app name `Luniva`, your support email and your website, and save. (While it's in "Testing" mode, add your own Google account under **Test users**.)
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**
   - **Authorized JavaScript origins**: your site, e.g. `https://myluniva.netlify.app` (and `http://localhost:8000` for testing)
   - **Authorized redirect URIs**: copy the **Callback URL** shown in Supabase (next step). It looks like `https://YOUR-PROJECT.supabase.co/auth/v1/callback`
4. Click **Create** and copy the **Client ID** and **Client secret**.

**b) In Supabase**
1. **Authentication → Sign In / Providers → Google** → turn it on.
2. Paste the **Client ID** and **Client secret** and save.

Before the public launch, go back to Google's OAuth consent screen and click **Publish app** so anyone (not just test users) can sign in.

## 7. Try it

1. Commit the updated `js/config.js` and deploy (or run `python3 -m http.server 8000` and open http://localhost:8000).
2. Sign up with your email → you should get a 6-digit code → enter it → onboarding.
3. Log out, then try **Email me a login code instead**, **Forgot password?** and **Continue with Google**.

## Troubleshooting

| What you see | What to check |
| --- | --- |
| "Luniva accounts aren't connected yet" | `js/config.js` is empty or has a typo. |
| No email arrives | Step 4 (custom SMTP). Check spam. The built-in sender only mails team members. |
| Email arrives with a link but no code | Step 3: the template is missing `{{ .Token }}`. |
| "That code is wrong or has expired" | Use the newest email; codes expire (default 1 hour). Use "Resend code". |
| Google shows `redirect_uri_mismatch` | The Google redirect URI must exactly match Supabase's Callback URL. |
| Google returns to the wrong site | Add your site's `/login.html` to Supabase's Redirect URLs (step 5). |
| "Too many emails were requested" | Supabase rate limit; wait a minute. Limits can be raised under Authentication → Rate Limits. |

## What's still on this device only

Accounts now live in Supabase, but health records (periods, check-ins, settings) are still stored only in the browser of each device. Logging in on a new phone starts with a fresh setup. Syncing records to the account is the next backend step. "Delete Data" in Settings removes data from the device and logs out; deleting the Supabase account itself will need a small server function later.

## 8. Turn on encrypted sync (optional feature for users)

Users can choose to sync their records across devices. Records are encrypted in the browser with the user's own passphrase before upload, so the database only ever holds unreadable ciphertext.

The table it needs is created once:

1. In Supabase open **SQL Editor → New query**.
2. Paste everything from [`supabase/luniva_sync.sql`](supabase/luniva_sync.sql) and click **Run**.
3. You should see "Success. No rows returned". Under **Table Editor** a table called `luniva_sync` appears with a green **RLS enabled** label.

Each account can only read and write its own row (Row Level Security). Luniva cannot decrypt anyone's records; if a user forgets their passphrase, their synced copy can only be deleted and started again.

## 9. Turn on the feedback form

The **Send feedback** page (links in Settings → About, the account menu, the footer of every app page and the landing page) saves messages to a table only you can read.

1. In Supabase open **SQL Editor → New query**.
2. Paste everything from [`supabase/luniva_feedback.sql`](supabase/luniva_feedback.sql) and click **Run**.
3. You should see "Success. No rows returned". A table called `luniva_feedback` appears under **Table Editor**.

To read feedback: **Table Editor → luniva_feedback**. The website can only add rows — nobody can read feedback through the site, only you in the dashboard.

**Summary (optional):** run [`supabase/luniva_feedback_summary.sql`](supabase/luniva_feedback_summary.sql) once the same way. Table Editor then also shows three live, read-only views:

- `luniva_feedback_summary` — total messages, average rating, happy/unhappy, problems/ideas/loves, last 7 days, how many want a reply
- `luniva_feedback_by_week` — the same week by week
- `luniva_feedback_to_reply` — messages where someone left their email, newest first

## 10. Turn on phone reminders (web push)

Lets people get one daily reminder on their phone, even when Luniva is closed (Settings → Notifications → Phone reminders). The server only stores each device's push address, hour and time zone; the reminder text is decided on the phone, so no health data is sent.

Everything you need is shown on **https://myluniva.netlify.app/push-setup.html** (keys are created in your browser — keep the page open until you finish):

1. **Secrets** — Supabase → **Edge Functions → Secrets**: add `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `CRON_SECRET` from part A.
2. **Function** — Supabase → **Edge Functions → Deploy a new function → Via Editor**. Name it `luniva-push`, replace the sample code with part B ([`supabase/functions/luniva-push/index.ts`](supabase/functions/luniva-push/index.ts)) and deploy. Then open the function's **Details** and turn **off** "Verify JWT" / "Enforce JWT verification" (the function checks access itself) and save.
3. **SQL** — Supabase → **SQL Editor → New query**: paste part C and Run. It creates the `luniva_push` table ([`supabase/luniva_push.sql`](supabase/luniva_push.sql)) and a schedule that checks every 15 minutes for reminders that are due.
4. **Try it** — on your phone open Luniva → Settings → Phone reminders → **Turn on**, then **Send a test**. On iPhone, Luniva must be added to the Home Screen first (iOS 16.4+).

If you ever need new keys, repeat steps 1 and 3 with a fresh setup page; everyone then turns reminders on again.
