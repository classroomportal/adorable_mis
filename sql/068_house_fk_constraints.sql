-- Migration 068: Enforce students.boarding_house / sports_house against lookup tables
-- Run directly in Supabase SQL editor; filed here afterward for repo history.

-- Ensure lookup names are unique (required before they can be FK targets)
alter table boarding_houses add constraint boarding_houses_name_unique unique (name);
alter table sports_houses add constraint sports_houses_name_unique unique (name);

-- Add the actual foreign keys, nullable (students can have no house set)
alter table students
  add constraint students_boarding_house_fkey
  foreign key (boarding_house) references boarding_houses(name)
  on update cascade;

alter table students
  add constraint students_sports_house_fkey
  foreign key (sports_house) references sports_houses(name)
  on update cascade;
