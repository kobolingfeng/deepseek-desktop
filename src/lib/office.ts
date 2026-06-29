// Office document skills. fs is text-only, so binary OOXML files go through a
// PowerShell base64 bridge (same pattern as voice.ts). Excel uses SheetJS;
// Word/PowerPoint text is extracted by unzipping the OOXML in PowerShell.
import * as XLSX from 'xlsx';
import { fs, path, shell } from '../api';

function psQuote(p: string): string {
  return "'" + String(p).replace(/'/g, "''") + "'";
}

let tempSeq = 0;
async function tempPath(ext: string): Promise<string> {
  const dir = await path.temp();
  // Process-unique counter + random so staged temp files can't collide between concurrent ops.
  return dir.replace(/[\\/]+$/, '') + '\\dsoffice_' + (tempSeq++).toString(36) + '_' + Math.random().toString(36).slice(2) + ext;
}

/** Read a binary file as base64 (staged through a temp file to dodge stdout limits). */
export async function readBytesBase64(p: string): Promise<string> {
  const tmp = await tempPath('.b64');
  try {
    const ps = `[IO.File]::WriteAllText(${psQuote(tmp)}, [Convert]::ToBase64String([IO.File]::ReadAllBytes(${psQuote(p)})))`;
    const r = await shell.run('powershell', ['-NoProfile', '-Command', ps]);
    if (r.exitCode !== 0) throw new Error((r.stderr || 'failed to read file').trim());
    return (await fs.readTextFile(tmp)).replace(/\s+/g, '');
  } finally {
    fs.remove(tmp).catch(() => {});
  }
}

/** Write base64 bytes to a binary file (base64 staged in a temp text file). */
export async function writeBytesBase64(p: string, b64: string): Promise<void> {
  const tmp = await tempPath('.b64');
  await fs.writeTextFile(tmp, b64);
  const ps = `[IO.File]::WriteAllBytes(${psQuote(p)}, [Convert]::FromBase64String([IO.File]::ReadAllText(${psQuote(tmp)})))`;
  try {
    const r = await shell.run('powershell', ['-NoProfile', '-Command', ps]);
    if (r.exitCode !== 0) throw new Error((r.stderr || 'failed to write file').trim());
  } finally {
    fs.remove(tmp).catch(() => {});
  }
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, '&');
}

async function readExcel(p: string): Promise<string> {
  const b64 = await readBytesBase64(p);
  const wb = XLSX.read(b64, { type: 'base64' });
  const parts: string[] = [];
  for (const name of wb.SheetNames) {
    const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name], { blankrows: false }).trim();
    parts.push(`# Sheet: ${name}\n${csv || '(empty)'}`);
  }
  return parts.join('\n\n') || '(empty workbook)';
}

/** A cell is a formula when it's `{ formula: "SUM(A1:A2)" }` or a string starting with "=". */
function isFormulaCell(c: unknown): boolean {
  return (
    (!!c && typeof c === 'object' && typeof (c as { formula?: unknown }).formula === 'string') ||
    (typeof c === 'string' && c.startsWith('=') && c.length > 1)
  );
}
function formulaOf(c: unknown): string {
  return typeof c === 'object' ? (c as { formula: string }).formula : (c as string).slice(1);
}

export async function writeExcel(p: string, sheets: { name?: string; rows: unknown[][] }[]): Promise<number> {
  const wb = XLSX.utils.book_new();
  let rows = 0;
  sheets.forEach((s, i) => {
    const src = Array.isArray(s.rows) ? s.rows : [];
    // Build the sheet from literal values (formula cells held as null), then overwrite
    // each formula cell with a real SheetJS formula cell ({ t:'n', f:'…' }).
    const plain = src.map((r) => (Array.isArray(r) ? r.map((c) => (isFormulaCell(c) ? null : c)) : r));
    const ws = XLSX.utils.aoa_to_sheet(plain as unknown[][]);
    src.forEach((r, ri) => {
      if (!Array.isArray(r)) return;
      r.forEach((c, ci) => {
        if (isFormulaCell(c)) ws[XLSX.utils.encode_cell({ r: ri, c: ci })] = { t: 'n', f: formulaOf(c) };
      });
    });
    const nm = (s.name || `Sheet${i + 1}`).replace(/[\\/?*[\]:]/g, '').slice(0, 31) || `Sheet${i + 1}`;
    XLSX.utils.book_append_sheet(wb, ws, nm);
    rows += src.length;
  });
  if (!wb.SheetNames.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[]]), 'Sheet1');
  const b64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
  await writeBytesBase64(p, b64);
  return rows;
}

