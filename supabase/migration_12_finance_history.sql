-- Historial d'operacions (per comparar la cartera amb el MSCI World al llarg
-- del temps) i fotografies periodiques del valor real de la cartera.
create table if not exists holding_orders (
  id uuid primary key default gen_random_uuid(),
  isin text not null,
  order_date date not null,
  amount numeric,
  units numeric,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'holding_orders_unique'
  ) then
    alter table holding_orders
      add constraint holding_orders_unique unique (isin, order_date, amount, units);
  end if;
end $$;

alter table holding_orders enable row level security;
drop policy if exists "authenticated full access" on holding_orders;
create policy "authenticated full access" on holding_orders for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create table if not exists portfolio_snapshots (
  snapshot_date date primary key,
  total_value numeric not null,
  total_contributed numeric not null,
  created_at timestamptz not null default now()
);

alter table portfolio_snapshots enable row level security;
drop policy if exists "authenticated full access" on portfolio_snapshots;
create policy "authenticated full access" on portfolio_snapshots for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
