insert into storage.buckets (id, name, public) values ('travel-photos', 'travel-photos', true);

create policy "authenticated manage travel photos" on storage.objects
  for all using (bucket_id = 'travel-photos' and auth.role() = 'authenticated')
  with check (bucket_id = 'travel-photos' and auth.role() = 'authenticated');

create table visited_places (
  id uuid primary key default gen_random_uuid(),
  country_code text not null,
  country_name text not null,
  place_name text,
  visited_on date,
  notes text,
  photo_path text,
  created_at timestamptz not null default now()
);

alter table visited_places enable row level security;
create policy "authenticated full access" on visited_places for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
