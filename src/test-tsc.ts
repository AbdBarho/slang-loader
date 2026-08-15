import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const COMPILER = '../node_modules/typescript/bin/tsc';

export interface TscDiagnostic {
  file: string;
  line: number;
  column: number;
  code: string;
  message: string;
}

export function typecheck(files: Record<string, string>): TscDiagnostic[] {
  const tsc = fileURLToPath(new URL(COMPILER, import.meta.url));
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'slang-tsc-')));

  try {
    for (const [path, contents] of Object.entries(files)) {
      const target = join(root, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, contents);
    }

    const { stdout, stderr, status, error } = spawnSync(
      process.execPath,
      [tsc, '-p', 'tsconfig.json', '--pretty', 'false'],
      { cwd: root, encoding: 'utf8' },
    );

    if (error) throw error;

    const all = parse(stdout ?? '');

    // A non-zero exit with nothing parsed at all means tsc failed as a tool, which would read as a clean run.
    if (status !== 0 && all.length === 0) {
      throw new Error(`tsc exited ${status} without a locatable diagnostic:\n${stdout}${stderr}`);
    }

    return all.filter(diagnostic => !external(diagnostic.file, root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function parse(stdout: string): TscDiagnostic[] {
  const diagnostics: TscDiagnostic[] = [];

  for (const line of stdout.split(/\r?\n/)) {
    const match = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/.exec(line);
    if (!match) continue;

    const [, file = '', row = '0', column = '0', code = '', message = ''] = match;
    diagnostics.push({ file, line: Number(row), column: Number(column), code, message });
  }

  return diagnostics;
}

// tsc names repo sources absolutely or with a ../ prefix depending on whether temp and checkout share a volume.
function external(file: string, root: string): boolean {
  const full = isAbsolute(file) ? file : resolve(root, file);
  return !full.toLowerCase().startsWith(root.toLowerCase());
}

export function codes(diagnostics: TscDiagnostic[]): string[] {
  return diagnostics.map(diagnostic => diagnostic.code);
}
