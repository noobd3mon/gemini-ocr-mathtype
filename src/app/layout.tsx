import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AIOMT OCR PDF/Image',
  description: 'OCR tài liệu Toán và bảng biểu → Word, giữ công thức và hình minh họa',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
