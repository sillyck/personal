create table shopping_list (
  id uuid primary key default gen_random_uuid(),
  item_name text not null,
  note text,
  checked boolean not null default false,
  created_at timestamptz not null default now()
);

alter table shopping_list enable row level security;
create policy "authenticated full access" on shopping_list for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
