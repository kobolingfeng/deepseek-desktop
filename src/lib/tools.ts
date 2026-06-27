// Built-in agent tools, executed against the native fs/shell APIs.
import { fs, shell } from '../api';
import type { Settings, ToolCall } from './types';

export const TOOL_SCHEMAS = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a UTF-8 text file and return its contents.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path, absolute or relative to the working directory.' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_dir',
      description: 'List the files and folders inside a directory.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path; defaults to the working directory.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Create or overwrite a UTF-8 text file. Requires user approval.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Destination file path.' },
          content: { type: 'string', description: 'Full file contents to write.' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description:
        'Run a shell command via cmd.exe in the working directory and return stdout/stderr. Requires user approval.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The command line to execute.' },
        },
        required: ['command'],
      },
    },
  },
];

export function toolNeedsApproval(name: string): boolean {
  return name === 'write_file' || name === 'run_command';
}

function isAbsolute(p: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('\\\\') || p.startsWith('/');
}

function resolvePath(p: string, base: string): string {
  const t = (p || '').trim();
  if (!base || isAbsolute(t)) return t;
  return base.replace(/[\\/]+$/, '') + '\\' + t.replace(/^[\\/]+/, '');
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + `\n… [truncated ${s.length - max} more characters]`;
}

function safeParse(argsJson: string): any {
  try {
    return JSON.parse(argsJson || '{}');
  } catch {
    return {};
  }
}

/** Short human-readable summary of a tool call for cards / approval prompts. */
export function describeTool(tc: ToolCall): { title: string; detail: string } {
  const a = safeParse(tc.arguments);
  switch (tc.name) {
    case 'read_file':
      return { title: 'Read file', detail: a.path || '' };
    case 'list_dir':
      return { title: 'List directory', detail: a.path || '.' };
    case 'write_file':
      return { title: 'Write file', detail: a.path || '' };
    case 'run_command':
      return { title: 'Run command', detail: a.command || '' };
    default:
      return { title: tc.name, detail: tc.arguments || '' };
  }
}

export async function executeTool(tc: ToolCall, settings: Settings): Promise<string> {
  const args = safeParse(tc.arguments);
  switch (tc.name) {
    case 'read_file': {
      const p = resolvePath(args.path, settings.workingDir);
      if (!p) throw new Error('path is required');
      const content = await fs.readTextFile(p);
      return content === '' ? '(empty file)' : truncate(content, 60000);
    }
    case 'list_dir': {
      const p = resolvePath(args.path || '.', settings.workingDir);
      const entries = await fs.readDir(p);
      if (!entries.length) return '(empty directory)';
      return entries
        .sort((x, y) => Number(y.isDir) - Number(x.isDir) || x.name.localeCompare(y.name))
        .map((e) => (e.isDir ? '[DIR] ' : '      ') + e.name)
        .join('\n');
    }
    case 'write_file': {
      const p = resolvePath(args.path, settings.workingDir);
      if (!p) throw new Error('path is required');
      const content = typeof args.content === 'string' ? args.content : '';
      await fs.writeTextFile(p, content);
      return `Wrote ${content.length} characters to ${p}`;
    }
    case 'run_command': {
      const cmd = String(args.command || '').trim();
      if (!cmd) throw new Error('command is required');
      const full = settings.workingDir ? `cd /d "${settings.workingDir}" && ${cmd}` : cmd;
      const r = await shell.run('cmd.exe', ['/c', full]);
      let out = r.stdout || '';
      if (r.stderr) out += (out ? '\n' : '') + '[stderr]\n' + r.stderr;
      out = out.trim();
      out += `${out ? '\n' : ''}[exit code ${r.exitCode}]`;
      return truncate(out, 30000);
    }
    default:
      throw new Error('Unknown tool: ' + tc.name);
  }
}
