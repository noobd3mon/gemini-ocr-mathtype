// Mock Supabase Storage cho chạy local KHÔNG cần Supabase thật.
// Triển khai đúng các REST endpoint mà supabase-js (v2) gọi:
//   POST   /storage/v1/object/{bucket}/{path}            — upload (multipart Blob hoặc raw)
//   GET    /storage/v1/object/{bucket}/{path}            — download
//   POST   /storage/v1/object/sign/{bucket}/{path}       — createSignedUrl  (response: { signedURL })
//   POST   /storage/v1/object/sign/{bucket}              — createSignedUrls (response: [{ signedURL }])
//   GET    /storage/v1/object/sign/{bucket}/{path}?token — tải qua signed URL
//   POST   /storage/v1/object/list/{bucket}              — list (response: [{ name, updated_at }])
//   DELETE /storage/v1/object/{bucket}                   — remove (body: { prefixes })
// Chạy: node scripts/mock-supabase.mjs   (mặc định cổng 3961)
import http from 'node:http';

const PORT = Number(process.env.PORT || 3961);
const objects = new Map(); // `${bucket}/${path}` -> { bytes, contentType, updated_at }

function send(res, status, body, type = 'application/json') {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  res.writeHead(status, { 'Content-Type': type, 'Content-Length': buf.length });
  res.end(buf);
}

/** Parse multipart từ raw Node request bằng Fetch API (Request.formData). */
async function readFormData(req, url) {
  const request = new Request(url, {
    method: req.method,
    headers: req.headers,
    body: req,
    duplex: 'half',
  });
  return request.formData();
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const p = decodeURIComponent(url.pathname);
  try {
    // --- signed download ---
    if (req.method === 'GET' && p.startsWith('/storage/v1/object/sign/')) {
      const key = p.replace('/storage/v1/object/sign/', '');
      const obj = objects.get(key);
      if (!obj) return send(res, 404, { statusCode: '404', message: 'Not found' });
      return send(res, 200, obj.bytes, obj.contentType || 'application/octet-stream');
    }

    // --- raw download ---
    if (req.method === 'GET' && p.startsWith('/storage/v1/object/')) {
      const key = p.replace('/storage/v1/object/', '');
      const obj = objects.get(key);
      if (!obj) return send(res, 404, { statusCode: '404', message: 'Object not found' });
      return send(res, 200, obj.bytes, obj.contentType || 'application/octet-stream');
    }

    // --- sign (batch: bucket only) ---
    if (req.method === 'POST' && /^\/storage\/v1\/object\/sign\/[^/]+$/.test(p)) {
      const bucket = p.split('/').pop();
      const body = JSON.parse((await readBody(req)).toString() || '{}');
      const paths = Array.isArray(body.paths) ? body.paths : [];
      const data = paths.map((path) => ({
        error: null,
        id: null,
        path,
        signedURL: `/object/sign/${bucket}/${path}?token=mock-token`,
      }));
      return send(res, 200, JSON.stringify(data));
    }

    // --- sign (single: bucket/path) ---
    if (req.method === 'POST' && p.startsWith('/storage/v1/object/sign/')) {
      const key = p.replace('/storage/v1/object/sign/', '');
      return send(res, 200, JSON.stringify({ signedURL: `/object/sign/${key}?token=mock-token` }));
    }

    // --- list ---
    if (req.method === 'POST' && p.startsWith('/storage/v1/object/list/')) {
      const bucket = p.split('/').pop();
      const body = JSON.parse((await readBody(req)).toString() || '{}');
      let prefix = String(body.prefix ?? '');
      if (prefix && !prefix.endsWith('/')) prefix += '/'; // list('folder') liệt kê nội dung folder
      const seen = new Set();
      const items = [];
      for (const [key, obj] of objects) {
        if (!key.startsWith(`${bucket}/`)) continue;
        const rest = key.slice(bucket.length + 1);
        if (prefix && !rest.startsWith(prefix)) continue;
        const rel = rest.slice(prefix ? prefix.length : 0);
        const first = rel.split('/')[0];
        if (!first) continue;
        if (rel.includes('/')) {
          if (!seen.has(first)) { seen.add(first); items.push({ name: first, id: null, updated_at: obj.updated_at }); }
        } else {
          items.push({ name: first, id: `mock-${key}`, updated_at: obj.updated_at });
        }
      }
      return send(res, 200, JSON.stringify(items));
    }

    // --- remove ---
    if (req.method === 'DELETE' && p.startsWith('/storage/v1/object/')) {
      const bucket = p.replace('/storage/v1/object/', '');
      const body = JSON.parse((await readBody(req)).toString() || '{}');
      for (const prefix of body.prefixes ?? []) objects.delete(`${bucket}/${prefix}`);
      return send(res, 200, JSON.stringify({ message: 'success' }));
    }

    // --- upload (multipart Blob hoặc raw string/bytes) ---
    if (req.method === 'POST' && p.startsWith('/storage/v1/object/')) {
      const key = p.replace('/storage/v1/object/', '');
      const ctype = req.headers['content-type'] ?? '';
      let bytes; let contentType = ctype;
      if (ctype.includes('multipart/form-data')) {
        const form = await readFormData(req, url); // Fetch API parse multipart
        const file = form.get('') ?? [...form.values()].find((v) => typeof v === 'object');
        bytes = Buffer.from(await file.arrayBuffer());
        contentType = file.type || 'application/octet-stream';
      } else {
        bytes = await readBody(req);
        if (!ctype) contentType = 'application/octet-stream';
      }
      objects.set(key, { bytes, contentType, updated_at: new Date().toISOString() });
      return send(res, 200, JSON.stringify({ Key: key }));
    }

    if (req.method === 'GET' && p === '/storage/v1/bucket') {
      return send(res, 200, JSON.stringify([{ id: 'temp-images' }, { id: 'word-exports' }, { id: 'ocr-jobs' }]));
    }

    return send(res, 404, { message: `Mock chưa hỗ trợ: ${req.method} ${p}` });
  } catch (err) {
    console.error('[mock]', req.method, p, err.message);
    return send(res, 500, { message: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`[mock-supabase] chạy tại http://localhost:${PORT} — set SUPABASE_URL=http://localhost:${PORT}`);
});
