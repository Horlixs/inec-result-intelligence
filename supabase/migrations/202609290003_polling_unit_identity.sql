-- Polling-unit names are not unique within a ward in the INEC snapshot.
-- The real stable key is the polling-unit code within its ward.

with ranked as (
  select
    id,
    ward_id,
    pu_code,
    first_value(id) over (
      partition by ward_id, pu_code
      order by id
      rows between unbounded preceding and unbounded following
    ) as keep_id
  from public.polling_units
  where pu_code is not null
)
update public.result_sheets rs
set polling_unit_id = r.keep_id
from ranked r
where rs.polling_unit_id = r.id
  and r.id <> r.keep_id;

with ranked as (
  select
    id,
    first_value(id) over (
      partition by ward_id, pu_code
      order by id
      rows between unbounded preceding and unbounded following
    ) as keep_id
  from public.polling_units
  where pu_code is not null
)
delete from public.polling_units pu
using ranked r
where pu.id = r.id
  and r.id <> r.keep_id;

alter table public.polling_units
  drop constraint if exists polling_units_ward_id_name_key;

drop index if exists public.idx_polling_units_ward_pu_code_unique;

create unique index idx_polling_units_ward_pu_code_unique
  on public.polling_units(ward_id, pu_code);
