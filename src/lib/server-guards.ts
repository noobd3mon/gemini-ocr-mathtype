// Shared server-side guards for job routes.

export function isValidJobId(jobId: string): boolean {
  return /^[A-Za-z0-9_-]{1,80}$/.test(jobId);
}

export function sanitizeServerFileName(name: string): string {
  const cleaned = (name || '')
    .replace(/[\\/]/g, '_')
    .replace(/\.{2,}/g, '_')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f]/g, '')
    .trim()
    .slice(0, 120);
  const base = cleaned || 'export.docx';
  return /\.docx$/i.test(base) ? base : `${base}.docx`;
}

/**
 * Header cho các call nội bộ server→server (start→step, self-heal kick).
 * Khi Vercel Deployment Protection bật, call nội bộ bị 401 — nếu user cấu hình
 * Deployment Protection Bypass Secret, đặt vào env VERCEL_PROTECTION_BYPASS.
 */
export function internalFetchHeaders(): Record<string, string> {
  const bypass = process.env.VERCEL_PROTECTION_BYPASS?.trim();
  return bypass ? { 'x-vercel-protection-bypass': bypass } : {};
}
