-- Substitueix l'esforç (baix/mitja/alt) per una durada aproximada en minuts.
alter table tasks add column if not exists duration_minutes integer;

update tasks set duration_minutes = case effort
  when 'baix' then 15
  when 'mitja' then 30
  when 'alt' then 60
  else 30
end
where duration_minutes is null;

alter table tasks alter column duration_minutes set default 30;
alter table tasks alter column duration_minutes set not null;
alter table tasks drop column if exists effort;
