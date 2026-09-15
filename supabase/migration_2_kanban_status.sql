alter table tasks add column status text not null default 'previst' check (status in ('previst','pendent','en_proces','bloquejat','fet'));
alter table tasks add column blocked_reason text;
alter table tasks add column status_changed_at timestamptz not null default now();

insert into tasks (title, room_id, category, effort, weekday, frequency) values
  ('Buidar la pols de la Roomba', null, 'Neteja', 'baix', 1, 'setmanal'),
  ('Fregar el terra de tot el pis', null, 'Neteja', 'mitja', 4, 'setmanal'),
  ('Fer la llista de la compra', null, 'Ordre', 'baix', 5, 'setmanal'),
  ('Anar a comprar', null, 'Ordre', 'mitja', 6, 'setmanal'),
  ('Treure les escombraries', null, 'Neteja', 'baix', 2, 'setmanal'),
  ('Treure el reciclatge (envasos, paper, vidre)', null, 'Ordre', 'baix', 6, 'quinzenal'),
  ('Passar l''aspirador per catifes i racons', null, 'Neteja', 'mitja', 3, 'setmanal'),
  ('Revisar i llençar menjar caducat', null, 'Ordre', 'baix', 5, 'setmanal'),

  ('Netejar el marbre i el taulell', (select id from rooms where name = 'Cuina'), 'Neteja', 'baix', 3, 'setmanal'),
  ('Netejar els fogons i el forn', (select id from rooms where name = 'Cuina'), 'Neteja', 'mitja', 0, 'setmanal'),
  ('Buidar i netejar la nevera per dins', (select id from rooms where name = 'Cuina'), 'Neteja', 'alt', 6, 'mensual'),
  ('Netejar el microones', (select id from rooms where name = 'Cuina'), 'Neteja', 'baix', 2, 'quinzenal'),
  ('Netejar el filtre de la campana extractora', (select id from rooms where name = 'Cuina'), 'Manteniment', 'mitja', 0, 'trimestral'),
  ('Descalcificar la cafetera', (select id from rooms where name = 'Cuina'), 'Manteniment', 'baix', 6, 'mensual'),
  ('Endreçar armaris i rebost', (select id from rooms where name = 'Cuina'), 'Ordre', 'alt', 0, 'mensual'),

  ('Treure la pols dels mobles', (select id from rooms where name = 'Menjador'), 'Mobles', 'baix', 4, 'setmanal'),
  ('Netejar per dins el moble de sota la tele', (select id from rooms where name = 'Menjador'), 'Ordre', 'mitja', 6, 'mensual'),
  ('Netejar vidres i miralls', (select id from rooms where name = 'Menjador'), 'Vidres', 'baix', 5, 'quinzenal'),

  ('Canviar els llençols', (select id from rooms where name = 'Habitacio'), 'Ordre', 'mitja', 0, 'quinzenal'),
  ('Treure la pols dels mobles i tauletes', (select id from rooms where name = 'Habitacio'), 'Mobles', 'baix', 4, 'setmanal'),
  ('Endreçar roba i calaixos', (select id from rooms where name = 'Habitacio'), 'Ordre', 'mitja', 0, 'quinzenal'),
  ('Passar l''aspirador sota el llit', (select id from rooms where name = 'Habitacio'), 'Neteja', 'mitja', 6, 'mensual'),

  ('Endreçar els armaris oberts', (select id from rooms where name = 'Vestidor-despatx'), 'Ordre', 'alt', 0, 'quinzenal'),
  ('Treure la pols de l''escriptori i prestatges', (select id from rooms where name = 'Vestidor-despatx'), 'Mobles', 'baix', 1, 'setmanal'),
  ('Organitzar cables i documents', (select id from rooms where name = 'Vestidor-despatx'), 'Ordre', 'mitja', 0, 'mensual'),

  ('Netejar vater, dutxa i lavabo', (select id from rooms where name = 'Lavabo'), 'Neteja', 'mitja', 6, 'setmanal'),
  ('Fregar el terra del lavabo', (select id from rooms where name = 'Lavabo'), 'Neteja', 'baix', 6, 'setmanal'),
  ('Netejar el mirall', (select id from rooms where name = 'Lavabo'), 'Vidres', 'baix', 6, 'setmanal'),
  ('Rentar les tovalloles de bany', (select id from rooms where name = 'Lavabo'), 'Ordre', 'baix', 0, 'setmanal'),
  ('Netejar desguassos amb bicarbonat', (select id from rooms where name = 'Lavabo'), 'Manteniment', 'baix', 0, 'mensual'),

  ('Fregar i aspirar el terra', (select id from rooms where name = 'Passadissos'), 'Neteja', 'mitja', 3, 'setmanal'),
  ('Treure la pols de marcs i prestatges', (select id from rooms where name = 'Passadissos'), 'Mobles', 'baix', 4, 'quinzenal'),

  ('Fregar la terrassa', (select id from rooms where name = 'Balco'), 'Neteja', 'mitja', 6, 'quinzenal'),
  ('Regar i cuidar les plantes', (select id from rooms where name = 'Balco'), 'Manteniment', 'baix', 2, 'setmanal'),
  ('Netejar vidres i baranes', (select id from rooms where name = 'Balco'), 'Vidres', 'mitja', 6, 'mensual'),
  ('Endreçar mobles i estris', (select id from rooms where name = 'Balco'), 'Mobles', 'mitja', 6, 'trimestral');
