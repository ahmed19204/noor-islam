// ─────────────────────────────────────────────────────────────────────────────
// Noor Prayer Times — Vercel Function Entry (self-contained, zero-config)
// ─────────────────────────────────────────────────────────────────────────────
//
// ARCHITECTURE (final, production-grade):
//
//   • Single self-contained Vercel Function at `api/index.ts`.
//   • Zero cross-directory imports (no `../src/...`) → eliminates the TS5097
//     and ERR_MODULE_NOT_FOUND class of bugs entirely.
//   • Zero `includeFiles` hacks in vercel.json → no fragile bundling.
//   • Runtime: Vercel Node.js Serverless (NOT Edge). Required because Hono's
//     `c.req.formData()` on a `multipart/form-data` upload uses the Web
//     standard `FormData` parser which is fully supported on Vercel Node 20+.
//   • Hono is exported as the DEFAULT EXPORT, the way Vercel's native Hono
//     detector expects (https://vercel.com/docs/frameworks/backend/hono).
//     We do NOT wrap with `handle()` and we do NOT use `(req, res) =>`. The
//     Vercel runtime calls `app.fetch(request)` directly. This eliminates the
//     `default export returned a Response` and `(req, res) => void` warnings.
//   • `vercel.json` rewrites every non-asset path to `/api`, so the Hono app
//     serves both the HTML pages (`/`, `/home`, `/schedule`, `/admin`, …)
//     and the JSON endpoints (`/api/*`).
//
// ENVIRONMENT VARIABLES (set in Vercel → Project → Settings → Environment
// Variables, scope: Production + Preview + Development):
//
//   SUPABASE_URL                 https://<project-ref>.supabase.co   (required)
//   SUPABASE_SERVICE_ROLE_KEY    eyJ...   service_role JWT           (required)
//   ADMIN_PASSWORD               strong password for /admin          (required)
//
// SUPABASE_URL MUST start with `https://`. If a publishable key
// (`sb_publishable_…`) or the service-role JWT is pasted here by mistake,
// `assertHttpsUrl()` throws a loud, descriptive error instead of leaking
// ERR_INVALID_URL out of `fetch()`.
//
// SUPABASE TABLE (run once in Supabase SQL Editor — see supabase-schema.sql):
//
//   create table prayer_times (
//     id          bigserial primary key,
//     date        date        not null,
//     fajr        text        not null,
//     dhuhr       text        not null,
//     asr         text        not null,
//     maghrib     text        not null,
//     isha        text        not null,
//     city        text        not null,
//     created_at  timestamptz default now(),
//     updated_at  timestamptz default now(),
//     unique (date, city)
//   );
// ─────────────────────────────────────────────────────────────────────────────

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { SignJWT, jwtVerify } from 'jose'

// ─────────────────────────────────────────────────────────────────────────────
// Bindings & env helpers
// ─────────────────────────────────────────────────────────────────────────────
type Bindings = {
  SUPABASE_URL?: string
  SUPABASE_ANON_KEY?: string
  SUPABASE_SERVICE_ROLE_KEY?: string
  ADMIN_PASSWORD?: string
  // Accepted legacy aliases — value still validated by assertHttpsUrl().
  VITE_PUBLIC_SUPABASE_URL?: string
  VITE_PUBLIC_SUPABASE_ANON_KEY?: string
  NEXT_PUBLIC_SUPABASE_URL?: string
}

function readEnv(env: Bindings, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const fromBindings = (env as Record<string, unknown>)?.[k]
    if (typeof fromBindings === 'string' && fromBindings.trim()) return fromBindings.trim()
    const fromProcess =
      typeof process !== 'undefined' && process?.env
        ? (process.env as Record<string, string | undefined>)[k]
        : undefined
    if (typeof fromProcess === 'string' && fromProcess.trim()) return fromProcess.trim()
  }
  return undefined
}

/**
 * Hard validation: Supabase project URL must be a real `https://` URL.
 *
 * The most common production foot-gun is pasting a publishable key
 * (`sb_publishable_…`) or the service-role JWT itself into SUPABASE_URL.
 * The previous version did `new URL(maybeJwt + '/rest/v1')` → ERR_INVALID_URL
 * deep inside `fetch()`, which crashed the function with no useful message.
 * We surface the real cause here instead.
 */
function assertHttpsUrl(value: string, label: string): string {
  const v = value.trim()
  if (!v) {
    throw new Error(
      `${label} is empty. Set it in Vercel → Project → Settings → Environment Variables.`
    )
  }
  if (!/^https:\/\//i.test(v)) {
    throw new Error(
      `${label} must start with "https://". Got: "${v.slice(0, 32)}…". ` +
        `It should look like https://<project-ref>.supabase.co — NOT a "sb_publishable_…" key, ` +
        `NOT the service-role JWT.`
    )
  }
  try {
    // eslint-disable-next-line no-new
    new URL(v)
  } catch {
    throw new Error(`${label} is not a valid URL: "${v.slice(0, 64)}".`)
  }
  return v.replace(/\/+$/, '')
}

// ─────────────────────────────────────────────────────────────────────────────
// Tiny PostgREST client
// (We deliberately do not use `@supabase/supabase-js`: its top-level
//  `createClient` instantiates a Realtime WebSocket client, which adds ~250 KB
//  to the bundle and historically broke on Node 20 / Edge runtimes.)
// ─────────────────────────────────────────────────────────────────────────────
type SupabaseRest = {
  url: string
  key: string
  from(table: string): SupabaseTable
}

type SupabaseTable = {
  select(columns?: string): SupabaseQuery
  insert(rows: unknown[] | unknown): Promise<{ data: unknown[] | null; error: { message: string } | null }>
  upsert(
    rows: unknown[] | unknown,
    opts?: { onConflict?: string; ignoreDuplicates?: boolean }
  ): Promise<{ data: unknown[] | null; error: { message: string } | null }>
  update(values: Record<string, unknown>): SupabaseMutateQuery
  delete(opts?: { count?: 'exact' | 'planned' | 'estimated' }): SupabaseMutateQuery
}

type SupabaseQuery = {
  eq(col: string, val: unknown): SupabaseQuery
  gte(col: string, val: unknown): SupabaseQuery
  lte(col: string, val: unknown): SupabaseQuery
  order(col: string, opts?: { ascending?: boolean; nullsFirst?: boolean }): SupabaseQuery
  limit(n: number): SupabaseQuery
  maybeSingle(): Promise<{ data: any | null; error: { message: string } | null }>
  then<T1, T2 = never>(
    resolve?: (v: { data: any[] | null; error: { message: string } | null }) => T1 | PromiseLike<T1>,
    reject?: (e: unknown) => T2 | PromiseLike<T2>
  ): Promise<T1 | T2>
}

type SupabaseMutateQuery = SupabaseQuery & {
  then<T1, T2 = never>(
    resolve?: (v: {
      data: any[] | null
      count: number | null
      error: { message: string } | null
    }) => T1 | PromiseLike<T1>,
    reject?: (e: unknown) => T2 | PromiseLike<T2>
  ): Promise<T1 | T2>
}

