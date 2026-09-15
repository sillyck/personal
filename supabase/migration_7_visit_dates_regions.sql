alter table visited_places rename column visited_on to visited_from;
alter table visited_places add column visited_to date;
alter table visited_places add column region_name text;
