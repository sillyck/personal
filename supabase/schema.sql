create extension if not exists pgcrypto;

create table rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  has_storage boolean not null default false,
  storage_note text,
  sort_order int not null default 0
);

create table tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  room_id uuid references rooms(id) on delete set null,
  category text not null default 'Neteja' check (category in ('Neteja','Vidres','Mobles','Manteniment','Ordre')),
  effort text not null default 'mitja' check (effort in ('baix','mitja','alt')),
  weekday int not null check (weekday between 0 and 6),
  frequency text not null check (frequency in ('setmanal','quinzenal','mensual','trimestral','semestral','anual')),
  last_completed_at date,
  created_at timestamptz not null default now()
);

create table task_completions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  completed_at date not null default current_date,
  created_at timestamptz not null default now()
);

create table proactive_content (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('decoracio','manteniment','trucs','enllacos')),
  title text not null,
  body text,
  url text,
  created_at timestamptz not null default now()
);

alter table rooms enable row level security;
alter table tasks enable row level security;
alter table task_completions enable row level security;
alter table proactive_content enable row level security;

create policy "authenticated full access" on rooms for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated full access" on tasks for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated full access" on task_completions for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated full access" on proactive_content for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

insert into rooms (name, has_storage, storage_note, sort_order) values
  ('Cuina', true, 'Armaris i rebost', 1),
  ('Menjador', true, 'Moble sota la tele', 2),
  ('Habitacio', false, null, 3),
  ('Vestidor-despatx', true, 'Armaris oberts', 4),
  ('Lavabo', false, null, 5),
  ('Passadissos', false, null, 6),
  ('Balco', false, null, 7);

insert into proactive_content (category, title, body, url) values
  ('manteniment', 'Filtre de la campana extractora', 'Neteja o substitueix el filtre de greix cada 3 mesos per mantenir el tiratge i evitar olors.', null),
  ('manteniment', 'Junta de la nevera', 'Revisa que la junta de goma de la porta faci ventosa correctament cada 6 mesos; si no, perds eficiencia i gastes mes llum.', null),
  ('manteniment', 'Desguassos', 'Aboca aigua calenta amb bicarbonat pels desguassos de lavabo i cuina un cop al mes per evitar olors i obstruccions.', null),
  ('decoracio', 'Plantes d''interior de poc manteniment', 'Pothos, sansevieria o zamioculcas aguanten be amb poca llum i reguen cada 1-2 setmanes.', null),
  ('decoracio', 'Il·luminacio calida indirecta', 'Canviar bombetes a to calid (2700K) i afegir un punt de llum indirecta al saló millora molt la sensacio d''ambient.', null),
  ('trucs', 'Vinagre per als vidres', 'Barreja aigua i vinagre blanc a parts iguals per netejar vidres sense deixar marques, amb paper de diari o microfibra.', null),
  ('trucs', 'Bicarbonat per a taques', 'Pasta de bicarbonat amb una mica d''aigua treu bé taques de superficies de cuina i lavabo sense ratllar.', null);
