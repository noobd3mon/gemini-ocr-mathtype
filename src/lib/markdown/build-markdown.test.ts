import { describe, it, expect } from 'vitest';
import { buildExportMarkdown, markerKey } from './build-markdown';
import { parseImageMarkers } from './markers';

describe('buildExportMarkdown', () => {
  const md = 'Trước.\n\n[[IMAGE:1,200,120,700,650|Đồ thị]]\n\nSau.\n';
  const url = 'data:image/png;base64,AAAA';

  it('replaces markers having an image with markdown image syntax', () => {
    const marker = parseImageMarkers(md)[0];
    const out = buildExportMarkdown(md, new Map([[markerKey(marker), url]]));
    expect(out).toContain(`![Đồ thị](${url})`);
    expect(out).not.toContain('[[IMAGE:');
  });

  it('accepts raw marker text as map key too', () => {
    const marker = parseImageMarkers(md)[0];
    const out = buildExportMarkdown(md, new Map([[marker.raw, url]]));
    expect(out).toContain(`![Đồ thị](${url})`);
  });

  it('leaves markers without images untouched', () => {
    const out = buildExportMarkdown(md, new Map());
    expect(out).toBe(md);
  });

  it('uses a fallback alt text when caption is empty', () => {
    const md2 = '[[IMAGE:2,10,20,30,40]]';
    const marker = parseImageMarkers(md2)[0];
    const out = buildExportMarkdown(md2, new Map([[markerKey(marker), url]]));
    expect(out).toBe('![hình](data:image/png;base64,AAAA)');
  });

  it('sanitizes brackets and newlines in alt text', () => {
    // A parsed caption can contain "[" and newlines ("]" always terminates the marker).
    const md2 = '[[IMAGE:1,10,20,30,40|Đồ thị [1\nmới]]';
    const marker = parseImageMarkers(md2)[0];
    expect(marker).toBeDefined();
    const out = buildExportMarkdown(md2, new Map([[markerKey(marker), url]]));
    expect(out).toBe(`![Đồ thị 1 mới](${url})`);
  });
});
