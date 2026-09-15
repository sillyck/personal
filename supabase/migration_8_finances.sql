insert into storage.buckets (id, name, public) values ('finance-docs', 'finance-docs', false);

create policy "authenticated manage finance docs" on storage.objects
  for all using (bucket_id = 'finance-docs' and auth.role() = 'authenticated')
  with check (bucket_id = 'finance-docs' and auth.role() = 'authenticated');

create table finance_documents (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  file_name text not null,
  file_path text not null,
  file_type text not null check (file_type in ('csv', 'pdf', 'altre')),
  uploaded_at timestamptz not null default now()
);

alter table finance_documents enable row level security;
create policy "authenticated full access" on finance_documents for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create table holdings (
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
create policy "authenticated full access" on holdings for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
