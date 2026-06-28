// Codex-style `apply_patch`: parse + apply the "*** Begin Patch" envelope.
// Pure functions (parse/applySections/patchChanges) so they can be unit-tested;
// the fs side lives in tools.ts.

export type HunkLine = { t: ' ' | '+' | '-'; s: string };
export type PatchOp =
  | { kind: 'add'; path: string; lines: string[] }
  | { kind: 'delete'; path: string }
  | { kind: 'update'; path: string; moveTo?: string; sections: HunkLine[][] };

export type PatchRow = { t: 'ctx' | 'add' | 'del'; s: string };

const isHeader = (l: string) =>
  /^\*\*\* (Add File:|Delete File:|Update File:|End Patch)/.test(l.trim());

// Some models redundantly emit a changed line as BOTH a context line and a change line
// (" X" immediately followed by "-X", or "+X" immediately followed by " X"). A line that
// is simultaneously "keep" and "remove/add" is always an artifact — drop the duplicate
// context line so the remaining hunk is a valid diff.
function normalizeSection(sec: HunkLine[]): HunkLine[] {
  const out: HunkLine[] = [];
  for (let i = 0; i < sec.length; i++) {
    const cur = sec[i];
    if (cur.t === ' ') {
      const next = sec[i + 1];
      const prev = out[out.length - 1];
      if ((next && next.t === '-' && next.s === cur.s) || (prev && prev.t === '+' && prev.s === cur.s)) continue;
    }
    out.push(cur);
  }
  return out;
}

/** Parse a patch envelope into file operations. Throws on a malformed envelope. */
export function parsePatch(text: string): PatchOp[] {
  const raw = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  let i = raw.findIndex((l) => l.trim() === '*** Begin Patch');
  if (i >= 0) {
    i++; // start after the envelope header
  } else {
    // Lenient: models (esp. smaller ones) sometimes omit the "*** Begin Patch"
    // envelope. If a file marker is present, parse from there anyway.
    i = raw.findIndex((l) => /^\*\*\* (Add|Update|Delete) File: /.test(l.trim()));
    if (i < 0) throw new Error('patch must contain at least one "*** Add File:", "*** Update File:", or "*** Delete File:" line');
  }
  const ops: PatchOp[] = [];
  while (i < raw.length && raw[i].trim() !== '*** End Patch') {
    const line = raw[i];
    let m: RegExpExecArray | null;
    if ((m = /^\*\*\* Add File: (.+)$/.exec(line))) {
      const path = m[1].trim();
      i++;
      const lines: string[] = [];
      while (i < raw.length && !isHeader(raw[i])) {
        lines.push(raw[i].startsWith('+') ? raw[i].slice(1) : raw[i]);
        i++;
      }
      ops.push({ kind: 'add', path, lines });
    } else if ((m = /^\*\*\* Delete File: (.+)$/.exec(line))) {
      ops.push({ kind: 'delete', path: m[1].trim() });
      i++;
    } else if ((m = /^\*\*\* Update File: (.+)$/.exec(line))) {
      const path = m[1].trim();
      i++;
      let moveTo: string | undefined;
      if (i < raw.length && /^\*\*\* Move to: (.+)$/.test(raw[i])) {
        moveTo = raw[i].replace(/^\*\*\* Move to: /, '').trim();
        i++;
      }
      const sections: HunkLine[][] = [];
      let cur: HunkLine[] | null = null;
      while (i < raw.length && !isHeader(raw[i])) {
        const l = raw[i];
        if (/^@@/.test(l)) {
          cur = [];
          sections.push(cur);
        } else {
          if (!cur) {
            cur = [];
            sections.push(cur);
          }
          const t = l[0];
          if (t === '+' || t === '-' || t === ' ') cur.push({ t, s: l.slice(1) });
          else cur.push({ t: ' ', s: l }); // lenient: treat an unprefixed line as context
        }
        i++;
      }
      ops.push({ kind: 'update', path, moveTo, sections: sections.map(normalizeSection).filter((s) => s.length) });
    } else {
      i++; // skip stray lines between hunks
    }
  }
  if (!ops.length) throw new Error('patch contained no file operations');
  return ops;
}

const rtrim = (s: string) => s.replace(/\s+$/, '');
const leadWs = (s: string) => (s.match(/^[ \t]*/) || [''])[0];