export type DocBlock =
  | { type: 'heading'; text: string; level?: number }
  | { type: 'paragraph'; text: string }
  | { type: 'bullets'; items: string[] };

/** Create a .docx from structured blocks (headings / paragraphs / bullet lists). */
export async function writeWord(p: string, blocks: DocBlock[]): Promise<number> {
  const { Document, Packer, Paragraph, HeadingLevel, TextRun } = await import('docx');
  const levels = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4];
  const children: InstanceType<typeof Paragraph>[] = [];
  for (const b of blocks || []) {
    if (b.type === 'heading') {
      children.push(new Paragraph({ text: b.text || '', heading: levels[Math.min(Math.max((b.level || 1) - 1, 0), 3)] }));
    } else if (b.type === 'bullets') {
      for (const it of b.items || []) children.push(new Paragraph({ text: String(it), bullet: { level: 0 } }));
    } else {
      children.push(new Paragraph({ children: [new TextRun(b.text || '')] }));
    }
  }
  if (!children.length) children.push(new Paragraph({ children: [new TextRun('')] }));
  const doc = new Document({ sections: [{ children }] });
  await writeBytesBase64(p, await Packer.toBase64String(doc));
  return (blocks || []).length;
}

/** Create a .pptx from a list of slides (title + bullets or body text). */
export async function writePptx(
  p: string,
  slides: { title?: string; bullets?: string[]; text?: string }[],
): Promise<number> {
  const pptxgen = (await import('pptxgenjs')).default;
  const pptx = new pptxgen();
  pptx.layout = 'LAYOUT_WIDE';
  let count = 0;
  for (const s of slides || []) {
    const slide = pptx.addSlide();
    count++;
    if (s.title) slide.addText(String(s.title), { x: 0.5, y: 0.3, w: 12.3, h: 1, fontSize: 30, bold: true });
    const body = (s.bullets || []).length
      ? (s.bullets as string[]).map((t) => ({ text: String(t), options: { bullet: true, breakLine: true } }))
      : s.text
        ? [{ text: String(s.text), options: {} }]
        : [];
    if (body.length) slide.addText(body as any, { x: 0.6, y: 1.6, w: 12.1, h: 5.5, fontSize: 18, valign: 'top' });
  }
  if (!count) pptx.addSlide();
  await writeBytesBase64(p, (await pptx.write({ outputType: 'base64' })) as string);
  return count;
}

// PowerPoint Morph transition (2016+), with a Fallback fade for older clients. Injected
// into each slide so advancing it smoothly morphs same-named objects from the prior slide.
const MORPH_XML =
  '<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006">' +
  '<mc:Choice xmlns:p159="http://schemas.microsoft.com/office/powerpoint/2015/09/main" Requires="p159">' +
  '<p:transition xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main" spd="slow" p14:dur="1200">' +
  '<p159:morph option="byObject"/></p:transition></mc:Choice>' +
  '<mc:Fallback><p:transition spd="slow"><p:fade/></p:transition></mc:Fallback></mc:AlternateContent>';

export type MorphItem = {
  /** Stable identity across frames — same name on consecutive frames → it morphs. */
  name?: string;
  text?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  fontSize?: number;
  bold?: boolean;
  color?: string;
  fill?: string;
  align?: 'left' | 'center' | 'right';
};

/** Create a Morph-animated .pptx. Each frame is a set of positioned items; items that share
 *  a `name` across consecutive frames smoothly morph (move/resize/recolor) when PowerPoint
 *  advances slides. Pure front-end: pptxgenjs builds the frames, then a real PowerPoint Morph
 *  transition is injected into every slide after the first (no external engine). */
