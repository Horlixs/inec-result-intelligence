-- Polling-unit names are not unique within a ward in the INEC snapshot.
-- The real stable key is the polling-unit code within its ward.

with duplicates as (
  select
    id,
    min(id) over (partition by ward_id, pu_code) as keep_id
  from public.polling_units
  where pu_code is not null
)
update public.result_sheets rs
set polling_unit_id = d.keep_id
from duplicates d
where rs.polling_unit_id = d.id
  and d.id <> d.keep_id;

with duplicates as (
  select
    id,
    min(id) over (partition by ward_id, pu_code) as keep_id
  from public.polling_units
  where pu_code is not null
)
delete from public.polling_units pu
using duplicates d
where pu.id = d.id
  and d.id <> d.keep_id;

alter table public.polling_units
  drop constraint if exists polling_units_ward_id_name_key;

drop index if exists public.idx_polling_units_ward_pu_code_unique;

create unique index idx_polling_units_ward_pu_code_unique
  on public.polling_units(ward_id, pu_code);
