const RFONTS =
  '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="Times New Roman" w:cs="Times New Roman"/>';
const LABEL_BLUE = '1D4ED8';

export function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function xmlUnescape(s: string): string {
  return s.replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (ent) => {
    if (ent === '&amp;') return '&';
    if (ent === '&lt;') return '<';
    if (ent === '&gt;') return '>';
    if (ent === '&quot;') return '"';
    if (ent === '&apos;') return "'";
    const num = ent.startsWith('&#x') ? parseInt(ent.slice(3, -1), 16) : parseInt(ent.slice(2, -1), 10);
    return Number.isFinite(num) ? String.fromCodePoint(num) : ent;
  });
}

function patchRPrWithFonts(rPr: string): string {
  return /<w:rFonts\b/.test(rPr)
    ? rPr.replace(/<w:rFonts\b[^/]*(?:\/>|>[\s\S]*?<\/w:rFonts>)/, RFONTS)
    : rPr.replace(/<w:rPr>/, `<w:rPr>${RFONTS}`);
}

export function forceTimesNewRomanRuns(documentXml: string): string {
  return documentXml.replace(/<w:r>([\s\S]*?)<\/w:r>/g, (run, inner: string) => {
    if (!/<w:t\b/.test(inner)) return run;
    if (/<w:rPr>[\s\S]*?<\/w:rPr>/.test(inner)) {
      return `<w:r>${inner.replace(/<w:rPr>[\s\S]*?<\/w:rPr>/, (rPr) => patchRPrWithFonts(rPr))}</w:r>`;
    }
    return `<w:r><w:rPr>${RFONTS}</w:rPr>${inner}</w:r>`;
  });
}

export function ensureDocDefaultsFont(stylesXml: string): string {
  if (/<w:docDefaults>[\s\S]*?<\/w:docDefaults>/.test(stylesXml)) {
    return stylesXml.replace(/<w:docDefaults>[\s\S]*?<\/w:docDefaults>/, (block) => {
      if (/<w:rPrDefault>[\s\S]*?<\/w:rPrDefault>/.test(block)) {
        return block.replace(/<w:rPrDefault>[\s\S]*?<\/w:rPrDefault>/, (rpd) =>
          /<w:rPr>[\s\S]*?<\/w:rPr>/.test(rpd)
            ? rpd.replace(/<w:rPr>[\s\S]*?<\/w:rPr>/, (rPr) => patchRPrWithFonts(rPr))
            : rpd.replace(/<\/w:rPrDefault>/, `<w:rPr>${RFONTS}</w:rPr></w:rPrDefault>`),
        );
      }
      return block.replace(
        /<\/w:docDefaults>/,
        `<w:rPrDefault><w:rPr>${RFONTS}</w:rPr></w:rPrDefault></w:docDefaults>`,
      );
    });
  }
  return stylesXml.replace(
    /<w:styles([^>]*)>/,
    `<w:styles$1><w:docDefaults><w:rPrDefault><w:rPr>${RFONTS}</w:rPr></w:rPrDefault></w:docDefaults>`,
  );
}

interface LabelStyle {
  label: string;
  blue: boolean;
  bold: boolean;
}

function detectLabel(paragraphText: string): LabelStyle | null {
  const t = paragraphText.replace(/^\s+/, '');
  let m = t.match(/^((?:Câu|Bài)\s+\d+\s*[.:])/i);
  if (m) return { label: m[1], blue: true, bold: true };
  m = t.match(/^([A-D]\.)\s*/u);
  if (m) return { label: m[1], blue: true, bold: true };
  m = t.match(/^([a-d]\))\s*/u);
  if (m) return { label: m[1], blue: false, bold: true };
  return null;
}

function paragraphText(xml: string): string {
  let text = '';
  xml.replace(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g, (full, t: string) => {
    text += xmlUnescape(t);
    return full;
  });
  return text;
}

function buildStyledRun(text: string, style: { bold: boolean; blue: boolean }): string {
  const rPr = `${style.bold ? '<w:b/><w:bCs/>' : ''}${style.blue ? `<w:color w:val="${LABEL_BLUE}"/>` : ''}`;
  const space = /^\s|\s$/.test(text) ? ' xml:space="preserve"' : '';
  return `<w:r><w:rPr>${rPr}</w:rPr><w:t${space}>${xmlEscape(text)}</w:t></w:r>`;
}

export function styleQuestionLabels(documentXml: string): string {
  return documentXml.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, (para) => {
    const label = detectLabel(paragraphText(para));
    if (!label) return para;
    let used = false;
    return para.replace(/<w:r>([\s\S]*?)<\/w:r>/g, (run, inner: string) => {
      if (used || !/<w:t\b/.test(inner)) return run;
      const m = inner.match(/<w:t([^>]*)>([\s\S]*?)<\/w:t>/);
      if (!m) return run;
      const raw = xmlUnescape(m[2]);
      const lead = raw.match(/^\s*/)?.[0] ?? '';
      const rest = raw.slice(lead.length);
      if (!rest.startsWith(label.label)) return run;
      used = true;
      const after = rest.slice(label.label.length);
      const runs: string[] = [];
      if (lead) runs.push(buildStyledRun(lead, { bold: false, blue: false }));
      runs.push(buildStyledRun(label.label, { bold: label.bold, blue: label.blue }));
      if (after) runs.push(buildStyledRun(after, { bold: false, blue: false }));
      return runs.join('');
    });
  });
}

export async function postprocessPandocDocx(blob: Blob): Promise<Blob> {
  try {
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const doc = zip.file('word/document.xml');
    if (doc) {
      let xml = await doc.async('string');
      xml = forceTimesNewRomanRuns(xml);
      xml = styleQuestionLabels(xml);
      zip.file('word/document.xml', xml);
    }
    const styles = zip.file('word/styles.xml');
    if (styles) {
      zip.file('word/styles.xml', ensureDocDefaultsFont(await styles.async('string')));
    }
    return await zip.generateAsync({ type: 'blob' });
  } catch {
    return blob;
  }
}
