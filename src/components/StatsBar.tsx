'use client';

interface Props {
  characters: number;
  pages: number;
  formulas: number;
  images: number;
}

export function StatsBar({ characters, pages, formulas, images }: Props) {
  const fmt = (n: number) => n.toLocaleString('vi-VN');
  return (
    <div className="stats-bar">
      <span title="Kí tự"><b>{fmt(characters)}</b> kí tự</span>
      <span title="Trang"><b>{fmt(pages)}</b> trang</span>
      <span title="Công thức"><b>{fmt(formulas)}</b> công thức</span>
      <span title="Ảnh"><b>{fmt(images)}</b> ảnh</span>
    </div>
  );
}
