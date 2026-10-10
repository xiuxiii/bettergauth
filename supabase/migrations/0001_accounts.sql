-- MindGap accounts: run once in Supabase → SQL editor (safe to re-run).
--
-- Every row belongs to one student and row-level security keeps it that way:
-- the public (anon/publishable) key in the browser can only reach the signed-in
-- student's own rows, and only once the server has recorded that they are 13
-- or older (profiles.age_ok_at, written with the service-role key by
-- /api/account/age — a student can't set it themselves).

-- Profiles ------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  -- When the student confirmed they are 13+. The birth date itself is not kept.
  age_ok_at timestamptz,
  -- TutorPreferences (lib/tutor/types.ts), synced across devices.
  preferences jsonb,
  -- For Stripe later. Server-written only.
  plan text not null default 'free',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "update own profile" on public.profiles;
create policy "update own profile" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- Students may change only their preferences; age_ok_at and plan are the
-- server's. No insert policy: the server creates the row at the age step.
revoke insert, update, delete on public.profiles from anon, authenticated;
grant update (preferences, updated_at) on public.profiles to authenticated;

create or replace function public.age_ok() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and age_ok_at is not null
  );
$$;

-- Sessions (a problem and its conversation) ---------------------------------

create table if not exists public.sessions (
  user_id uuid not null references auth.users (id) on delete cascade,
  -- The id the device gave it (lib/history/db.ts newId).
  id text not null,
  -- Milliseconds since the epoch, like the device's record.
  created_at bigint not null,
  updated_at bigint not null,
  -- Set when deleted, so other devices learn of the delete. Record cleared.
  deleted_at bigint,
  -- The device's SessionRecord minus syncedAt; null once deleted.
  record jsonb,
  -- When the server last saw a write, by the server's clock. Devices pull
  -- "changed since" by this, never by updated_at: a phone whose clock runs
  -- behind would otherwise write rows the others never ask for.
  changed_at timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists sessions_user_changed on public.sessions (user_id, changed_at);

create or replace function public.touch_changed_at() returns trigger
language plpgsql as $$
begin
  new.changed_at := now();
  return new;
end;
$$;

drop trigger if exists sessions_changed_at on public.sessions;
create trigger sessions_changed_at before insert or update on public.sessions
  for each row execute function public.touch_changed_at();

alter table public.sessions enable row level security;

drop policy if exists "own sessions" on public.sessions;
create policy "own sessions" on public.sessions
  for all using (auth.uid() = user_id and public.age_ok())
  with check (auth.uid() = user_id and public.age_ok());

-- Photos ----------------------------------------------------------------------

-- Private bucket; objects live at <user_id>/<image_id>.jpg.
insert into storage.buckets (id, name, public)
values ('photos', 'photos', false)
on conflict (id) do nothing;

drop policy if exists "own photos" on storage.objects;
create policy "own photos" on storage.objects
  for all using (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.age_ok()
  )
  with check (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.age_ok()
  );
