# Noor Prayer Times — Production-Grade Vercel + Hono + Supabase

Accurate prayer-time PWA for **Nizhny Novgorod** (Europe/Moscow timezone).
CSV-driven monthly schedules, JWT-protected admin, Service-Worker scheduling
for Adhan/notifications, full bilingual UI (RU/EN), realtime cross-device
sync via lightweight version polling.

---

## Architecture (final, single chosen path)

```
┌────────────────────────────────────────────────────────────────────┐
│                              Vercel                                │
│                                                                    │
│   ┌──────────────────────────┐    ┌─────────────────────────────┐  │
│   │  Static (public/)        │    │  Serverless Function        │  │
│   │  /static/app.js          │    │  api/index.ts               │  │
│   │  /static/styles.css      │    │  Runtime: Node.js 20.x      │  │
│   │  /sw.js  /manifest.json  │    │  Framework: Hono            │  │
│   │  /icons/*  /audio/*      │◄──►│  • HTML pages (/, /home …)  │  │
│   │  /favicon.svg            │    │  • JSON API (/api/*)        │  │
│   └──────────────────────────┘    │  • CSV upload (multipart)   │  │
│                                   └──────────────┬──────────────┘  │
└──────────────────────────────────────────────────┼─────────────────┘
                                                   │ HTTPS + JWT
                                                   ▼
                                       ┌────────────────────────┐
                                       │   Supabase PostgREST   │
                                       │   prayer_times table   │
                                       └────────────────────────┘
```

### Why this architecture (and not the others we tried)

| Option | Verdict | Why |
|---|---|---|
| **Hono on Vercel Node.js, exported as `export default app`** ✅ **(chosen)** | Works | Vercel natively detects Hono; calls `app.fetch(req)` directly. Web-standard `Request`/`Response`/`FormData` is fully supported on Node 20 — required for `c.req.formData()` in CSV upload. Zero wrappers, zero adapters. |
| Hono on Vercel Edge | Rejected | Edge runtime has stricter Web-API limits; some Hono internals + Supabase fetch patterns surface flakiness. CSV multipart parsing works but offers no upside here. |
| `export default handle(app)` from `hono/vercel` | Redundant | Vercel's native Hono detector wraps `app.fetch` itself; `handle()` adds an extra layer that historically caused `default-export signature (req, res) => void` warnings. |
| `export default async (req) => handler(req)` (Node-style wrapper) | Broken | This was the root cause of the `Vercel Runtime Timeout (504)` + `FUNCTION_INVOCATION_FAILED` errors — the wrapper returned a `Response` object on a runtime that expected `(req, res) => void`. |
| `api/index.ts` re-exporting from `src/index.ts` | Broken | `export { default } from '../src/index.ts'` → TS5097. Removing `.ts` → `ERR_MODULE_NOT_FOUND` at runtime. `includeFiles: "src/**"` "fixed" it but is brittle. |
| `includeFiles` in `vercel.json` | Removed | Not needed once `api/index.ts` is self-contained. |

### What lives where

```
.
├── api/
│   └── index.ts          ← single self-contained Vercel Function (Hono app)
├── public/
│   ├── audio/            ← adhan.mp3, notification.wav
│   ├── icons/            ← icon-192.png, icon-512.png
│   ├── static/
│   │   ├── app.js        ← client-side prayer/notification logic
│   │   └── styles.css    ← original dark Islamic aesthetic (untouched)
│   ├── favicon.svg
│   ├── manifest.json     ← PWA manifest
│   └── sw.js             ← Service Worker (cache-bust + notification timers)
├── package.json
├── tsconfig.json
├── vercel.json           ← rewrites + headers, NO functions/includeFiles hacks
├── .env.example
├── .gitignore
├── .vercelignore
├── supabase-schema.sql   ← run once in Supabase SQL Editor
└── README.md             ← this file
```

---

## Deployment (5 steps, then it just works)

### 1. Create the Supabase table

In your Supabase project → **SQL Editor → New Query** → paste the contents of
[`supabase-schema.sql`](./supabase-schema.sql) → **Run**.

### 2. Push the repo to GitHub

```bash
git init
git add .
git commit -m "Noor Prayer Times — production deploy"
git branch -M main
git remote add origin git@github.com:<you>/noor-prayer-times.git
git push -u origin main
```

### 3. Import into Vercel

Vercel Dashboard → **Add New… → Project** → import the GitHub repo →
**Deploy**. Vercel auto-detects Hono; **do not** override Framework Preset,
Build Command, or Output Directory.

### 4. Set environment variables

Vercel → Project → **Settings → Environment Variables** → add **for all
three scopes** (Production, Preview, Development):

| Key | Example value | Source |
|---|---|---|
| `SUPABASE_URL` | `https://abcd1234efgh.supabase.co` | Supabase → Project Settings → API → **Project URL** |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJhbGciOi...` | Supabase → Project Settings → API → **service_role secret** |
| `ADMIN_PASSWORD` | any strong password | choose your own |

> ⚠️  **`SUPABASE_URL` must start with `https://`** — pasting a publishable
> key (`sb_publishable_…`) or the JWT here is the #1 production foot-gun and
> produces `ERR_INVALID_URL` deep inside `fetch()`. The function now refuses
> any non-`https://` value and surfaces a descriptive error in the API
> response instead.

