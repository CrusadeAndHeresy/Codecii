-- Rules Library: private, per-user storage for sync between devices.
-- Lives alongside another app's tables, so every table is prefixed rl_. Sign-in uses the project's existing accounts.
-- No page images are stored: page references are enough to look things up in your own books.
-- Every row belongs to one user; RLS means only that user can read or write it.
-- Rules text is the user's own transcription of books they own: never make these tables public.

create table if not exists rl_game_systems (
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  id text not null,
  name text not null,
  publisher text,
  updated_at bigint not null,
  deleted boolean not null default false,
  primary key (owner_id, id)
);

create table if not exists rl_editions (
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  id text not null,
  system_id text not null,
  name text not null,
  released date,
  updated_at bigint not null,
  deleted boolean not null default false,
  primary key (owner_id, id)
);

create table if not exists rl_sources (
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  id text not null,
  edition_id text not null,
  title text not null,
  kind text not null check (kind in ('rulebook','supplement','download','faq','errata','user')),
  is_core boolean not null default false,
  version text,
  published date not null,
  updated_at bigint not null,
  deleted boolean not null default false,
  primary key (owner_id, id)
);

create table if not exists rl_rules (
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  id text not null,
  edition_id text not null,
  name text not null,
  norm_name text not null,
  aliases text[] not null default '{}',
  category text not null,
  parameters jsonb not null default '[]',
  phase text,
  section text,
  tags text[] not null default '{}',
  related_rule_ids text[] not null default '{}',
  faction text,
  overrides_rule_id text,
  supersedes text,
  preferred_printing_id text,
  updated_at bigint not null,
  deleted boolean not null default false,
  primary key (owner_id, id)
);

create table if not exists rl_printings (
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  id text not null,
  rule_id text not null,
  source_id text not null,
  page text,
  summary text,
  full_text text,
  text_hash text,
  status text not null default 'unverified' check (status in ('unverified','ai-checked','verified')),
  extracted_by text not null default 'manual',
  confidence real,
  updated_at bigint not null,
  deleted boolean not null default false,
  primary key (owner_id, id)
);

create table if not exists rl_amendments (
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  id text not null,
  rule_id text not null,
  source_id text not null,
  page text,
  type text not null check (type in ('replace','insert','delete','clarification')),
  find text,
  text text,
  question text,
  also_rule_ids text[] not null default '{}',
  updated_at bigint not null,
  deleted boolean not null default false,
  primary key (owner_id, id)
);

create table if not exists rl_entities (
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  id text not null,
  edition_id text not null,
  source_id text not null,
  name text not null,
  type text not null,
  faction text,
  page text,
  unit_type text,
  sub_types text[] not null default '{}',
  role text,
  stats jsonb not null default '[]',
  keywords text[] not null default '{}',
  notes text,
  rules jsonb not null default '[]',
  rule_ids text[] not null default '{}',
  wargear_ids text[] not null default '{}',
  updated_at bigint not null,
  deleted boolean not null default false,
  primary key (owner_id, id)
);

create table if not exists rl_edit_log (
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  id bigserial primary key,
  at bigint not null,
  device text,
  record_type text not null,
  record_id text not null,
  action text not null,
  before jsonb,
  after jsonb
);

-- Sync pulls "everything changed since X" per table.
create index if not exists rl_rules_sync on rl_rules (owner_id, updated_at);
create index if not exists rl_printings_sync on rl_printings (owner_id, updated_at);
create index if not exists rl_amendments_sync on rl_amendments (owner_id, updated_at);
create index if not exists rl_entities_sync on rl_entities (owner_id, updated_at);
create index if not exists rl_sources_sync on rl_sources (owner_id, updated_at);
create index if not exists rl_edit_log_owner on rl_edit_log (owner_id, at);

do $$
declare t text;
begin
  foreach t in array array['rl_game_systems','rl_editions','rl_sources','rl_rules','rl_printings','rl_amendments','rl_entities','rl_edit_log'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists rl_own_rows on %I', t);
    execute format(
      'create policy rl_own_rows on %I for all to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()))', t);
  end loop;
end $$;
