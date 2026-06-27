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

/** Pull selected entries' raw XML out of an OOXML (zip) file, in order. */
async function unzipEntries(file: string, likeGlob: string): Promise<{ name: string; xml: string }[]> {
  const ps = [
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
