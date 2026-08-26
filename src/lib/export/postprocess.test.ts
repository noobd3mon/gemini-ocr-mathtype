import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import {
  forceTimesNewRomanRuns, ensureDocDefaultsFont, styleQuestionLabels, postprocessPandocDocx,
} from './postprocess';

const RFONTS = '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="Times New Roman" w:cs="Times New Roman"/>';

describe('forceTimesNewRomanRuns', () => {
  it('adds rPr with Times New Roman to plain text runs', () => {
    const xml = '<w:p><w:r><w:t>Hello</w:t></w:r></w:p>';
    expect(forceTimesNewRomanRuns(xml)).toContain(`<w:r><w:rPr>${RFONTS}</w:rPr><w:t>Hello</w:t></w:r>`);
  });

  it('injects font into existing rPr and replaces existing w:rFonts', () => {
    const xml = '<w:r><w:rPr><w:b/><w:rFonts w:ascii="Calibri"/></w:rPr><w:t>X</w:t></w:r>';
    const out = forceTimesNewRomanRuns(xml);
    expect(out).toContain(RFONTS);
    expect(out).not.toContain('Calibri');
    expect(out).toContain('<w:b/>');
  });

  it('does not touch non-text runs', () => {
    const xml = '<w:r><w:drawing><wp:inline/></w:drawing></w:r>';
    expect(forceTimesNewRomanRuns(xml)).toBe(xml);
  });
});

describe('ensureDocDefaultsFont', () => {
  it('adds docDefaults block when missing', () => {
    const out = ensureDocDefaultsFont('<w:styles><w:style w:type="paragraph"/></w:styles>');
    expect(out).toContain('<w:docDefaults><w:rPrDefault><w:rPr>');
    expect(out).toContain(RFONTS);
  });

  it('patches existing docDefaults rPr', () => {
    const out = ensureDocDefaultsFont('<w:styles><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>');
    expect(out).toContain(RFONTS);
    expect(out).not.toContain('Calibri');
  });
});

describe('styleQuestionLabels', () => {
  it('styles "Câu 1." blue+bold at paragraph start', () => {
    const xml = '<w:p><w:r><w:rPr><w:rFonts w:ascii="Times New Roman"/></w:rPr><w:t>Câu 1. Nội dung</w:t></w:r></w:p>';
    const out = styleQuestionLabels(xml);
    expect(out).toContain('<w:b/><w:bCs/>');
    expect(out).toContain('<w:color w:val="1D4ED8"/>');
    expect(out).toContain('>Câu 1.</w:t>');
    expect(out).toContain('> Nội dung</w:t>');
  });

  it('styles "a)" bold (not blue) and leaves other paragraphs alone', () => {
    const xml = '<w:p><w:r><w:t>a) Đáp án</w:t></w:r></w:p><w:p><w:r><w:t>Thường</w:t></w:r></w:p>';
    const out = styleQuestionLabels(xml);
    expect(out).toContain('<w:b/><w:bCs/>');
    expect(out).not.toContain('1D4ED8');
    expect(out).toContain('>Thường</w:t>');
  });
});

describe('postprocessPandocDocx', () => {
  it('patches document.xml and styles.xml of a real docx', async () => {
    const zip = new JSZip();
    zip.file('word/document.xml', '<w:document><w:body><w:p><w:r><w:t>Xin chào</w:t></w:r></w:p></w:body></w:document>');
    zip.file('word/styles.xml', '<w:styles><w:style w:type="paragraph"/></w:styles>');
    const blob = await zip.generateAsync({ type: 'blob' });
    const out = await postprocessPandocDocx(blob);
    expect(out.size).toBeGreaterThan(0);
    const outZip = await JSZip.loadAsync(await out.arrayBuffer());
    const docXml = await outZip.file('word/document.xml')!.async('string');
    const stylesXml = await outZip.file('word/styles.xml')!.async('string');
    expect(docXml).toContain(RFONTS);
    expect(stylesXml).toContain('<w:docDefaults>');
  });

  it('returns the original blob if the input is not a zip', async () => {
    const blob = new Blob(['not a docx'], { type: 'application/octet-stream' });
    const out = await postprocessPandocDocx(blob);
    expect(out).toBe(blob);
  });
});
