-- Idempotent: segur de tornar a executar si falla a mitges.

alter table shopping_list add column if not exists quantity numeric not null default 1;
alter table shopping_list add column if not exists unit text;
alter table shopping_list add column if not exists section text;
alter table shopping_list add column if not exists chosen_supermarket text;

create table if not exists shopping_item_prices (
  id uuid primary key default gen_random_uuid(),
  shopping_item_id uuid not null references shopping_list(id) on delete cascade,
  supermarket text not null,
  price numeric not null,
  created_at timestamptz not null default now()
);

alter table shopping_item_prices enable row level security;
drop policy if exists "authenticated full access" on shopping_item_prices;
create policy "authenticated full access" on shopping_item_prices for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