### 5. Redeploy

Vercel → Deployments → **Redeploy** the latest deployment so the new env
vars take effect.

That's it. Hit `https://<your-project>.vercel.app/` — the splash page
loads, `/home` shows today's prayer times, `/admin` accepts the password
and lets you upload CSVs.

---

## Verifying the deploy

Visit each of these URLs and confirm the expected response:

| URL | Expected |
|---|---|
| `/api/health` | `{ success: true, data: { supabase: { urlConfigured: true, urlIsHttps: true, serviceKeyConfigured: true }, … } }` |
| `/api/data-version` | `{ success: true, data: { version: <number> } }` |
| `/api/prayer-times/today` | `{ success: true, data: { today: {...} or null, … } }` |
| `/` | HTML splash page |
| `/home` | HTML dashboard |
| `/admin` | HTML admin login form |

If `/api/health` reports `urlConfigured: false` or `serviceKeyConfigured:
false`, your environment variables aren't set correctly (or the project
wasn't redeployed after you added them).

---

## CSV format

Headers are **case-insensitive** and **order-independent**:

```csv
date,fajr,dhuhr,asr,maghrib,isha,city
2026-05-01,02:32,12:30,16:39,19:44,21:31,Nizhny Novgorod
2026-05-02,02:30,12:30,16:40,19:46,21:33,Nizhny Novgorod
```

Accepted formats:

* **Encoding**: UTF-8, with or without BOM.
* **Line endings**: LF, CRLF, or CR (Excel-on-Windows quirks supported).
* **Dates**: `YYYY-MM-DD`, `DD/MM/YYYY`, or `DD.MM.YYYY`.
* **Times**: `H:MM`, `HH:MM`, or `HH:MM:SS` (seconds dropped).
* **Quoted fields**: `"Nizhny Novgorod, RU"` is one column.

Invalid rows are reported individually; valid rows still go through. If the
admin UI shows `0 valid rows`, scroll down to the **Row-level Errors** card
— it lists the exact reason for every rejected row.

---

## Local development

```bash
npm install
cp .env.example .env.local        # then fill in real values
vercel dev                        # starts a local dev server on :3000
```

Note: `vercel dev` requires the [Vercel CLI](https://vercel.com/docs/cli)
to be logged in once (`vercel login`) and the project linked (`vercel
link`). After that, the dev server mimics production routing (rewrites,
headers, env vars) exactly.

---

## Pre-deploy checklist

Before pushing to production, confirm:

- [ ] `supabase-schema.sql` has been run in the Supabase SQL Editor.
- [ ] `SUPABASE_URL` in Vercel **starts with `https://`** and ends with
      `.supabase.co`.
- [ ] `SUPABASE_SERVICE_ROLE_KEY` in Vercel **starts with `eyJ`** and is
      the *service_role* key (NOT anon, NOT publishable).
- [ ] `ADMIN_PASSWORD` is set to something strong (NOT the default).
- [ ] Env vars are set for **all three scopes** (Production, Preview,
      Development), and a fresh deploy has run since they were added.
- [ ] `package.json` has been committed (it lists `hono` + `jose`).
- [ ] `node_modules/`, `.vercel/`, and `.env*` are in `.gitignore`.
- [ ] `vercel.json` has been committed (rewrites + cache headers).
- [ ] No `includeFiles`, no `functions: { runtime: ... }`, no
      `wrangler.jsonc`, no `vite.config.ts`, no `src/` — those are all
      Cloudflare/dual-runtime leftovers and have been removed.
- [ ] `/api/health` returns `urlIsHttps: true` and
      `serviceKeyConfigured: true` once deployed.

---

## Troubleshooting

### `ERR_INVALID_URL`
You pasted a Supabase publishable key (`sb_publishable_…`) or the JWT into
`SUPABASE_URL`. Fix: paste the **Project URL** from Supabase → Settings →
API instead. It always looks like `https://<ref>.supabase.co`.

### `Unauthorized` from `/api/admin/*`
The `noor-admin-session` cookie expired (12 h TTL) or was never issued.
Hit `/admin`, enter the password, get a fresh cookie.

### `0 valid rows` after CSV upload
Open the **Row-level Errors** panel — it lists the exact reason (missing
column, malformed date, malformed time). If the message says *"Missing
required column(s): …"*, the header row is wrong.

### Service Worker shows stale data
Every CSV upload bumps the server-side data version. Client polls
`/api/data-version` every 30 s, on tab focus, and on `online`. When the
version changes it calls `caches.delete` for `/api/*` and re-fetches. If
you're still seeing old data:
1. DevTools → Application → Service Workers → **Unregister**.
2. DevTools → Application → Clear storage → **Clear site data**.
3. Hard reload.

This is only needed when you change `sw.js` itself — for data changes the
auto-bust already does the right thing.

### Function timeouts (504)
Should not happen with the current code (every route returns under 1 s).
If it does, check `/api/health` first — a Supabase env-var mistake can
cause `fetch()` to hang on DNS lookup of an invalid hostname.

---

Developed by Ahmed Hussien.
