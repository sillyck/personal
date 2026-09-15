alter table tasks add column priority_override text check (priority_override in ('urgent','alta','normal','baixa'));
