-- Preus introduits a ma a la taula de preus per kg (supers sense dades
-- automatiques i el mercat). Un sol valor vigent per producte i botiga.
-- Idempotent: es pot tornar a executar sense errors.
create table if not exists market_prices (
  product_key text not null,
  store text not null check (store in ('esclat', 'dia', 'aldi', 'lidl', 'mercat')),
  price numeric not null check (price >= 0),
  updated_at timestamptz not null default now(),
  primary key (product_key, store)
);

alter table market_prices enable row level security;
drop policy if exists "authenticated full access" on market_prices;
create policy "authenticated full access" on market_prices for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
