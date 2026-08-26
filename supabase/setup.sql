-- OCR PDF → Word: Supabase Storage setup
-- Run in Supabase SQL Editor (or via supabase CLI). Safe to re-run.

-- Private buckets: no public access. All access via service-role key (server) + signed URLs.
insert into storage.buckets (id, name, public)
values ('temp-images', 'temp-images', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('word-exports', 'word-exports', false)
on conflict (id) do nothing;

-- RLS: deny all client (anon) access. Server uses service-role key (bypasses RLS).
alter table storage.objects enable row level security;

drop policy if exists "deny_anon_temp_images" on storage.objects;
create policy "deny_anon_temp_images" on storage.objects
  for all using (bucket_id = 'temp-images' and false) with check (bucket_id = 'temp-images' and false);

drop policy if exists "deny_anon_word_exports" on storage.objects;
create policy "deny_anon_word_exports" on storage.objects
  for all using (bucket_id = 'word-exports' and false) with check (bucket_id = 'word-exports' and false);
