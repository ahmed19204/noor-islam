-- ─────────────────────────────────────────────────────────────────────────────
-- Noor Prayer Times — Supabase schema
-- ─────────────────────────────────────────────────────────────────────────────
-- Run this ONCE in Supabase Dashboard → SQL Editor → New query.
-- It is idempotent: safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.prayer_times (
  id          bigserial primary key,
  date        date        not null,
  fajr        text        not null,
  dhuhr       text        not null,
  asr         text        not null,
  maghrib     text        not null,
  isha        text        not null,
  city        text        not null,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now(),
  unique (date, city)
);

create index if not exists prayer_times_city_date_idx
  on public.prayer_times (city, date);

create index if not exists prayer_times_updated_at_idx
  on public.prayer_times (updated_at desc);

-- Keep updated_at fresh on every PATCH so the client poll detects changes.
create or replace function public.tg_prayer_times_touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_prayer_times_touch on public.prayer_times;
create trigger trg_prayer_times_touch
  before update on public.prayer_times
  for each row execute function public.tg_prayer_times_touch_updated_at();

-- Row-Level Security
-- The serverless function uses the service_role key and bypasses RLS, so we
-- enable RLS and grant NO public policies. This makes the table inaccessible
-- to anonymous / authenticated client requests by default — only the server
-- (with the service_role key) can read or write it.
alter table public.prayer_times enable row level security;
