-- Pilot Ops — media storage bucket (private; access via signed URLs / RLS)
insert into storage.buckets (id, name, public)
values ('media', 'media', false)
on conflict (id) do nothing;

-- storage.objects already has RLS enabled in Supabase; scope to the bucket.
-- (On Supabase Cloud, if creating these via SQL is blocked by object ownership,
--  add the same bucket-scoped policies from the Storage dashboard instead.)
drop policy if exists "media read"   on storage.objects;
drop policy if exists "media insert" on storage.objects;
drop policy if exists "media update" on storage.objects;
drop policy if exists "media delete" on storage.objects;
create policy "media read"   on storage.objects for select to authenticated using (bucket_id = 'media');
create policy "media insert" on storage.objects for insert to authenticated with check (bucket_id = 'media');
create policy "media update" on storage.objects for update to authenticated using (bucket_id = 'media');
create policy "media delete" on storage.objects for delete to authenticated using (bucket_id = 'media');