export async function writeMorphPptx(p: string, frames: { items?: MorphItem[] }[]): Promise<number> {
  const pptxgen = (await import('pptxgenjs')).default;
  const JSZip = (await import('jszip')).default;
  const pptx = new pptxgen();
  pptx.layout = 'LAYOUT_WIDE';
  let count = 0;
  for (const frame of frames || []) {
    const slide = pptx.addSlide();
    count++;
    for (const it of frame.items || []) {
      const opts: Record<string, unknown> = {
        objectName: it.name || undefined,
        x: typeof it.x === 'number' ? it.x : 1,
        y: typeof it.y === 'number' ? it.y : 1,
        w: typeof it.w === 'number' ? it.w : 4,
        h: typeof it.h === 'number' ? it.h : 1.2,
        fontSize: it.fontSize || 24,
        bold: !!it.bold,
        align: it.align || 'center',
        valign: 'middle',
        color: it.color ? String(it.color).replace(/^#/, '') : undefined,
      };
      if (it.fill) opts.fill = { color: String(it.fill).replace(/^#/, '') };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      slide.addText(String(it.text ?? ''), opts as any);
    }
  }
  if (!count) pptx.addSlide();
  let b64 = (await pptx.write({ outputType: 'base64' })) as string;
  // Inject the Morph transition into slides 2..N (the first frame has no incoming transition).
  const zip = await JSZip.loadAsync(b64, { base64: true });
  const slideXmls = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => slideNo(a) - slideNo(b));
  for (let i = 1; i < slideXmls.length; i++) {
    const f = zip.file(slideXmls[i]);
    if (!f) continue;
    let xml = await f.async('string');
    if (!xml.includes('p159:morph')) {
      // Insert the transition after clrMapOvr (correct schema order); fall back to just before
      // </p:sld> if pptxgenjs changed the shape — and throw rather than silently ship no Morph.
      let injected = xml.replace('</p:clrMapOvr></p:sld>', `</p:clrMapOvr>${MORPH_XML}</p:sld>`);
      if (injected === xml) injected = xml.replace('</p:sld>', `${MORPH_XML}</p:sld>`);
      if (injected === xml) throw new Error('writeMorphPptx: could not inject the Morph transition into ' + slideXmls[i]);
      xml = injected;
    }
    zip.file(slideXmls[i], xml);
  }
  b64 = await zip.generateAsync({ type: 'base64' });
  await writeBytesBase64(p, b64);
  return count;
}

/** Pull selected entries' raw XML out of an OOXML (zip) file, in order. */
async function unzipEntries(file: string, likeGlob: string): Promise<{ name: string; xml: string }[]> {
  const ps = [
    '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;',
    'Add-Type -AssemblyName System.IO.Compression.FileSystem;',
    `$zip=[IO.Compression.ZipFile]::OpenRead(${psQuote(file)});`,
    `$es=$zip.Entries | Where-Object { ($_.FullName -replace '\\\\','/') -like ${psQuote(likeGlob)} } | Sort-Object FullName;`,
    // Skip any entry whose UNCOMPRESSED size is huge (zip-bomb defense — the file-size cap can't
    // see expansion). 64 MB/entry is far above any real OOXML part.
    `$o=foreach($e in $es){ if($e.Length -gt 67108864){ continue }; $sr=New-Object IO.StreamReader($e.Open()); $t=$sr.ReadToEnd(); $sr.Close(); "<<<E:"+($e.FullName -replace '\\\\','/')+">>>"+$t };`,
    '$zip.Dispose();',
    '[Console]::Out.Write(($o -join ""))',
  ].join(' ');
  const r = await shell.run('powershell', ['-NoProfile', '-Command', ps]);
  if (r.exitCode !== 0) throw new Error((r.stderr || 'failed to open document').trim());
  const raw = r.stdout || '';
  const out: { name: string; xml: string }[] = [];
  const re = /<<<E:(.*?)>>>/g;
  let m: RegExpExecArray | null;
  let last: { name: string; idx: number } | null = null;
  while ((m = re.exec(raw))) {
    if (last) out.push({ name: last.name, xml: raw.slice(last.idx, m.index) });
    last = { name: m[1], idx: re.lastIndex };
  }
  if (last) out.push({ name: last.name, xml: raw.slice(last.idx) });
  return out;
}

async function readDocx(p: string): Promise<string> {
  const entries = await unzipEntries(p, 'word/document.xml');
  const xml = entries.map((e) => e.xml).join('');
  const paras = xml.split(/<\/w:p>/).map((para) => {
    // Walk text runs, tabs and breaks in document order.
    let s = '';
    const re = /<w:t[^>]*>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/?>|<w:br\b[^>]*\/?>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(para))) {
      if (m[1] !== undefined) s += decodeXml(m[1]);
      else if (m[0].startsWith('<w:tab')) s += '\t';
      else s += '\n';
    }
    return s;
  });
  return paras.join('\n').replace(/\n{3,}/g, '\n\n').trim() || '(no text found)';
}