function buildSupabaseClient(url: string, key: string): SupabaseRest {
  const base = url.replace(/\/+$/, '') + '/rest/v1'

  // PostgREST filter value formatter.
  //
  // IMPORTANT: do NOT call encodeURIComponent here.
  // We append filters via URLSearchParams.append(col, `${op}.${val}`), and
  // URLSearchParams.toString() already percent-encodes the value. Pre-encoding
  // causes DOUBLE encoding: `"Nizhny Novgorod"` → `"Nizhny%20Novgorod"` →
  // `"Nizhny%2520Novgorod"`, which PostgREST then reads as the literal string
  // `"Nizhny%20Novgorod"` — so `city=eq.Nizhny Novgorod` silently matches zero
  // rows. Returning the raw string fixes today / tomorrow / monthly / delete
  // endpoints in one shot.
  function encodeOp(val: unknown): string {
    if (val === null || val === undefined) return 'null'
    return String(val)
  }

  function buildQuery(table: string, method: 'GET', config: { select?: string }): SupabaseQuery {
    type Filter = { col: string; op: string; val: unknown }
    const filters: Filter[] = []
    let orderClause: string | undefined
    let limitClause: number | undefined

    function toQuery() {
      const params = new URLSearchParams()
      if (config.select) params.set('select', config.select)
      for (const f of filters) params.append(f.col, `${f.op}.${encodeOp(f.val)}`)
      if (orderClause) params.set('order', orderClause)
      if (limitClause !== undefined) params.set('limit', String(limitClause))
      return params.toString()
    }

    async function run(extraHeaders: Record<string, string> = {}) {
      const res = await fetch(`${base}/${table}?${toQuery()}`, {
        method,
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          Accept: 'application/json',
          ...extraHeaders,
        },
      })
      if (!res.ok) return { data: null as any[] | null, error: { message: await res.text() } }
      try {
        const data = await res.json()
        return { data: (Array.isArray(data) ? data : [data]) as any[], error: null as null }
      } catch {
        return { data: [] as any[], error: null as null }
      }
    }

    const api: SupabaseQuery = {
      eq(col, val) {
        filters.push({ col, op: 'eq', val })
        return api
      },
      gte(col, val) {
        filters.push({ col, op: 'gte', val })
        return api
      },
      lte(col, val) {
        filters.push({ col, op: 'lte', val })
        return api
      },
      order(col, opts) {
        const dir = opts?.ascending === false ? 'desc' : 'asc'
        const nulls =
          opts?.nullsFirst === true
            ? 'nullsfirst'
            : opts?.nullsFirst === false
              ? 'nullslast'
              : undefined
        orderClause = nulls ? `${col}.${dir}.${nulls}` : `${col}.${dir}`
        return api
      },
      limit(n) {
        limitClause = n
        return api
      },
      async maybeSingle() {
        limitClause = 2
        const { data, error } = await run({ Accept: 'application/json' })
        if (error) return { data: null, error }
        if (!data || data.length === 0) return { data: null, error: null }
        return { data: data[0], error: null }
      },
      then(resolve, reject) {
        return run().then(resolve as any, reject as any)
      },
    }
    return api
  }

  function buildMutate(
    table: string,
    method: 'PATCH' | 'DELETE',
    values: Record<string, unknown> | null,
    opts?: { count?: string }
  ): SupabaseMutateQuery {
    type Filter = { col: string; op: string; val: unknown }
    const filters: Filter[] = []

    function toQuery() {
      const params = new URLSearchParams()
      for (const f of filters) params.append(f.col, `${f.op}.${encodeOp(f.val)}`)
      return params.toString()
    }

    async function run() {
      const preferParts: string[] = ['return=representation']
      if (opts?.count) preferParts.push(`count=${opts.count}`)
      const res = await fetch(`${base}/${table}?${toQuery()}`, {
        method,
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          Prefer: preferParts.join(','),
        },
        body: method === 'PATCH' ? JSON.stringify(values) : undefined,
      })
      if (!res.ok) {
        return {
          data: null as any[] | null,
          count: null as number | null,
          error: { message: await res.text() },
        }
      }
      let data: any[] | null = null
      try {
        data = await res.json()
      } catch {
        data = null
      }
      let count: number | null = null
      const cr = res.headers.get('Content-Range')
      if (cr) {
        const m = /\/(\d+)$/.exec(cr)
        if (m) count = Number(m[1])
      }
      if (count === null && Array.isArray(data)) count = data.length
      return { data, count, error: null as null }
    }

    const api: SupabaseMutateQuery = {
      eq(col, val) {
        filters.push({ col, op: 'eq', val })
        return api
      },
      gte(col, val) {
        filters.push({ col, op: 'gte', val })
        return api
      },
      lte(col, val) {
        filters.push({ col, op: 'lte', val })
        return api
      },
      order() {
        return api
      },
      limit() {
        return api
      },
      async maybeSingle() {
        const r = await run()
        if (r.error) return { data: null, error: r.error }
        return { data: r.data && r.data[0] ? r.data[0] : null, error: null }
      },
      then(resolve, reject) {
        return run().then(resolve as any, reject as any)
      },
    }
    return api
  }

  function buildTable(table: string): SupabaseTable {
    return {
      select(columns = '*') {
        return buildQuery(table, 'GET', { select: columns })
      },
      async insert(rows) {
        const body = Array.isArray(rows) ? rows : [rows]
        const res = await fetch(`${base}/${table}`, {
          method: 'POST',
          headers: {
            apikey: key,
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
            Prefer: 'return=representation',
          },
          body: JSON.stringify(body),
        })
        if (!res.ok) return { data: null, error: { message: await res.text() } }
        return { data: await res.json(), error: null }
      },
      async upsert(rows, opts) {
        const body = Array.isArray(rows) ? rows : [rows]
        const params = new URLSearchParams()
        if (opts?.onConflict) params.set('on_conflict', opts.onConflict)
        const preferParts = ['resolution=merge-duplicates', 'return=representation']
        const res = await fetch(`${base}/${table}?${params.toString()}`, {
          method: 'POST',
          headers: {
            apikey: key,
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
            Prefer: preferParts.join(','),
          },
          body: JSON.stringify(body),
        })
        if (!res.ok) return { data: null, error: { message: await res.text() } }
        return { data: await res.json(), error: null }
      },
      update(values) {
        return buildMutate(table, 'PATCH', values)
      },
      delete(opts) {
        return buildMutate(table, 'DELETE', null, opts)
      },
    }
  }

  return { url, key, from: buildTable }
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────
const APP_TIMEZONE = 'Europe/Moscow'
const DEFAULT_CITY = 'Nizhny Novgorod'
const DEFAULT_ADMIN_PASSWORD = 'ahmed1@2h'
const SESSION_COOKIE = 'noor-admin-session'
const TABLE_NAME = 'prayer_times'

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function getMoscowDate() {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  const p = Object.fromEntries(
    f
      .formatToParts(new Date())
      .filter((x) => x.type !== 'literal')
      .map((x) => [x.type, x.value])
  ) as Record<string, string>
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    time: `${p.hour}:${p.minute}:${p.second}`,
  }
}

function normalizeCity(v?: string | null) {
  return (v?.trim() || '').replace(/\s+/g, ' ') || DEFAULT_CITY
}

function getSupabaseOrThrow(env: Bindings): SupabaseRest {
  const rawUrl = readEnv(env, 'SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'VITE_PUBLIC_SUPABASE_URL')
  const key = readEnv(env, 'SUPABASE_SERVICE_ROLE_KEY')
  if (!rawUrl) {
    throw new Error(
      'SUPABASE_URL is not set. Add it under Vercel → Settings → Environment Variables.'
    )
  }
  if (!key) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is not set. Add it under Vercel → Settings → Environment Variables.'
    )
  }
  const url = assertHttpsUrl(rawUrl, 'SUPABASE_URL')
  return buildSupabaseClient(url, key)
}

function getSupabase(env: Bindings): SupabaseRest | null {
  try {
    return getSupabaseOrThrow(env)
  } catch {
    return null
  }
}

function getAdminPassword(env: Bindings) {
  return readEnv(env, 'ADMIN_PASSWORD') || DEFAULT_ADMIN_PASSWORD
}

function getSessionSecret(env: Bindings) {
  return new TextEncoder().encode(getAdminPassword(env))
}

// ── Data version (cross-instance) ────────────────────────────────────────────
let dataVersionFallback = Date.now()

async function readDataVersion(env: Bindings): Promise<number> {
  const supabase = getSupabase(env)
  if (!supabase) return dataVersionFallback
  try {
    const { data } = await supabase
      .from(TABLE_NAME)
      .select('updated_at, created_at, date')
      .order('updated_at', { ascending: false, nullsFirst: false })
      .limit(1)
    const row = (data && data[0]) as any | undefined
    if (row) {
      const ts = row.updated_at || row.created_at
      if (ts) {
        const v = new Date(ts).getTime()
        if (!Number.isNaN(v) && v > 0) return v
      }
    }
  } catch {
    /* fall through */
  }
  return dataVersionFallback
}

function noStore(c: any) {
  c.header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
  c.header('Pragma', 'no-cache')
  c.header('Expires', '0')
  c.header('CDN-Cache-Control', 'no-store')
  c.header('Vercel-CDN-Cache-Control', 'no-store')
}

// ─────────────────────────────────────────────────────────────────────────────
// Hono app
// ─────────────────────────────────────────────────────────────────────────────
const app = new Hono<{ Bindings: Bindings }>()
app.use('/api/*', cors())

// Global error handler — never leak a stack trace, but always return a useful
// message so configuration mistakes surface in API responses.
app.onError((err, c) => {
  noStore(c)
  return c.json(
    { success: false, error: { message: err?.message || 'Internal server error' } },
    500
  )
})

