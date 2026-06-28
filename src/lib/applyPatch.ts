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

/** Parse a patch envelope into file operations. Throws on a malformed envelope. */
export function parsePatch(text: string): PatchOp[] {
  const raw = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  let i = raw.findIndex((l) => l.trim() === '*** Begin Patch');
  if (i < 0) throw new Error('patch must start with "*** Begin Patch"');
  i++;
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
      ops.push({ kind: 'update', path, moveTo, sections: sections.filter((s) => s.length) });
    } else {
      i++; // skip stray lines between hunks
    }
  }
  if (!ops.length) throw new Error('patch contained no file operations');
  return ops;
}

const rtrim = (s: string) => s.replace(/\s+$/, '');

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

/** Apply update sections to file content. Throws if a section's context isn't found. */
export function applySections(content: string, sections: HunkLine[][]): string {
  let lines = content.split('\n');
  for (const sec of sections) {
    const oldBlock = sec.filter((h) => h.t !== '+').map((h) => h.s);
    const newBlock = sec.filter((h) => h.t !== '-').map((h) => h.s);
    if (!oldBlock.length) {
      lines = lines.concat(newBlock); // pure addition with no context → append
      continue;
    }
    let at = indexOfBlock(lines, oldBlock);
    if (at < 0) {
      // fuzzy: ignore trailing whitespace differences
      at = indexOfBlock(lines.map(rtrim), oldBlock.map(rtrim));
    }
    if (at < 0) throw new Error('could not find the context to update:\n' + oldBlock.slice(0, 4).join('\n'));
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
