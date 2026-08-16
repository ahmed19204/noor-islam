# Noor Prayer Times — Data-Driven Bilingual PWA

Noor Prayer Times is a Progressive Web Application for viewing and managing monthly prayer-time schedules for Nizhny Novgorod. It combines a bilingual Russian/English interface, validated CSV import, protected administration, and server-side data storage.

## What It Demonstrates

- A TypeScript backend built with Hono and deployed as a Vercel serverless function.
- CSV validation with row-level feedback for schedule administration.
- Supabase-backed storage and a protected administration workflow.
- Progressive-web-app behaviour through a service worker, manifest, cached assets, and browser notifications.
- A localised, bilingual interface designed for a specific user context.

## Architecture

```text
PWA client
  ├─ Static application assets and Service Worker
  └─ Hono API on Vercel
       └─ Supabase database for schedule data

Administrator CSV upload → server-side validation → stored schedule version → client refresh
```

## Technology

| Area | Technology |
|---|---|
| Frontend | HTML, JavaScript, CSS, PWA APIs |
| Backend | TypeScript, Hono, Node.js on Vercel |
| Data | Supabase PostgREST, validated CSV import |
| Security | JWT-protected administration and environment-based secrets |
| Product delivery | Service Worker, web app manifest, bilingual RU/EN interface |

## Data Handling

Monthly schedules are imported through a CSV workflow that validates required columns and reports invalid rows. The project is designed so that schedule updates can trigger client-side refresh behaviour without publishing credentials or exposing administrative configuration in the repository.

## Run Locally

```bash
npm install
cp .env.example .env.local
vercel dev
```

Use only your own local configuration values. Do not commit service keys, administrator passwords, or production data.

## Project Scope

Maintained as a personal technical portfolio project by Ahmed Hussien Attia. It demonstrates API design, input validation, progressive-web-app behaviour, and data synchronisation patterns.

## Limitations and Next Steps

Schedule accuracy depends on the quality and timely update of the imported data. Notification delivery also depends on browser permissions, device settings, and service-worker support. Future work can add automated validation tests, improved operational monitoring, and a documented process for verifying schedule sources.