// ── API: Health / Config ─────────────────────────────────────────────────────
app.get('/api/health', (c) => {
  noStore(c)
  const url = readEnv(c.env, 'SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'VITE_PUBLIC_SUPABASE_URL')
  const key = readEnv(c.env, 'SUPABASE_SERVICE_ROLE_KEY')
  const hasUrl = !!url
  const urlOk = !!url && /^https:\/\//i.test(url)
  const hasKey = !!key
  return c.json({
    success: true,
    data: {
      timezone: APP_TIMEZONE,
      moscowDate: getMoscowDate().date,
      supabase: {
        urlConfigured: hasUrl,
        urlIsHttps: urlOk,
        urlPreview: hasUrl ? url!.slice(0, 32) + '…' : null,
        serviceKeyConfigured: hasKey,
      },
    },
  })
})

// ── API: Data version (for client polling) ───────────────────────────────────
app.get('/api/data-version', async (c) => {
  noStore(c)
  const version = await readDataVersion(c.env)
  return c.json({ success: true, data: { version } })
})

// ── API: Prayer Times — Today ────────────────────────────────────────────────
app.get('/api/prayer-times/today', async (c) => {
  noStore(c)
  const city = normalizeCity(c.req.query('city'))
  const today = getMoscowDate().date
  const version = await readDataVersion(c.env)

  let supabase: SupabaseRest
  try {
    supabase = getSupabaseOrThrow(c.env)
  } catch (e: any) {
    return c.json({ success: false, error: { message: e.message } }, 500)
  }

  const { data, error } = await supabase
    .from(TABLE_NAME)
    .select('*')
    .eq('city', city)
    .eq('date', today)
    .order('updated_at', { ascending: false, nullsFirst: false })
    .limit(1)

  if (error) return c.json({ success: false, error: { message: error.message } }, 500)
  return c.json({
    success: true,
    data: { city, timezone: APP_TIMEZONE, today: (data && data[0]) || null, version },
  })
})

// ── API: Prayer Times — Tomorrow ─────────────────────────────────────────────
app.get('/api/prayer-times/tomorrow', async (c) => {
  noStore(c)
  const city = normalizeCity(c.req.query('city'))
  const todayParts = getMoscowDate().date.split('-').map(Number)
  const tomorrow = new Date(Date.UTC(todayParts[0], todayParts[1] - 1, todayParts[2] + 1))
  const tomorrowStr = `${tomorrow.getUTCFullYear()}-${String(tomorrow.getUTCMonth() + 1).padStart(2, '0')}-${String(tomorrow.getUTCDate()).padStart(2, '0')}`

  let supabase: SupabaseRest
  try {
    supabase = getSupabaseOrThrow(c.env)
  } catch (e: any) {
    return c.json({ success: false, error: { message: e.message } }, 500)
  }
  const version = await readDataVersion(c.env)
  const { data, error } = await supabase
    .from(TABLE_NAME)
    .select('*')
    .eq('city', city)
    .eq('date', tomorrowStr)
    .order('updated_at', { ascending: false, nullsFirst: false })
    .limit(1)
  if (error) return c.json({ success: false, error: { message: error.message } }, 500)
  return c.json({
    success: true,
    data: { city, timezone: APP_TIMEZONE, tomorrow: (data && data[0]) || null, version },
  })
})

// ── API: Prayer Times — Monthly ──────────────────────────────────────────────
app.get('/api/prayer-times/monthly', async (c) => {
  noStore(c)
  const city = normalizeCity(c.req.query('city'))
  const month = c.req.query('month') || getMoscowDate().date.slice(0, 7)

  let supabase: SupabaseRest
  try {
    supabase = getSupabaseOrThrow(c.env)
  } catch (e: any) {
    return c.json({ success: false, error: { message: e.message } }, 500)
  }
  const version = await readDataVersion(c.env)
  const [y, m] = month.split('-').map(Number)
  const startDate = `${y}-${String(m).padStart(2, '0')}-01`
  const endDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const endDate = `${y}-${String(m).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`

  const { data, error } = await supabase
    .from(TABLE_NAME)
    .select('*')
    .eq('city', city)
    .gte('date', startDate)
    .lte('date', endDate)
    .order('date')
  if (error) return c.json({ success: false, error: { message: error.message } }, 500)
  return c.json({ success: true, data: { city, month, rows: data || [], version } })
})

// ── API: Admin Session ───────────────────────────────────────────────────────
app.post('/api/admin/session', async (c) => {
  try {
    const body = await c.req.json()
    if (body.password !== getAdminPassword(c.env)) {
      return c.json({ success: false, error: { message: 'Invalid password' } }, 401)
    }
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('admin')
      .setIssuedAt()
      .setExpirationTime('12h')
      .sign(getSessionSecret(c.env))
    c.header(
      'Set-Cookie',
      `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200; Secure`
    )
    return c.json({ success: true, data: { authenticated: true } })
  } catch (e: any) {
    return c.json({ success: false, error: { message: e.message } }, 500)
  }
})

app.get('/api/admin/session', async (c) => {
  const cookie = c.req.header('Cookie') || ''
  const match = cookie.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))
  if (!match) return c.json({ success: true, data: { authenticated: false } })
  try {
    const { payload } = await jwtVerify(match[1], getSessionSecret(c.env))
    return c.json({ success: true, data: { authenticated: payload.sub === 'admin' } })
  } catch {
    return c.json({ success: true, data: { authenticated: false } })
  }
})

