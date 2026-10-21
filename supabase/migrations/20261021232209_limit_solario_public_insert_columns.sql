revoke all on table public.solario_crm_records from anon, authenticated, public;
grant select, insert, update, delete on table public.solario_crm_records to authenticated;
grant insert (id, type, payload) on table public.solario_crm_records to anon;
