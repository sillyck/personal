-- Script consolidat i segur de re-executar. Nomes crea el que falta;
-- no esborra ni sobreescriu taules o dades que ja existeixin.
-- Substitueix haver d'executar migration_6 a migration_10 per separat.

-- ---- migration_6_travel_map ----
insert into storage.buckets (id, name, public) values ('travel-photos', 'travel-photos', true)
  on conflict (id) do nothing;

drop policy if exists "authenticated manage travel photos" on storage.objects;
create policy "authenticated manage travel photos" on storage.objects
  for all using (bucket_id = 'travel-photos' and auth.role() = 'authenticated')
  with check (bucket_id = 'travel-photos' and auth.role() = 'authenticated');

create table if not exists visited_places (
  id uuid primary key default gen_random_uuid(),
  country_code text not null,
  country_name text not null,
  place_name text,
  visited_from date,
  notes text,
  photo_path text,
  created_at timestamptz not null default now()
);

alter table visited_places enable row level security;
drop policy if exists "authenticated full access" on visited_places;
create policy "authenticated full access" on visited_places for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ---- migration_7_visit_dates_regions ----
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'visited_places' and column_name = 'visited_on'
  ) then
    alter table visited_places rename column visited_on to visited_from;
  end if;
end $$;

alter table visited_places add column if not exists visited_to date;
alter table visited_places add column if not exists region_name text;

-- ---- migration_8_finances ----
insert into storage.buckets (id, name, public) values ('finance-docs', 'finance-docs', false)
  on conflict (id) do nothing;

drop policy if exists "authenticated manage finance docs" on storage.objects;
create policy "authenticated manage finance docs" on storage.objects
  for all using (bucket_id = 'finance-docs' and auth.role() = 'authenticated')
  with check (bucket_id = 'finance-docs' and auth.role() = 'authenticated');

create table if not exists finance_documents (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  file_name text not null,
  file_path text not null,
  file_type text not null check (file_type in ('csv', 'pdf', 'altre')),
  uploaded_at timestamptz not null default now()
);

alter table finance_documents enable row level security;
drop policy if exists "authenticated full access" on finance_documents;
create policy "authenticated full access" on finance_documents for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create table if not exists holdings (
  id uuid primary key default gen_random_uuid(),
  ticker text not null,
  name text,
  quantity numeric not null,
  avg_cost numeric,
  country text,
  notes text,
  created_at timestamptz not null default now()
);

alter table holdings enable row level security;
drop policy if exists "authenticated full access" on holdings;
create policy "authenticated full access" on holdings for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ---- migration_9_shopping_list ----
create table if not exists shopping_list (
  id uuid primary key default gen_random_uuid(),
  item_name text not null,
  note text,
  checked boolean not null default false,
  created_at timestamptz not null default now()
);

alter table shopping_list enable row level security;
drop policy if exists "authenticated full access" on shopping_list;
create policy "authenticated full access" on shopping_list for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ---- migration_10_finance_expansion ----
alter table holdings add column if not exists current_price numeric;

create table if not exists holding_allocations (
  id uuid primary key default gen_random_uuid(),
  holding_id uuid not null references holdings(id) on delete cascade,
  country_code text not null,
  country_name text not null,
  percentage numeric not null check (percentage > 0 and percentage <= 100)
);

alter table holding_allocations enable row level security;
drop policy if exists "authenticated full access" on holding_allocations;
create policy "authenticated full access" on holding_allocations for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
