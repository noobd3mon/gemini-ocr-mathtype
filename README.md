# OCR PDF → Word

OCR tài liệu PDF sang Markdown (Gemini hoặc OpenAI-compatible), cắt ảnh hình/khung, xuất Word với công thức OMML (Pandoc) hoặc MathType OLE. File Word lưu trên Supabase 3 ngày.

> 📘 **Hướng dẫn cài đặt & sử dụng từ A đến Z:** mở file [`HUONG-DAN.html`](./HUONG-DAN.html) (mở trực tiếp bằng trình duyệt) — gồm setup Supabase, deploy Vercel, chạy local, cách dùng, bảng biến môi trường và xử lý sự cố.

## Stack
- Next.js 15 (App Router) + React 19 + TypeScript
- **Máy chủ Pandoc tích hợp sẵn** — chạy Pandoc binary ngay trong Vercel Function (`/api/pandoc`), **không giới hạn 1 triệu ký tự**, không phụ thuộc server Render bên ngoài (lần build đầu tự tải Pandoc ~40MB qua `npm run prebuild`)
- Supabase Storage (private buckets, signed URLs)
- pdfjs-dist (render PDF → ảnh), JSZip (post-process docx), KaTeX (preview)
- MathType Server (OLE) — dịch vụ ngoài; ảnh gửi dạng base64 (server này không tải ảnh từ URL)

## Setup

### 1. Supabase
1. Tạo project tại supabase.com.
2. SQL Editor → chạy `supabase/setup.sql` (tạo 2 private bucket + RLS deny-all).
3. Settings → API: lấy **Project URL** và **service_role** key.

### 2. Vercel
1. Import repo → Vercel.
2. Environment Variables:
   - `SUPABASE_URL` = Project URL
   - `SUPABASE_SERVICE_ROLE_KEY` = service_role key
   - `CRON_SECRET` = chuỗi ngẫu nhiên bất kỳ (bảo vệ `/api/cleanup`)
   - `PANDOC_URL` (tùy chọn) = `https://pandoc-server.onrender.com/convert`
   - `MATHTYPE_URL` (tùy chọn) = `https://latex2mathtypeweb.onrender.com`
3. Deploy. Cron dọn dẹp chạy mỗi ngày 03:00.

### 3. Chạy local
```bash
npm install
cp .env.example .env.local   # điền Supabase + CRON_SECRET
npm run dev
```

## Cách dùng
1. Chọn provider (Gemini hoặc OpenAI), dán API keys (mỗi dòng một key — tự rotate khi rate-limit; Gemini tự lùi model `3.7-flash → 3.6-flash → 3.5-flash` khi mọi key hết hạn mức).
2. Kéo thả PDF → "Chạy OCR".
3. Sửa Markdown nếu cần → xem trước KaTeX.
4. "Xuất Word (Equation)": chạy trên máy chủ Pandoc tích hợp — ảnh cắt được upload lên Supabase dạng signed URL, file Word hoàn chỉnh (đã ép font + style nhãn câu) lưu thẳng vào server 3 ngày. Nếu máy chủ tích hợp lỗi sẽ tự fallback sang server Pandoc ngoài (giới hạn 1 triệu ký tự).
   "Xuất Word (MathType)": server MathType ngoài; file lớn được upload lên server theo từng phần (chunk) để né giới hạn 4.5MB request.

## Giới hạn & hoạt động
- **Gemini**: gửi cả file PDF trong 1 request — giới hạn ~14MB (đủ cho phần lớn tài liệu; file lớn hơn sẽ báo lỗi, hãy tách hoặc dùng chế độ OpenAI).
- **OpenAI**: các trang được render thành ảnh rồi gửi theo **nhóm 4 trang/request** (prompt tự gắn số trang thật cho từng nhóm) để không vượt giới hạn body; kết quả các nhóm được ghép lại.
- **Ảnh hình**: cắt từ trang đã render, nền trắng, chèn dạng base64 vào Markdown trước khi convert (đã kiểm chứng cả Pandoc và MathType server nhận data-URI).
- **Bảo mật**: các API `/api/jobs*` không yêu cầu đăng nhập (công cụ cá nhân) — ai biết URL cũng tạo job được, nhưng chỉ đọc được file qua signed URL có hạn 3 ngày. Chạy Supabase free tier thì dung lượng bị giới hạn bởi quota của bạn.
- **Cron dọn dẹp**: Vercel gọi `GET /api/cleanup` lúc 03:00 UTC hằng ngày, tự kèm `Authorization: Bearer <CRON_SECRET>`.

## Lưu trữ
- `temp-images/`: ảnh cắt tạm, xóa sau khi xuất.
- `word-exports/`: file Word, signed URL hết hạn sau 3 ngày, cron xóa file cũ.
