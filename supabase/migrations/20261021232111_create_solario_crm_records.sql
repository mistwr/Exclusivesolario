create table public.solario_crm_records (
  id text primary key check (id ~ '^[A-Za-z0-9_-]{1,120}$'),
  type text not null check (type in ('clients', 'visits', 'followUps', 'sales')),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index solario_crm_records_type_created_idx
  on public.solario_crm_records (type, created_at asc);

alter table public.solario_crm_records enable row level security;

grant select, insert, update, delete on public.solario_crm_records to authenticated;
grant insert on public.solario_crm_records to anon;

create policy solario_admin_read
  on public.solario_crm_records for select to authenticated
  using (lower(coalesce(auth.jwt() ->> 'email', '')) = 'alex@exclusivesolario.pt');

create policy solario_admin_insert
  on public.solario_crm_records for insert to authenticated
  with check (lower(coalesce(auth.jwt() ->> 'email', '')) = 'alex@exclusivesolario.pt');

create policy solario_admin_update
  on public.solario_crm_records for update to authenticated
  using (lower(coalesce(auth.jwt() ->> 'email', '')) = 'alex@exclusivesolario.pt')
  with check (lower(coalesce(auth.jwt() ->> 'email', '')) = 'alex@exclusivesolario.pt');

create policy solario_admin_delete
  on public.solario_crm_records for delete to authenticated
  using (lower(coalesce(auth.jwt() ->> 'email', '')) = 'alex@exclusivesolario.pt');

create policy solario_public_contact_insert
  on public.solario_crm_records for insert to anon
  with check (
    type = 'clients'
    and id like 'lead-%'
    and payload ->> 'id' = id
    and payload ->> 'status' = 'interested'
    and payload ->> 'source' = 'Site'
    and coalesce(payload ->> 'number', '') = ''
    and coalesce(payload ->> 'notes', '') = ''
    and nullif(btrim(payload ->> 'consentAt'), '') is not null
    and length(btrim(coalesce(payload ->> 'name', ''))) between 1 and 100
    and length(regexp_replace(coalesce(payload ->> 'phone', ''), '[^0-9]', '', 'g')) between 8 and 15
    and payload - array['id', 'number', 'name', 'phone', 'status', 'source', 'notes', 'consentAt', 'createdAt', 'updatedAt']::text[] = '{}'::jsonb
  );
