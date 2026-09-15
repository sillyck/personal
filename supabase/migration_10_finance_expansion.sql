alter table holdings add column current_price numeric;

create table holding_allocations (
  id uuid primary key default gen_random_uuid(),
  holding_id uuid not null references holdings(id) on delete cascade,
  country_code text not null,
  country_name text not null,
  percentage numeric not null check (percentage > 0 and percentage <= 100)
);

alter table holding_allocations enable row level security;
create policy "authenticated full access" on holding_allocations for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
