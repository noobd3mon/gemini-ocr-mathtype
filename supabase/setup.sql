-- OCR PDF → Word: Supabase Storage setup
-- Run in Supabase SQL Editor (or via supabase CLI). Safe to re-run.
--
-- GHI CHÚ: KHÔNG dùng `alter table storage.objects ...` — bảng này thuộc quyền
-- sở hữu của role nội bộ `supabase_storage_admin`, SQL Editor (role postgres)
-- không ALTER được và sẽ lỗi 42501 "must be owner of table objects".
-- RLS trên storage.objects ĐÃ được Supabase bật sẵn; khối dưới chỉ kiểm tra lại.
-- Mặc định khi bucket chưa có policy nào, mọi truy cập từ client (anon) đều bị
-- chặn — các policy "deny" dưới chỉ là khoá kép, và được bọc bắt lỗi để script
-- không gãy nếu dự án không cho tạo policy bằng SQL (khi đó tạo qua Dashboard).

-- 1) Ba bucket private:
--    temp-images  : ảnh trang PDF + ảnh cắt (xoá sau khi dùng / 3 ngày)
--    word-exports : file Word hoàn chỉnh (signed URL 3 ngày, cron dọn)
--    ocr-jobs     : state của task OCR chạy trên server (chứa key tạm thời)
insert into storage.buckets (id, name, public)
values ('temp-images', 'temp-images', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('word-exports', 'word-exports', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('ocr-jobs', 'ocr-jobs', false)
on conflict (id) do nothing;

-- 2) Khoá kép: policy deny-all cho client. Server dùng service-role key nên
--    không chịu ảnh hưởng của RLS/policy.
do $$
begin
  drop policy if exists "deny_anon_temp_images" on storage.objects;
  create policy "deny_anon_temp_images" on storage.objects
    for all using (bucket_id = 'temp-images' and false) with check (bucket_id = 'temp-images' and false);
exception
  when others then
    raise notice 'Bỏ qua policy deny_anon_temp_images (%). Bucket vẫn an toàn: RLS chặn client theo mặc định. Có thể tạo policy qua Dashboard → Storage → Policies.', sqlerrm;
end $$;

do $$
begin
  drop policy if exists "deny_anon_word_exports" on storage.objects;
  create policy "deny_anon_word_exports" on storage.objects
    for all using (bucket_id = 'word-exports' and false) with check (bucket_id = 'word-exports' and false);
exception
  when others then
    raise notice 'Bỏ qua policy deny_anon_word_exports (%). Bucket vẫn an toàn: RLS chặn client theo mặc định.', sqlerrm;
end $$;

do $$
begin
  drop policy if exists "deny_anon_ocr_jobs" on storage.objects;
  create policy "deny_anon_ocr_jobs" on storage.objects
    for all using (bucket_id = 'ocr-jobs' and false) with check (bucket_id = 'ocr-jobs' and false);
exception
  when others then
    raise notice 'Bỏ qua policy deny_anon_ocr_jobs (%). Bucket vẫn an toàn: RLS chặn client theo mặc định.', sqlerrm;
end $$;

-- 3) Kiểm tra RLS trên storage.objects (chỉ đọc, không ALTER).
do $$
declare rls_on boolean;
begin
  select relrowsecurity into rls_on from pg_class where oid = 'storage.objects'::regclass;
  if rls_on then
    raise notice 'RLS trên storage.objects: đã bật ✓ (mặc định của Supabase).';
  else
    raise notice 'CẢNH BÁO: storage.objects chưa bật RLS. Vui lòng bật trong Dashboard → Storage → Policies hoặc liên hệ hỗ trợ Supabase.';
  end if;
exception
  when others then
    raise notice 'Không kiểm tra được RLS: %', sqlerrm;
end $$;