function indexOfBlock(hay: string[], needle: string[], from = 0): number {
  if (!needle.length) return -1;
  for (let i = from; i + needle.length <= hay.length; i++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++)
      if (hay[i + j] !== needle[j]) {
        ok = false;
        break;
      }
    if (ok) return i;
  }
  return -1;
}

function countMatches(hay: string[], needle: string[]): number {
  if (!needle.length) return 0;
  let n = 0;
  for (let i = 0; i + needle.length <= hay.length; i++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++)
      if (hay[i + j] !== needle[j]) {
        ok = false;
        break;
      }
    if (ok) n++;
  }
  return n;
}

// Shift a line's leading indentation by `delta` columns — used when a patch matched on a
// whitespace-insensitive basis but its indentation didn't match the file.
function reindent(s: string, delta: number): string {
  if (delta === 0) return s;
  if (delta > 0) return ' '.repeat(delta) + s;
  return s.slice(Math.min(-delta, leadWs(s).length));
}

/** Apply update sections to file content. Throws if a section's context isn't found. */
export function applySections(content: string, sections: HunkLine[][]): string {
  // Reject a degenerate "update" that changes nothing (models sometimes emit only
  // context lines) — otherwise it silently no-ops and the agent thinks it succeeded.
  if (!sections.some((sec) => sec.some((h) => h.t !== ' ')))
    throw new Error('patch made no changes — an Update File hunk must contain at least one "-" (remove) or "+" (add) line');
  let lines = content.split('\n');
  for (const sec of sections) {
    const oldBlock = sec.filter((h) => h.t !== '+').map((h) => h.s);
    let newBlock = sec.filter((h) => h.t !== '-').map((h) => h.s);
    if (!oldBlock.length) {
      lines = lines.concat(newBlock); // pure addition with no context → append
      continue;
    }
    // tier 1: exact match. If the context appears more than once it's ambiguous — error
    // (forcing the model to add more context) rather than silently editing the wrong spot.
    const exact = countMatches(lines, oldBlock);
    if (exact > 1)
      throw new Error(
        `context is ambiguous — it appears ${exact} times; include more surrounding unchanged lines to pin the exact location:\n` +
          oldBlock.slice(0, 4).join('\n'),
      );
    // tier 2: ignore trailing whitespace.
    let at = exact === 1 ? indexOfBlock(lines, oldBlock) : indexOfBlock(lines.map(rtrim), oldBlock.map(rtrim));
    if (at >= 0) {
      lines = [...lines.slice(0, at), ...newBlock, ...lines.slice(at + oldBlock.length)];
      continue;
    }
    // tier 3: match ignoring leading+trailing whitespace (models often mis-indent the
    // context), then re-indent the replacement to the file's real indentation.
    at = indexOfBlock(lines.map((s) => s.trim()), oldBlock.map((s) => s.trim()));
    if (at < 0)
      throw new Error(
        'could not locate the context in the file — re-read the file and copy the surrounding unchanged lines EXACTLY (with their original indentation). Looked for:\n' +
          oldBlock.slice(0, 4).join('\n'),
      );
    const delta = leadWs(lines[at]).length - leadWs(oldBlock[0]).length;
    if (delta !== 0) newBlock = newBlock.map((s) => reindent(s, delta));
    lines = [...lines.slice(0, at), ...newBlock, ...lines.slice(at + oldBlock.length)];
  }
  return lines.join('\n');
}

/** Per-file change summary + diff rows derived from a patch (no fs) — for the UI card. */
export function patchChanges(
  text: string,
): { path: string; kind: 'add' | 'update' | 'delete'; additions: number; deletions: number; diff: PatchRow[] }[] {
  let ops: PatchOp[];
  try {
    ops = parsePatch(text);
  } catch {
    return [];
  }
  return ops.map((op) => {
    if (op.kind === 'add')
      return { path: op.path, kind: 'add' as const, additions: op.lines.length, deletions: 0, diff: op.lines.map((s) => ({ t: 'add' as const, s })) };
    if (op.kind === 'delete') return { path: op.path, kind: 'delete' as const, additions: 0, deletions: 0, diff: [] };
    const rows: PatchRow[] = op.sections.flatMap((sec) =>
      sec.map((h) => ({ t: h.t === '+' ? ('add' as const) : h.t === '-' ? ('del' as const) : ('ctx' as const), s: h.s })),
    );
    return {
      path: op.moveTo || op.path,
      kind: 'update' as const,
      additions: rows.filter((r) => r.t === 'add').length,
      deletions: rows.filter((r) => r.t === 'del').length,
      diff: rows,
    };
  });
}
