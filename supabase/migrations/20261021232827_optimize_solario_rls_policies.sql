alter policy solario_admin_read on public.solario_crm_records
  using (lower(coalesce((select auth.jwt() ->> 'email'), '')) = 'alex@exclusivesolario.pt');

alter policy solario_admin_insert on public.solario_crm_records
  with check (lower(coalesce((select auth.jwt() ->> 'email'), '')) = 'alex@exclusivesolario.pt');

alter policy solario_admin_update on public.solario_crm_records
  using (lower(coalesce((select auth.jwt() ->> 'email'), '')) = 'alex@exclusivesolario.pt')
  with check (lower(coalesce((select auth.jwt() ->> 'email'), '')) = 'alex@exclusivesolario.pt');

alter policy solario_admin_delete on public.solario_crm_records
  using (lower(coalesce((select auth.jwt() ->> 'email'), '')) = 'alex@exclusivesolario.pt');
