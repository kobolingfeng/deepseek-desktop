// Office document skills. fs is text-only, so binary OOXML files go through a
// PowerShell base64 bridge (same pattern as voice.ts). Excel uses SheetJS;
// Word/PowerPoint text is extracted by unzipping the OOXML in PowerShell.
import * as XLSX from 'xlsx';
import { fs, path, shell } from '../api';

function psQuote(p: string): string {
  return "'" + String(p).replace(/'/g, "''") + "'";
}

async function tempPath(ext: string): Promise<string> {
  const dir = await path.temp();
  return dir.replace(/[\\/]+$/, '') + '\\dsoffice_' + Math.random().toString(36).slice(2) + ext;
}

/** Read a binary file as base64 (staged through a temp file to dodge stdout limits). */
async function readBytesBase64(p: string): Promise<string> {
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
async function writeBytesBase64(p: string, b64: string): Promise<void> {
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

export async function writeExcel(p: string, sheets: { name?: string; rows: unknown[][] }[]): Promise<number> {
  const wb = XLSX.utils.book_new();
  let rows = 0;
  sheets.forEach((s, i) => {
    const ws = XLSX.utils.aoa_to_sheet(Array.isArray(s.rows) ? s.rows : []);
    const nm = (s.name || `Sheet${i + 1}`).replace(/[\\/?*[\]:]/g, '').slice(0, 31) || `Sheet${i + 1}`;
    XLSX.utils.book_append_sheet(wb, ws, nm);
    rows += Array.isArray(s.rows) ? s.rows.length : 0;
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

/** Pull selected entries' raw XML out of an OOXML (zip) file, in order. */
async function unzipEntries(file: string, likeGlob: string): Promise<{ name: string; xml: string }[]> {
  const ps = [
    '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;',
    'Add-Type -AssemblyName System.IO.Compression.FileSystem;',
    `$zip=[IO.Compression.ZipFile]::OpenRead(${psQuote(file)});`,
    `$es=$zip.Entries | Where-Object { ($_.FullName -replace '\\\\','/') -like ${psQuote(likeGlob)} } | Sort-Object FullName;`,
    `$o=foreach($e in $es){ $sr=New-Object IO.StreamReader($e.Open()); $t=$sr.ReadToEnd(); $sr.Close(); "<<<E:"+($e.FullName -replace '\\\\','/')+">>>"+$t };`,
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

function escHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
}

/** Render an Office file as preview HTML: real tables for spreadsheets, readable text
 *  (per slide for .pptx) for documents/decks. */
export async function officePreviewHtml(p: string): Promise<string> {
  const ext = (p.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
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

  const text = await readOffice(p);
  if (ext === 'pptx') {
    // readPptx output is "# Slide N\n<lines>": render each slide as a 16:9 card with the
    // first line as the title and the rest as bullets (mirrors how we generate decks).
    const slides = text.split(/\n(?=# Slide )/).filter((s) => s.trim());
    const cards = slides.map((s, i) => {
      const lines = s
        .replace(/^# Slide \d+\n?/, '')
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      const title = lines[0] || '';
      const rest = lines.slice(1);
      return (
        `<div class="o-slide"><span class="o-slide-no">${i + 1}</span>` +
        (title ? `<div class="o-slide-title">${escHtml(title)}</div>` : '') +
        (rest.length ? `<ul class="o-slide-body">${rest.map((l) => `<li>${escHtml(l)}</li>`).join('')}</ul>` : '') +
        `</div>`
      );
    });
    return `<div class="o-deck">${cards.join('')}</div>`;
  }
  return '<pre class="o-text">' + escHtml(text) + '</pre>';
}
