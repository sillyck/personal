alter table tasks add column interval_days integer;
alter table tasks add column preferred_weekdays integer[] not null default '{}';

update tasks set
  interval_days = case frequency
    when 'setmanal' then 7
    when 'quinzenal' then 14
    when 'mensual' then 30
    when 'trimestral' then 90
    when 'semestral' then 180
    when 'anual' then 365
  end,
  preferred_weekdays = array[weekday];

alter table tasks alter column interval_days set not null;
alter table tasks add constraint interval_days_positive check (interval_days > 0);

alter table tasks drop column frequency;
alter table tasks drop column weekday;