app.delete('/api/admin/session', async (c) => {
  c.header(
    'Set-Cookie',
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Secure; Expires=Thu, 01 Jan 1970 00:00:00 GMT`
  )
  return c.json({ success: true, data: { authenticated: false } })
})

async function requireAdmin(c: any): Promise<boolean> {
  const cookie = c.req.header('Cookie') || ''
  const match = cookie.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))
  if (!match) return false
  try {
    const { payload } = await jwtVerify(match[1], getSessionSecret(c.env))
    return payload.sub === 'admin'
  } catch {
    return false
  }
}

// ── API: Admin Prayer Times (GET months, POST upload) ────────────────────────
app.get('/api/admin/prayer-times', async (c) => {
  if (!(await requireAdmin(c)))
    return c.json({ success: false, error: { message: 'Unauthorized' } }, 401)

  let supabase: SupabaseRest
  try {
    supabase = getSupabaseOrThrow(c.env)
  } catch (e: any) {
    return c.json({ success: false, error: { message: e.message } }, 500)
  }

  const { data, error } = await supabase
    .from(TABLE_NAME)
    .select('date')
    .eq('city', DEFAULT_CITY)
    .order('date', { ascending: false })
  if (error) return c.json({ success: false, error: { message: error.message } }, 500)
  const months = Array.from(new Set((data || []).map((r: any) => r.date.slice(0, 7))))
  return c.json({ success: true, data: { months } })
})

app.post('/api/admin/prayer-times', async (c) => {
  if (!(await requireAdmin(c)))
    return c.json({ success: false, error: { message: 'Unauthorized' } }, 401)

  let formData: FormData
  try {
    formData = await c.req.formData()
  } catch (e: any) {
    return c.json(
      { success: false, error: { message: `Could not read multipart form: ${e?.message || e}` } },
      400
    )
  }

  const file = formData.get('file') as File | null
  const mode = String(formData.get('mode') || 'preview')
  if (!file) return c.json({ success: false, error: { message: 'CSV file is required' } }, 400)

  let text: string
  try {
    text = await file.text()
  } catch (e: any) {
    return c.json(
      { success: false, error: { message: `Could not read CSV bytes: ${e?.message || e}` } },
      400
    )
  }

  const parsed = parseCSV(text)

  if (mode !== 'commit' || parsed.errors.length > 0 || parsed.validRows === 0) {
    // Preview, or commit blocked by errors / no valid rows. Still respond
    // with success:true so the frontend can render the preview + errors.
    return c.json({ success: true, data: { ...parsed, committed: false } })
  }

  let supabase: SupabaseRest
  try {
    supabase = getSupabaseOrThrow(c.env)
  } catch (e: any) {
    return c.json({ success: false, error: { message: e.message } }, 500)
  }

  const now = new Date().toISOString()
  const rowsWithTimestamp = parsed.rows.map((r) => ({ ...r, updated_at: now }))

  const { error } = await supabase
    .from(TABLE_NAME)
    .upsert(rowsWithTimestamp, { onConflict: 'date,city', ignoreDuplicates: false })
  if (error) return c.json({ success: false, error: { message: error.message } }, 500)

  dataVersionFallback = Date.now()
  const version = await readDataVersion(c.env)
  return c.json({
    success: true,
    data: { ...parsed, committed: true, savedRows: parsed.rows.length, version },
  })
})

// ── API: Admin Delete Month ──────────────────────────────────────────────────
app.post('/api/admin/delete-month', async (c) => {
  if (!(await requireAdmin(c)))
    return c.json({ success: false, error: { message: 'Unauthorized' } }, 401)

  const body = await c.req.json().catch(() => ({}) as any)
  const city = normalizeCity(body.city)
  const month = String(body.month || '')
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return c.json({ success: false, error: { message: 'Invalid month (expected YYYY-MM)' } }, 400)
  }

  const [y, m] = month.split('-').map(Number)
  const start = `${y}-${String(m).padStart(2, '0')}-01`
  const endDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const end = `${y}-${String(m).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`

  let supabase: SupabaseRest
  try {
    supabase = getSupabaseOrThrow(c.env)
  } catch (e: any) {
    return c.json({ success: false, error: { message: e.message } }, 500)
  }

  const delResult: { data: any[] | null; count: number | null; error: { message: string } | null } =
    (await supabase
      .from(TABLE_NAME)
      .delete({ count: 'exact' })
      .eq('city', city)
      .gte('date', start)
      .lte('date', end)) as any
  if (delResult.error)
    return c.json({ success: false, error: { message: delResult.error.message } }, 500)
  const count = delResult.count

  // Touch a sentinel row so updated_at advances even if the deleted month was
  // the latest — guarantees clients see a new version number.
  try {
    const { data: latest } = await supabase
      .from(TABLE_NAME)
      .select('id, date, city')
      .order('updated_at', { ascending: false, nullsFirst: false })
      .limit(1)
    if (latest && latest[0]) {
      await supabase
        .from(TABLE_NAME)
        .update({ updated_at: new Date().toISOString() })
        .eq('id', (latest[0] as any).id)
    }
  } catch {
    /* best-effort */
  }

  dataVersionFallback = Date.now()
  const version = await readDataVersion(c.env)
  return c.json({ success: true, data: { deletedRows: count || 0, version } })
})

// ─────────────────────────────────────────────────────────────────────────────
// CSV parser (robust, production-grade)
// ─────────────────────────────────────────────────────────────────────────────
//
// Accepts:
//   • UTF-8 with or without BOM
//   • LF, CRLF and CR line endings
//   • Headers in any case ("DATE", "Fajr", "city")
//   • Headers in any column order
//   • Optional surrounding whitespace
//   • Quoted fields ("Nizhny Novgorod, RU")
//   • Date as YYYY-MM-DD, DD/MM/YYYY, or DD.MM.YYYY
//   • Time as H:MM, HH:MM, or HH:MM:SS (seconds dropped)
//
// Returns { rows, errors, totalRows, validRows }. Every row is independent —
// one bad row never invalidates the whole file. Empty CSVs return a clear
// "Empty file" error; missing required headers return an explicit list of
// what was missing.
// ─────────────────────────────────────────────────────────────────────────────
type ParseResult = {
  rows: Array<{
    date: string
    fajr: string
    dhuhr: string
    asr: string
    maghrib: string
    isha: string
    city: string
  }>
  errors: Array<{ row: number; field?: string; message: string; value?: string }>
  totalRows: number
  validRows: number
}

const REQUIRED_FIELDS = ['date', 'fajr', 'dhuhr', 'asr', 'maghrib', 'isha', 'city'] as const

function parseCSV(text: string): ParseResult {
  // 1. Normalize the byte stream
  const stripped = text.replace(/^\uFEFF/, '') // BOM
  const normalized = stripped.replace(/\r\n?/g, '\n') // CR / CRLF → LF
  const lines = normalized
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0)

  if (lines.length === 0) {
    return {
      rows: [],
      errors: [{ row: 1, message: 'Empty file' }],
      totalRows: 0,
      validRows: 0,
    }
  }
  if (lines.length === 1) {
    return {
      rows: [],
      errors: [{ row: 1, message: 'CSV contains only a header row — no data lines' }],
      totalRows: 0,
      validRows: 0,
    }
  }

  // 2. Headers — case-insensitive, order-independent
  const headerCells = splitCsvLine(lines[0]).map((h) =>
    h.replace(/^\uFEFF/, '').trim().toLowerCase()
  )
  const idx: Record<string, number> = {}
  for (const f of REQUIRED_FIELDS) idx[f] = headerCells.indexOf(f)

  const missing = REQUIRED_FIELDS.filter((f) => idx[f] === -1)
  if (missing.length > 0) {
    return {
      rows: [],
      errors: [
        {
          row: 1,
          field: 'file',
          message:
            `Invalid CSV header. Missing required column(s): ${missing.join(', ')}. ` +
            `Expected (any order, any case): ${REQUIRED_FIELDS.join(', ')}. ` +
            `Got: ${headerCells.join(', ') || '(empty)'}`,
        },
      ],
      totalRows: lines.length - 1,
      validRows: 0,
    }
  }

  // 3. Body
  const errors: ParseResult['errors'] = []
  const rows: ParseResult['rows'] = []

  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i])
    if (cells.length < REQUIRED_FIELDS.length) {
      errors.push({
        row: i + 1,
        message: `Not enough columns (got ${cells.length}, expected at least ${REQUIRED_FIELDS.length})`,
      })
      continue
    }

    const dateRaw = (cells[idx.date] ?? '').trim()
    const fajrRaw = (cells[idx.fajr] ?? '').trim()
    const dhuhrRaw = (cells[idx.dhuhr] ?? '').trim()
    const asrRaw = (cells[idx.asr] ?? '').trim()
    const maghribRaw = (cells[idx.maghrib] ?? '').trim()
    const ishaRaw = (cells[idx.isha] ?? '').trim()
    const cityRaw = (cells[idx.city] ?? '').trim()

    const date = normalizeDate(dateRaw)
    if (!date) {
      errors.push({
        row: i + 1,
        field: 'date',
        message: 'Invalid date (expected YYYY-MM-DD, DD/MM/YYYY or DD.MM.YYYY)',
        value: dateRaw,
      })
      continue
    }

    const times = [fajrRaw, dhuhrRaw, asrRaw, maghribRaw, ishaRaw].map(normalizeTime)
    const badTimeIndex = times.findIndex((t) => t === null)
    if (badTimeIndex >= 0) {
      const badField = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'][badTimeIndex]
      const badValue = [fajrRaw, dhuhrRaw, asrRaw, maghribRaw, ishaRaw][badTimeIndex]
      errors.push({
        row: i + 1,
        field: badField,
        message: `Invalid ${badField} time (expected HH:MM)`,
        value: badValue,
      })
      continue
    }

    const city = normalizeCity(cityRaw)
    rows.push({
      date,
      fajr: times[0]!,
      dhuhr: times[1]!,
      asr: times[2]!,
      maghrib: times[3]!,
      isha: times[4]!,
      city,
    })
  }

  return { rows, errors, totalRows: lines.length - 1, validRows: rows.length }
}

/** Split a CSV line respecting double-quoted fields ("a, b" stays one cell). */
function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        cur += ch
      }
    } else {
      if (ch === '"') {
        inQuotes = true
      } else if (ch === ',') {
        out.push(cur)
        cur = ''
      } else {
        cur += ch
      }
    }
  }
  out.push(cur)
  return out.map((c) => c.trim())
}

function normalizeTime(v: string): string | null {
  const t = v.trim()
  if (!t) return null
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(t)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (Number.isNaN(h) || Number.isNaN(min)) return null
  if (h > 23 || min > 59) return null
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

function normalizeDate(v: string): string | null {
  const t = v.trim()
  if (!t) return null
  // ISO: YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    const d = new Date(`${t}T00:00:00Z`)
    return Number.isNaN(d.getTime()) ? null : t
  }
  // DD/MM/YYYY  or  DD.MM.YYYY
  const m = /^(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})$/.exec(t)
  if (!m) return null
  const day = Number(m[1])
  const month = Number(m[2])
  const year = Number(m[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Pages (HTML rendering — UI unchanged from the original design)
// ─────────────────────────────────────────────────────────────────────────────
function renderPage(title: string, bodyContent: string, activePage = 'home') {
  return `<!DOCTYPE html>
<html lang="ru" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, user-scalable=no">
  <title>${title}</title>
  <link rel="manifest" href="/manifest.json">
  <meta name="theme-color" content="#111415">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="Noor Prayer">
  <link rel="apple-touch-icon" href="/icons/icon-192.png">
  <link rel="apple-touch-startup-image" href="/icons/icon-512.png">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="application-name" content="Noor Prayer Times">
  <meta name="msapplication-TileColor" content="#111415">
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet">
  <link href="/static/styles.css" rel="stylesheet">
</head>
<body class="min-h-screen antialiased" style="background:#111415;color:#e1e3e4;font-family:'Manrope',sans-serif;">
  ${bodyContent}
  <script>
    window.__ACTIVE_PAGE__ = '${activePage}';
  </script>
  <script src="/static/app.js"></script>
</body>
</html>`
}

const LOGO_URL =
  'https://lh3.googleusercontent.com/aida-public/AB6AXuDm2GFaLbfFCcGK7Dv3S-5LPnRgp8juGbKa-WCZZyC2Ftd1ETUxIKlitkavEF3TaxWI3vvQEF-ItaXXzELlnkuum8_kiHi6TF0pHHEwEi7ysSPC1-rUnYPWChhRWIumAvu2jGKuy0psZeqa-oI5Pp-n8e6HCPpn_W_c8o9ifAPVZQVSNSjb1ncNIYp9EzrWutH55ajQsnu0xct7EFFBDmcogcfIV6jN4YlPJtrvlQLvIoiUBDYsrPlXeJhrvT4sqySAR1omRnEN7_ZU'
const HERO_BG_URL =
  'https://lh3.googleusercontent.com/aida-public/AB6AXuBIweCNLsm5oa7FZEZX47Pt0rFu7vxDXytLuryBMUCDV7hH5zZdmvriXsBCFWBx1ouGhPHXZ4CZwVC2mGspVucccGOJa5T-qfC2TMphfjQ0rIJuWfoSWL9Fny1gnMwaNgD8ZwpVpiEynSa3k-nd4-1iU9jPQFsnlkVgGzbp15Cu_8Xhr-rYGJQO8E3NkBqNyYR_7_tHpaGSmGvnX0WFHfM5EFazk7-6yzXHq0JgPJK_XiyTkx2I0Bt6G1-XNkajy8Egg2IIp70prTWg'
const MOSQUE_IMG_URL =
  'https://lh3.googleusercontent.com/aida-public/AB6AXuDGA-vPgtPlHQ3sL0P5G7zWxVpefqqqNbl8B1M2GDNx4v8MkHmaDTHygId-hAFWzv-kzJm4UQNadpqGbjiji8kWDTesV-RrTYQzYYNWufDang1PomSKIVvNAd9EAWRjtPYSS5gNdSZWIzXUC58UFAYqtg6N6ehBsH-9aUQc0r9gL2U2isPUg2WJVUl-nJjg6_TQ4c1Mbi524mnUjLZT2DWAEYwSIN1U58ntSgAfEX61UewxHKe5tOiWd3Bs9RiVW22ATg6VpMD1MsKM'

function dashboardTopBar() {
  return `<header class="bg-surface/10 backdrop-blur-md sticky top-0 w-full border-b border-white/10 z-40">
  <div class="flex justify-between items-center px-5 py-4 w-full max-w-[1200px] mx-auto">
    <a href="/home" class="no-underline"><h1 class="text-[36px] md:text-[48px] leading-[44px] md:leading-[56px] tracking-[-0.02em] font-bold text-primary" data-i18n="appName">Noor Prayer Times</h1></a>
    <div class="flex items-center gap-4">
      <div id="lang-switcher" class="flex items-center gap-2"></div>
      <button type="button" class="text-[#bdc9c2] hover:text-primary transition-colors"><span class="material-symbols-outlined">account_circle</span></button>
    </div>
  </div>
</header>`
}

function bottomNav(active: string) {
  const items = [
    { href: '/home', key: 'home', icon: 'mosque', labelKey: 'home' },
    { href: '/schedule', key: 'schedule', icon: 'calendar_month', labelKey: 'schedule' },
    { href: '/notifications', key: 'alerts', icon: 'notifications', labelKey: 'alerts' },
    { href: '/admin', key: 'admin', icon: 'dashboard_customize', labelKey: 'admin' },
  ]
  return `<nav class="md:hidden fixed bottom-0 w-full z-50 rounded-t-xl bg-surface/20 backdrop-blur-xl border-t border-white/10 shadow-[0_-10px_30px_rgba(0,0,0,0.3)]">
  <div class="flex justify-around items-center px-4 py-3 pb-[max(12px,env(safe-area-inset-bottom))]">
    ${items
      .map(
        (it) => `<a href="${it.href}" class="flex flex-col items-center justify-center active:scale-90 duration-200 transition-all no-underline ${active === it.key ? 'text-primary bg-primary/10 rounded-xl px-4 py-1' : 'text-[#bdc9c2] hover:text-primary'}">
      <span class="material-symbols-outlined mb-1 ${active === it.key ? 'icon-filled' : ''}">${it.icon}</span>
      <span class="text-[12px] leading-4 font-semibold" data-i18n="${it.labelKey}">${it.labelKey}</span>
    </a>`
      )
      .join('')}
  </div>
</nav>`
}

function footer() {
  return `<footer class="w-full border-t border-white/5 py-8 mt-12 z-10 relative" style="background:#0c0f10">
  <div class="max-w-[1200px] mx-auto px-5 flex flex-col md:flex-row justify-between items-center gap-4">
    <div class="flex items-center gap-2 opacity-70"><span class="material-symbols-outlined text-xl">mosque</span><span class="text-[20px] leading-7 font-semibold tracking-tight">Noor</span></div>
    <p class="text-[#bdc9c2] text-[14px] leading-5 font-medium">Developed by Ahmed Hussien</p>
  </div>
</footer>`
}

// ── Pages ────────────────────────────────────────────────────────────────────
app.get('/', (c) => {
  return c.html(
    renderPage(
      'Noor Prayer Times',
      `
<main class="min-h-screen flex items-center justify-center relative overflow-hidden" style="background:#111415">
  <div class="absolute inset-0 opacity-[0.03] bg-[radial-gradient(circle_at_center,_rgba(126,215,183,0.2),_transparent_65%)]"></div>
  <div class="relative z-10 flex flex-col items-center text-center glass-panel rounded-2xl px-10 py-12 max-w-md mx-5 page-enter">
    <img src="${LOGO_URL}" alt="Noor" class="w-24 h-24 rounded-full mb-6">
    <h1 class="text-[36px] leading-[44px] tracking-[-0.02em] font-bold text-primary mb-3">Noor Prayer Times</h1>
    <p class="text-[#bdc9c2] text-base mb-6" data-i18n="loadingDashboard">Loading your prayer dashboard...</p>
    <div class="w-full h-1.5 rounded-full overflow-hidden" style="background:#323536"><div class="h-full w-1/3 bg-primary rounded-full loading-bar-animate"></div></div>
    <a href="/landing" class="mt-8 text-primary text-[14px] font-medium" data-i18n="continue">Continue</a>
  </div>
</main>`,
      'splash'
    )
  )
})

app.get('/landing', (c) => {
  return c.html(
    renderPage(
      'Noor Prayer Times',
      `
<div class="min-h-screen flex flex-col text-base selection:bg-primary/30 selection:text-primary ambient-glow-subtle">
  <header class="bg-surface/10 backdrop-blur-md sticky top-0 w-full border-b border-white/10 z-50">
    <div class="flex justify-between items-center px-5 py-4 w-full max-w-[1200px] mx-auto">
      <a href="/landing" class="flex items-center gap-3 no-underline">
        <span class="material-symbols-outlined text-primary text-3xl icon-filled">mosque</span>
        <span class="text-[36px] md:text-[48px] leading-[44px] md:leading-[56px] tracking-[-0.02em] font-bold text-primary" data-i18n="appName">Noor Prayer Times</span>
      </a>
      <div class="flex items-center gap-6">
        <div id="lang-switcher" class="hidden md:flex items-center rounded-full p-1 border border-white/5" style="background:#191c1d"></div>
        <button type="button" class="text-[#bdc9c2] hover:text-primary transition-colors"><span class="material-symbols-outlined text-2xl">language</span></button>
        <button type="button" class="text-[#bdc9c2] hover:text-primary transition-colors"><span class="material-symbols-outlined text-2xl">account_circle</span></button>
      </div>
    </div>
  </header>

  <main class="flex-grow flex flex-col items-center w-full page-enter">
    <section class="relative w-full max-w-[1200px] mx-auto px-5 py-20 md:py-24 flex flex-col items-center justify-center text-center overflow-hidden">
      <div class="absolute inset-0 z-0 opacity-20 pointer-events-none flex items-center justify-center">
        <img alt="" class="w-full h-full object-cover max-w-[800px]" src="${HERO_BG_URL}">
      </div>
      <div class="relative z-10 flex flex-col items-center max-w-3xl glass-panel rounded-2xl p-8 md:p-12 shadow-[0_10px_40px_rgba(0,0,0,0.5)]">
        <div class="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/20 text-primary mb-6">
          <span class="material-symbols-outlined text-sm">location_on</span>
          <span class="text-[12px] leading-4 font-semibold uppercase tracking-widest" data-i18n="heroEyebrow">Nizhny Novgorod</span>
        </div>
        <h1 class="text-[36px] md:text-[48px] leading-[44px] md:leading-[56px] tracking-[-0.02em] font-bold mb-6">
          <span data-i18n="heroTitleStart">Find Peace in</span> <span class="text-primary block md:inline" data-i18n="heroTitleAccent">Every Moment</span>
        </h1>
        <p class="text-[18px] leading-7 text-[#bdc9c2] mb-8 max-w-xl" data-i18n="heroDescription">Accurate prayer times, serene Adhan notifications, and monthly schedules designed for a focused, distraction-free spiritual environment.</p>
        <a href="/home" class="bg-primary text-[#00382a] text-[20px] leading-7 font-semibold px-8 py-4 rounded-full shadow-[0_10px_30px_rgba(126,215,183,0.3)] hover:scale-105 transition-all duration-300 flex items-center gap-3 group">
          <span data-i18n="cta">Get Started</span>
          <span class="material-symbols-outlined group-hover:translate-x-1 transition-transform">arrow_forward</span>
        </a>
      </div>
    </section>

    <section class="w-full max-w-[1200px] mx-auto px-5 py-16">
      <div class="grid grid-cols-1 md:grid-cols-12 gap-6">
        <div class="md:col-span-8 glass-panel rounded-2xl p-8 flex flex-col md:flex-row items-center gap-8 relative overflow-hidden group">
          <div class="absolute -right-20 -bottom-20 opacity-5 pointer-events-none transition-transform group-hover:scale-110 duration-700"><span class="material-symbols-outlined text-[300px]">schedule</span></div>
          <div class="flex-1 z-10">
            <div class="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center mb-6 border border-primary/20"><span class="material-symbols-outlined text-primary text-2xl icon-filled">my_location</span></div>
            <h3 class="text-[24px] leading-8 font-semibold mb-4" data-i18n="featurePrecisionTitle">Precision Timing for Nizhny Novgorod</h3>
            <p class="text-[#bdc9c2]" data-i18n="featurePrecisionBody">Calculated with meticulous accuracy for your exact location.</p>
          </div>
          <div id="landing-preview-times" class="w-full md:w-64 rounded-xl border border-white/5 p-4 flex flex-col gap-3 z-10" style="background:#191c1d">
            <div class="flex justify-between items-center p-2 rounded bg-surface/50"><span class="text-[#bdc9c2] text-sm" data-i18n="fajr">Fajr</span><span class="font-medium">--:--</span></div>
            <div class="flex justify-between items-center p-2 rounded bg-primary/20 border border-primary/30 shadow-[0_0_15px_rgba(126,215,183,0.1)]"><span class="text-primary font-bold" data-i18n="dhuhr">Dhuhr</span><span class="text-primary font-bold">--:--</span></div>
            <div class="flex justify-between items-center p-2 rounded bg-surface/50"><span class="text-[#bdc9c2] text-sm" data-i18n="asr">Asr</span><span class="font-medium">--:--</span></div>
          </div>
        </div>
        <div class="md:col-span-4 glass-panel rounded-2xl p-8 flex flex-col relative overflow-hidden group">
          <div class="absolute -right-10 -top-10 opacity-5 pointer-events-none transition-transform group-hover:rotate-12 duration-700"><span class="material-symbols-outlined text-[200px]">notifications_active</span></div>
          <div class="z-10 flex flex-col h-full">
            <div class="w-12 h-12 bg-[#af8b47]/20 rounded-xl flex items-center justify-center mb-6 border border-[#af8b47]/30"><span class="material-symbols-outlined text-[#af8b47] text-2xl icon-filled">notifications</span></div>
            <h3 class="text-[20px] leading-7 font-semibold mb-4" data-i18n="featureAdhanTitle">Serene Adhan Alerts</h3>
            <p class="text-[#bdc9c2] flex-grow" data-i18n="featureAdhanBody">Gentle, beautiful notifications that slide in to remind you of prayer times.</p>
            <div class="mt-6 flex items-center justify-between p-3 rounded-lg border border-white/5" style="background:#323536">
              <span class="text-sm font-medium" data-i18n="featureSound">Sound Notifications</span>
              <div class="w-10 h-6 bg-primary rounded-full relative flex items-center shadow-[0_0_10px_rgba(126,215,183,0.3)]"><div class="w-4 h-4 bg-white rounded-full absolute right-1"></div></div>
            </div>
          </div>
        </div>
      </div>
    </section>
  </main>

  ${footer()}
  ${bottomNav('home')}
</div>`,
      'landing'
    )
  )
})

app.get('/home', (c) => {
  return c.html(
    renderPage(
      'Noor Prayer Times - Home',
      `
<div class="min-h-screen pb-24 md:pb-0 ambient-glow">
  ${dashboardTopBar()}
  <main class="max-w-[1200px] mx-auto px-5 pt-6 pb-20 md:py-20 grid grid-cols-1 md:grid-cols-12 gap-6 relative page-enter">
    <div class="md:col-span-8 flex flex-col gap-6">
      <div class="home-info-row flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
        <div class="info-chip flex items-center gap-1 text-[#bdc9c2]">
          <span class="material-symbols-outlined text-primary">location_on</span>
          <span class="text-[20px] leading-7 font-semibold" data-i18n="city">Nizhny Novgorod</span>
        </div>
        <div class="home-time-stack flex flex-col items-end">
          <div class="info-chip info-chip-subtle flex items-center gap-1">
            <span class="material-symbols-outlined text-[#e9c176]">calendar_today</span>
            <span id="live-date" class="text-[14px] leading-5 font-medium text-[#bdc9c2]"></span>
          </div>
          <div class="info-chip info-chip-subtle flex items-center gap-1">
            <span class="material-symbols-outlined text-[#e9c176]">schedule</span>
            <span id="live-clock" class="text-[20px] leading-7 font-semibold text-primary tracking-widest">00:00</span>
            <span class="text-[14px] text-[#bdc9c2]" data-i18n="timezoneLabel">Moscow Time</span>
          </div>
        </div>
      </div>

      <div class="prayer-hero-card glass-panel-active rounded-xl p-6 flex flex-col md:flex-row justify-between items-center gap-6 relative overflow-hidden">
        <div class="absolute -right-20 -top-20 opacity-10 pointer-events-none"><span class="material-symbols-outlined text-[200px] icon-filled">mosque</span></div>
        <div class="prayer-hero-copy z-10 w-full text-center md:text-left">
          <p class="text-[14px] leading-5 font-medium text-primary mb-1 tracking-widest uppercase" data-i18n="currentPrayer">Current Prayer</p>
          <h2 id="current-prayer" class="text-[36px] md:text-[48px] leading-[44px] md:leading-[56px] tracking-[-0.02em] font-bold mb-2" data-i18n="noData">Prayer times are not available for today yet.</h2>
          <p class="text-[#bdc9c2]" data-i18n="nextPrayerIn">Next prayer in:</p>
        </div>
        <div class="prayer-countdown-wrap z-10 flex flex-col items-center md:items-end w-full">
          <div id="countdown" class="text-[36px] md:text-[48px] leading-[44px] md:leading-[56px] tracking-[-0.02em] font-bold text-[#e9c176] tracking-widest tabular-nums">--:--:--</div>
          <p id="next-prayer-label" class="text-[14px] leading-5 font-medium text-[#e9c176]/70 uppercase tracking-widest mt-1" data-i18n="today">Today</p>
        </div>
      </div>

      <div class="glass-panel rounded-xl p-6 mt-3">
        <h3 class="text-[24px] leading-8 font-semibold mb-6" data-i18n="todaySchedule">Today's Schedule</h3>
        <div id="prayer-list" class="flex flex-col">
          <div class="py-6 text-[#bdc9c2]" data-i18n="noData">Prayer times are not available for today yet.</div>
        </div>
      </div>
    </div>

    <div class="md:col-span-4 flex flex-col gap-6">
      <div class="glass-panel rounded-xl p-6 flex flex-col gap-6">
        <h3 class="text-[24px] leading-8 font-semibold" data-i18n="notifications">Notifications</h3>
        <div id="notification-toggles">
          <div class="flex justify-between items-center py-1 border-b border-white/5">
            <div class="flex items-center gap-3"><span class="material-symbols-outlined text-[#e9c176]">notifications_active</span><span data-i18n="adhanAudio">Adhan Audio</span></div>
            <button id="toggle-adhan" class="noor-switch is-on" type="button" aria-pressed="true" onclick="window.NoorApp.toggleAdhan()"><span></span></button>
          </div>
          <div class="flex justify-between items-center py-1 border-b border-white/5">
            <div class="flex items-center gap-3"><span class="material-symbols-outlined text-[#e9c176]">vibration</span><span data-i18n="vibrateBefore">Vibrate Before</span></div>
            <button id="toggle-vibrate" class="noor-switch" type="button" aria-pressed="false" onclick="window.NoorApp.toggleVibrate()"><span></span></button>
          </div>
          <div class="flex justify-between items-center py-1">
            <div class="flex items-center gap-3"><span class="material-symbols-outlined text-[#e9c176]">notifications</span><span data-i18n="pushAlerts">Push Alerts</span></div>
            <button id="toggle-push" class="noor-switch is-on" type="button" aria-pressed="true" onclick="window.NoorApp.togglePush()"><span></span></button>
          </div>
        </div>
        <div class="border-t border-white/5 pt-3">
          <label class="text-[12px] leading-4 font-semibold text-[#bdc9c2] uppercase tracking-widest" data-i18n="reminderBefore">Remind before prayer</label>
          <div class="flex gap-2 mt-2">
            <button class="reminder-btn px-3 py-1 rounded-full text-xs border border-white/10 text-[#bdc9c2] hover:bg-primary/20 hover:text-primary transition-colors" data-minutes="5">5 min</button>
            <button class="reminder-btn px-3 py-1 rounded-full text-xs border border-white/10 text-[#bdc9c2] hover:bg-primary/20 hover:text-primary transition-colors" data-minutes="10">10 min</button>
            <button class="reminder-btn px-3 py-1 rounded-full text-xs border border-white/10 text-[#bdc9c2] hover:bg-primary/20 hover:text-primary transition-colors" data-minutes="15">15 min</button>
          </div>
        </div>
      </div>

      <div class="glass-panel rounded-xl overflow-hidden h-48 relative border-none">
        <div class="absolute inset-0 bg-gradient-to-t from-[#111415] to-transparent z-10"></div>
        <img alt="Mosque Interior" class="w-full h-full object-cover opacity-60" src="${MOSQUE_IMG_URL}">
        <div class="absolute bottom-4 left-4 z-20">
          <p class="text-[12px] leading-4 font-semibold text-[#e9c176] mb-1 uppercase tracking-wider" data-i18n="inspiration">Inspiration</p>
          <p class="text-base" data-i18n="quote">"Indeed, prayer has been decreed upon the believers a decree of specified times."</p>
        </div>
      </div>
    </div>
  </main>
  ${footer()}
  ${bottomNav('home')}
</div>`,
      'home'
    )
  )
})

app.get('/schedule', (c) => {
  return c.html(
    renderPage(
      'Noor Prayer Times - Schedule',
      `
<div class="min-h-screen relative overflow-x-hidden selection:bg-primary/30 selection:text-primary" style="background:#111415">
  <div class="fixed inset-0 pointer-events-none z-[-1] bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-[#314f46]/20 via-[#111415] to-[#111415]"></div>
  ${dashboardTopBar()}
  <main class="pt-6 pb-[100px] lg:pb-12 px-5 md:px-8 max-w-[1200px] mx-auto min-h-screen flex flex-col page-enter">
    <div class="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-8 mt-4">
      <div>
        <h2 class="text-[24px] leading-8 font-semibold mb-2" data-i18n="monthlySchedule">Monthly Schedule</h2>
        <div class="flex items-center gap-1 text-[#bdc9c2]">
          <span class="material-symbols-outlined text-[18px]">location_on</span>
          <span data-i18n="city">Nizhny Novgorod</span>
        </div>
      </div>
      <div class="flex items-center gap-6 glass-panel rounded-full px-6 py-2 w-fit">
        <button type="button" id="prev-month" class="text-[#bdc9c2] hover:text-primary transition-colors flex items-center"><span class="material-symbols-outlined">chevron_left</span></button>
        <span id="month-label" class="text-[20px] leading-7 font-semibold min-w-[180px] text-center capitalize"></span>
        <button type="button" id="next-month" class="text-[#bdc9c2] hover:text-primary transition-colors flex items-center"><span class="material-symbols-outlined">chevron_right</span></button>
      </div>
    </div>
    <div class="glass-panel rounded-xl overflow-hidden flex-1 flex flex-col shadow-lg">
      <div class="overflow-x-auto w-full flex-1">
        <table class="w-full text-left border-collapse min-w-[800px]">
          <thead class="sticky top-0 z-20 bg-surface/90 backdrop-blur-xl border-b border-white/10 shadow-sm">
            <tr>
              <th class="py-5 px-6 text-[14px] leading-5 font-medium text-[#bdc9c2] whitespace-nowrap" data-i18n="date">Date</th>
              <th class="py-5 px-6 text-[14px] leading-5 font-medium text-[#bdc9c2] whitespace-nowrap" data-i18n="fajr">Fajr</th>
              <th class="py-5 px-6 text-[14px] leading-5 font-medium text-[#bdc9c2] whitespace-nowrap" data-i18n="dhuhr">Dhuhr</th>
              <th class="py-5 px-6 text-[14px] leading-5 font-medium text-[#bdc9c2] whitespace-nowrap" data-i18n="asr">Asr</th>
              <th class="py-5 px-6 text-[14px] leading-5 font-medium text-[#bdc9c2] whitespace-nowrap" data-i18n="maghrib">Maghrib</th>
              <th class="py-5 px-6 text-[14px] leading-5 font-medium text-[#bdc9c2] whitespace-nowrap" data-i18n="isha">Isha</th>
            </tr>
          </thead>
          <tbody id="schedule-body" class="divide-y divide-white/[0.05]">
            <tr><td colspan="6" class="py-8 px-6 text-[#bdc9c2]" data-i18n="loading">Loading...</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </main>
  ${footer()}
  ${bottomNav('schedule')}
</div>`,
      'schedule'
    )
  )
})

app.get('/notifications', (c) => {
  return c.html(
    renderPage(
      'Noor Prayer Times - Notifications',
      `
<div class="min-h-screen relative overflow-hidden selection:bg-primary/30" style="background:#111415">
  <div class="absolute inset-0 z-0 pointer-events-none overflow-hidden bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-[#00513d]/20 via-[#111415] to-[#111415]"></div>
  ${dashboardTopBar()}
  <main class="flex-1 flex flex-col relative z-10 overflow-hidden">
    <div class="flex-1 overflow-y-auto pb-20 md:pb-12">
      <div class="max-w-[1200px] mx-auto px-5 py-6 md:py-12 flex flex-col gap-6 page-enter">
        <div class="mb-3">
          <h1 class="text-[24px] leading-8 font-semibold" data-i18n="notifTitle">Notification Settings</h1>
          <p class="text-[#bdc9c2] mt-1" data-i18n="notifSubtitle">Manage your spiritual reminders and Adhan preferences.</p>
        </div>

        <div class="bg-primary/10 backdrop-blur-xl border border-white/10 rounded-xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3 relative overflow-hidden">
          <div class="absolute -top-10 -right-10 w-32 h-32 bg-primary/20 rounded-full blur-3xl pointer-events-none"></div>
          <div class="flex items-start sm:items-center gap-3 relative z-10">
            <div class="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center shrink-0"><span class="material-symbols-outlined text-primary icon-filled">notifications_active</span></div>
            <div>
              <h2 class="text-[20px] leading-7 font-semibold" data-i18n="enableNotifTitle">Enable System Notifications</h2>
              <p id="permission-status" class="text-[#bdc9c2] text-[14px] leading-5 font-medium mt-1" data-i18n="permDefault">Permission not requested yet</p>
            </div>
          </div>
          <button type="button" id="ask-permission-btn" onclick="window.NoorApp.askNotifPermission()" class="shrink-0 bg-primary text-[#00382a] text-[14px] font-medium px-6 py-2.5 rounded-lg hover:opacity-90 transition-colors shadow-[0_10px_30px_rgba(45,139,111,0.2)] relative z-10" data-i18n="allowAccess">Allow Access</button>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 mt-3">
          <div class="lg:col-span-8 flex flex-col gap-3">
            <h3 class="text-[12px] leading-4 font-semibold uppercase tracking-widest text-[#bdc9c2]" data-i18n="dailyPrayers">Daily Prayers</h3>
            <div id="notif-prayer-list"></div>
          </div>
          <div class="lg:col-span-4 flex flex-col gap-3">
            <h3 class="text-[12px] leading-4 font-semibold uppercase tracking-widest text-[#bdc9c2]" data-i18n="audioPreferences">Audio Preferences</h3>
            <div class="glass-panel rounded-xl p-3 flex flex-col gap-3">
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-1"><span class="material-symbols-outlined text-[20px]">graphic_eq</span><span class="text-[20px] leading-7 font-semibold" data-i18n="globalAdhan">Global Adhan</span></div>
                <button type="button" id="play-adhan-btn" onclick="window.NoorApp.playAdhanPreview()" class="text-primary hover:opacity-80"><span class="material-symbols-outlined text-[20px]">play_circle</span></button>
              </div>
              <div class="flex items-center justify-between">
                <span class="text-[#bdc9c2] text-[14px]" data-i18n="volume">Volume</span>
                <span id="volume-display">80%</span>
              </div>
              <input type="range" id="volume-slider" min="0" max="1" step="0.1" value="0.8" class="w-full" oninput="window.NoorApp.setVolume(this.value)">
              <div class="flex items-center justify-between">
                <span class="text-[#bdc9c2] text-sm" data-i18n="mute">Mute</span>
                <label class="noor-switch-label"><input type="checkbox" id="mute-toggle" class="sr-only" onchange="window.NoorApp.toggleMute()"><span class="noor-switch"><span></span></span></label>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </main>
  ${footer()}
  ${bottomNav('alerts')}
</div>`,
      'notifications'
    )
  )
})

app.get('/admin', (c) => {
  return c.html(
    renderPage(
      'Noor Prayer Times - Admin',
      `
<div class="flex min-h-screen" style="background:#111415;background-image:radial-gradient(circle at center,rgba(126,215,183,0.05) 0%,transparent 70%)">
  <main class="flex-1 w-full pb-24 md:pb-0">
    ${dashboardTopBar()}
    <div class="max-w-[1200px] mx-auto px-5 py-12 space-y-6 page-enter">
      <div class="mb-12">
        <h2 class="text-[24px] leading-8 font-semibold mb-2" data-i18n="uploadSchedule">Upload Schedule</h2>
        <p class="text-[#bdc9c2]" data-i18n="uploadSubtitle">Securely import monthly prayer times via CSV format.</p>
      </div>

      <div id="admin-login">
        <form id="login-form" class="glass-panel rounded-xl p-6 max-w-xl" onsubmit="return window.NoorAdmin.login(event)">
          <h3 class="text-[20px] leading-7 font-semibold mb-2" data-i18n="adminAccessTitle">Admin Access</h3>
          <p class="text-[#bdc9c2] mb-4" data-i18n="adminAccessBody">Enter the admin password to unlock uploads and data management.</p>
          <label class="block text-[#bdc9c2] mb-2" data-i18n="passwordLabel">Admin Password</label>
          <input type="password" id="admin-password" autocomplete="current-password" class="w-full border border-white/10 rounded-lg px-4 py-3 focus:outline-none focus:border-primary" style="background:#191c1d;color:#e1e3e4" required>
          <p id="login-error" class="mt-3 text-[#ffb4ab] hidden"></p>
          <button type="submit" class="mt-4 bg-primary text-[#00382a] px-6 py-2 rounded-full text-[14px] font-medium shadow-[0_10px_30px_rgba(126,215,183,0.3)] hover:opacity-90 transition-colors" data-i18n="unlockDashboard">Unlock Dashboard</button>
        </form>
      </div>

      <div id="admin-dashboard" class="hidden">
        <div class="flex justify-end mb-4">
          <button type="button" onclick="window.NoorAdmin.logout()" class="text-[#bdc9c2] hover:text-primary transition-colors text-sm" data-i18n="logout">Log Out</button>
        </div>
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div class="lg:col-span-2 glass-panel rounded-xl p-6 flex flex-col items-center justify-center border-2 border-dashed border-primary/30 hover:border-primary/60 transition-colors min-h-[300px] relative">
            <input type="file" id="csv-file" accept=".csv" class="absolute inset-0 w-full h-full opacity-0 cursor-pointer" title="Upload CSV">
            <div class="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4"><span class="material-symbols-outlined text-primary text-4xl">cloud_upload</span></div>
            <h3 class="text-[20px] leading-7 font-semibold mb-2" data-i18n="dragDrop">Drag & Drop CSV File</h3>
            <p class="text-[#bdc9c2] mb-4 text-center" data-i18n="uploadHint">or click to browse. Expected: date, fajr, dhuhr, asr, maghrib, isha, city</p>
            <span id="selected-file" class="bg-primary text-[#00382a] px-6 py-2 rounded-full text-[14px] font-medium" data-i18n="selectFile">Select File</span>
          </div>
          <div class="space-y-6">
            <div class="glass-panel rounded-lg p-4 border-l-4 border-l-primary flex items-start gap-3 bg-primary/5">
              <span class="material-symbols-outlined text-primary icon-filled">check_circle</span>
              <div><h4 class="text-[14px] font-medium mb-1" data-i18n="uploadSuccessful">Upload Successful</h4><p id="upload-status" class="text-[12px] text-[#bdc9c2]" data-i18n="waitingUpload">Waiting for upload...</p></div>
            </div>
            <div class="glass-panel rounded-xl p-6">
              <h3 class="text-[20px] leading-7 font-semibold mb-4" data-i18n="manageData">Manage Data</h3>
              <p class="text-[12px] text-[#bdc9c2] mb-4" data-i18n="manageHint">Remove existing months to prevent conflicts.</p>
              <div id="months-list" class="space-y-3"><p class="text-[#bdc9c2]" data-i18n="noMonths">No uploaded months found yet.</p></div>
            </div>
          </div>
        </div>
        <div class="flex gap-3 mt-4">
          <button type="button" onclick="window.NoorAdmin.upload('preview')" class="px-4 py-2 rounded-lg border border-[#88938d]/50 text-[#bdc9c2] text-[12px] font-semibold hover:bg-[#323536] transition-colors">Preview CSV</button>
          <button type="button" id="commit-btn" onclick="window.NoorAdmin.upload('commit')" class="px-4 py-2 rounded-lg bg-primary text-[#00382a] text-[12px] font-semibold hover:opacity-90 transition-colors">Confirm & Save</button>
        </div>
        <div class="glass-panel rounded-xl p-6 mt-12 overflow-x-auto">
          <h3 class="text-[20px] leading-7 font-semibold mb-6" data-i18n="dataPreview">Data Preview</h3>
          <table class="w-full text-left border-collapse"><thead><tr class="border-b border-white/10">
            <th class="py-3 px-4 text-[14px] text-[#bdc9c2]">Date</th>
            <th class="py-3 px-4 text-[14px] text-[#bdc9c2]" data-i18n="fajr">Fajr</th>
            <th class="py-3 px-4 text-[14px] text-[#bdc9c2]" data-i18n="dhuhr">Dhuhr</th>
            <th class="py-3 px-4 text-[14px] text-[#bdc9c2]" data-i18n="asr">Asr</th>
            <th class="py-3 px-4 text-[14px] text-[#bdc9c2]" data-i18n="maghrib">Maghrib</th>
            <th class="py-3 px-4 text-[14px] text-[#bdc9c2]" data-i18n="isha">Isha</th>
            <th class="py-3 px-4 text-[14px] text-[#bdc9c2]">City</th>
          </tr></thead><tbody id="preview-body" class="text-base">
            <tr class="border-b border-white/5"><td class="py-3 px-4 text-[#bdc9c2]" data-i18n="waitingUpload">Waiting for upload...</td><td class="py-3 px-4 text-[#bdc9c2]">-</td><td class="py-3 px-4 text-[#bdc9c2]">-</td><td class="py-3 px-4 text-[#bdc9c2]">-</td><td class="py-3 px-4 text-[#bdc9c2]">-</td><td class="py-3 px-4 text-[#bdc9c2]">-</td><td class="py-3 px-4 text-[#bdc9c2]">-</td></tr>
          </tbody></table>
        </div>
        <div id="error-section" class="hidden glass-panel rounded-xl p-6 mt-6"><h3 class="text-[20px] leading-7 font-semibold mb-4">Row-level Errors</h3><div id="error-list" class="space-y-2"></div></div>
      </div>
    </div>
  </main>
  ${bottomNav('admin')}
  ${footer()}
</div>`,
      'admin'
    )
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// Vercel export — Vercel natively detects Hono apps exported as default.
// No `handle()` wrapper, no `(req, res)` adapter, no `export const config`
// needed: Vercel detects the framework, sets Node.js runtime, and calls
// `app.fetch(request)` for us.
//   https://vercel.com/docs/frameworks/backend/hono
// ─────────────────────────────────────────────────────────────────────────────
export default app
