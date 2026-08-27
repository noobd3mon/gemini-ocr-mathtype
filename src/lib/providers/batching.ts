export interface BatchRange {
  from: number;
  to: number;
}

/** Chia `total` trang (bắt đầu đánh số `startPage`) thành các nhóm tối đa `per` trang. */
export function batchRanges(total: number, per: number, startPage = 1): BatchRange[] {
  const ranges: BatchRange[] = [];
  for (let offset = 0; offset < total; offset += per) {
    const from = startPage + offset;
    ranges.push({ from, to: from + Math.min(per, total - offset) - 1 });
  }
  return ranges;
}