async function readPptx(p: string): Promise<string> {
  const entries = (await unzipEntries(p, 'ppt/slides/slide*.xml'))
    .filter((e) => /slide\d+\.xml$/.test(e.name))
    .sort((a, b) => slideNo(a.name) - slideNo(b.name));
  const out = entries.map((s, i) => {
    const txt = [...s.xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => decodeXml(m[1])).join('\n').trim();
    return `# Slide ${i + 1}\n${txt || '(no text)'}`;
  });
  return out.join('\n\n') || '(no slides found)';
}

function slideNo(name: string): number {
  const m = name.match(/slide(\d+)\.xml$/);
  return m ? parseInt(m[1], 10) : 0;
}

export async function readOffice(p: string): Promise<string> {
  const ext = (p.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
  if (['xlsx', 'xlsm', 'xls', 'csv'].includes(ext)) return readExcel(p);
  if (ext === 'docx') return readDocx(p);
  if (ext === 'pptx') return readPptx(p);
  throw new Error(`Unsupported file type: .${ext} (supported: xlsx, xlsm, xls, csv, docx, pptx)`);
}

export function isOfficeFile(p: string): boolean {
  return /\.(xlsx|xlsm|xls|csv|docx|pptx)$/i.test(p || '');
}

const IMG_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'svg', 'avif'];
const TEXT_EXT = [
  'txt', 'log', 'json', 'jsonc', 'xml', 'yaml', 'yml', 'ini', 'toml', 'env', 'conf',
  'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'rb', 'go', 'rs', 'c', 'cc', 'cpp', 'h', 'hpp',
  'java', 'cs', 'php', 'sh', 'bash', 'bat', 'ps1', 'css', 'scss', 'less', 'sql',
];

/** What the in-app preview can render for a local file (beyond web URLs). */
export function previewKind(p: string): 'office' | 'image' | 'html' | 'md' | 'text' | '' {
  const ext = (String(p).match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
  if (['xlsx', 'xlsm', 'xls', 'csv', 'docx', 'pptx'].includes(ext)) return 'office';
  if (IMG_EXT.includes(ext)) return 'image';
  if (ext === 'html' || ext === 'htm') return 'html';
  if (ext === 'md' || ext === 'markdown') return 'md';
  if (TEXT_EXT.includes(ext)) return 'text';
  return '';
}
export function isPreviewableFile(p: string): boolean {
  return previewKind(p) !== '';
}

function escHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
}

/** Render an Office file as preview HTML: real tables for spreadsheets, readable text
 *  (per slide for .pptx) for documents/decks. */
export async function officePreviewHtml(p: string): Promise<string> {
  const ext = (p.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
  // Cap up front so a huge (possibly untrusted) workbook/doc/image can't freeze the WebView in
  // SheetJS/mammoth or a giant base64 data-URL. (Text gets a tighter cap in its own branch.)
  {
    const st = await fs.stat(p).catch(() => null);
    if (st && st.size > 25e6) return `<div class="o-empty">(file too large to preview — ${(st.size / 1e6).toFixed(1)} MB)</div>`;
  }
  if (['xlsx', 'xlsm', 'xls', 'csv'].includes(ext)) {
    const b64 = await readBytesBase64(p);
    const wb = XLSX.read(b64, { type: 'base64' });
    const names = wb.SheetNames;
    const tableFor = (n: string) => XLSX.utils.sheet_to_html(wb.Sheets[n], { editable: false });
    if (names.length <= 1) {
      const n = names[0];
      return n ? `<h3 class="o-sheet">${escHtml(n)}</h3>${tableFor(n)}` : '<div class="o-empty">(empty workbook)</div>';
    }
    // Multiple sheets → CSS-only tabbed view (radios, no scripts → works in the sandboxed
    // iframe). The :checked rules are per-sheet, so emit them inline alongside the markup.
    const rules = names
      .map(
        (_, i) =>
          `#os${i}:checked~.o-tabs label[for=os${i}]{background:#fff;color:#1a1a1a;border-color:#d4d4d4 #d4d4d4 #fff;}` +
          `#os${i}:checked~.o-panels .o-panel:nth-child(${i + 1}){display:block;}`,
      )
      .join('');
    const radios = names
      .map((_, i) => `<input type="radio" class="o-tabr" name="osheet" id="os${i}"${i === 0 ? ' checked' : ''}>`)
      .join('');
    const labels = names.map((n, i) => `<label for="os${i}">${escHtml(n)}</label>`).join('');
    const panels = names.map((n) => `<div class="o-panel">${tableFor(n)}</div>`).join('');
    return `<style>${rules}</style><div class="o-xlsx">${radios}<div class="o-tabs">${labels}</div><div class="o-panels">${panels}</div></div>`;
  }

  if (ext === 'docx') {
    // Real layout (headings, bold, lists, tables) via mammoth — far better than plain text.
    const b64 = await readBytesBase64(p);
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const m = (await import('mammoth')) as unknown as {
      convertToHtml?: (o: { arrayBuffer: ArrayBuffer }) => Promise<{ value: string }>;
      default?: { convertToHtml: (o: { arrayBuffer: ArrayBuffer }) => Promise<{ value: string }> };
    };
    const mammoth = m.convertToHtml ? m : m.default!;
    const result = await mammoth.convertToHtml!({ arrayBuffer: bytes.buffer });
    return `<div class="o-doc">${result.value || '<p>(empty document)</p>'}</div>`;
  }

  if (IMG_EXT.includes(ext)) {
    const st = await fs.stat(p).catch(() => null);
    if (st && st.size > 25e6)
      return `<div class="o-empty">(image too large to preview — ${(st.size / 1e6).toFixed(1)} MB)</div>`;
    const b64 = await readBytesBase64(p);
    const mime =
      ext === 'svg' ? 'image/svg+xml' : ext === 'jpg' ? 'image/jpeg' : ext === 'ico' ? 'image/x-icon' : `image/${ext}`;
    return `<div class="o-imgwrap"><img class="o-img" src="data:${mime};base64,${b64}" alt=""></div>`;
  }

  if (TEXT_EXT.includes(ext)) {
    const st = await fs.stat(p).catch(() => null);
    if (st && st.size > 5e6)
      return `<div class="o-empty">(file too large to preview — ${(st.size / 1e6).toFixed(1)} MB)</div>`;
    const t = await fs.readTextFile(p);
    return `<pre class="o-text">${escHtml(t)}</pre>`;
  }

  const text = await readOffice(p);
  if (ext === 'pptx') {
    // readPptx output is "# Slide N\n<lines>". Show ONE slide at a time at full 16:9 with a page
    // pager — not a vertical stack of squished slides. Pure CSS (radios) so it works in the
    // sandboxed (script-less) preview iframe.
    const slides = text.split(/\n(?=# Slide )/).filter((s) => s.trim());
    const n = slides.length;
    const card = (s: string, i: number) => {
      const lines = s
        .replace(/^# Slide \d+\n?/, '')
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      const title = lines[0] || '';
      const rest = lines.slice(1);
      return (
        `<div class="o-slide"><span class="o-slide-no">${i + 1} / ${n}</span>` +
        (title ? `<div class="o-slide-title">${escHtml(title)}</div>` : '') +
        (rest.length ? `<ul class="o-slide-body">${rest.map((l) => `<li>${escHtml(l)}</li>`).join('')}</ul>` : '') +
        `</div>`
      );
    };
    if (n <= 1)
      return `<div class="o-deck">${slides.map(card).join('') || '<div class="o-empty">(no slides)</div>'}</div>`;
    // One radio per slide; the inline :checked rules reveal that one slide and highlight its
    // page number (mirrors the multi-sheet xlsx view).
    const rules = slides
      .map(
        (_, i) =>
          `#sl${i}:checked~.o-pager label[for=sl${i}]{background:#5b74f3;color:#fff;border-color:#5b74f3;}` +
          `#sl${i}:checked~.o-slides .o-slide:nth-child(${i + 1}){display:flex;}`,
      )
      .join('');
    const radios = slides
      .map((_, i) => `<input type="radio" class="o-slr" name="oslide" id="sl${i}"${i === 0 ? ' checked' : ''}>`)
      .join('');
    const pager = slides.map((_, i) => `<label for="sl${i}">${i + 1}</label>`).join('');
    const cards = slides.map(card).join('');
    return `<style>${rules}</style><div class="o-deck paged">${radios}<div class="o-pager">${pager}</div><div class="o-slides">${cards}</div></div>`;
  }
  return '<pre class="o-text">' + escHtml(text) + '</pre>';
}
