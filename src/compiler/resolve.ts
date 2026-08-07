import { readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path/posix';

export type ReadFile = (path: string) => string | null;

export interface ShaderGraph {
  entry: string;
  files: Map<string, string>;
}

const COMMENTS = /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;
const DECLARATION = /\b(?:__exported\s+)?(?:__import|import|__include)\b\s*([^;{]+);/g;
const PREPROCESSOR = /^[ \t]*#[ \t]*include[ \t]*(?:"([^"\n]*)"|<([^>\n]*)>)/gm;
const QUOTED = /^"([^"]*)"$/;
const DOTTED = /^[A-Za-z_][A-Za-z0-9_]*(?:\s*\.\s*[A-Za-z_][A-Za-z0-9_]*)*$/;

export function readFileFromDisk(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

export function canonical(path: string): string {
  return normalize(path.replace(/\\/g, '/'));
}

export function resolveGraph(entry: string, source: string, readFile: ReadFile): ShaderGraph {
  const files = new Map<string, string>();
  const queue: Array<[string, string]> = [[entry, source]];

  while (queue.length) {
    const [from, text] = queue.shift()!;

    for (const candidate of candidatesFor(text, from)) {
      if (files.has(candidate) || candidate === entry) continue;

      const found = readFile(candidate);
      if (found === null) continue;

      files.set(candidate, found);
      queue.push([candidate, found]);
    }
  }

  return { entry, files };
}

function candidatesFor(source: string, from: string): string[] {
  const text = source.replace(COMMENTS, ' ');
  const names: string[] = [];

  for (const [, target] of text.matchAll(DECLARATION)) {
    const reference = target?.trim() ?? '';
    const quoted = reference.match(QUOTED);

    if (quoted) names.push(...pathNames(quoted[1] ?? ''));
    else if (DOTTED.test(reference)) names.push(...moduleNames(reference));
  }

  for (const [, quoted, angled] of text.matchAll(PREPROCESSOR)) {
    const path = quoted ?? angled;
    if (path) names.push(...pathNames(path));
  }

  const dir = dirname(from);
  return names.map(name => (isAbsolute(name) ? normalize(name) : join(dir, name)));
}

function pathNames(path: string): string[] {
  if (!path) return [];
  return /\.\w+$/.test(path) ? [path] : [`${path}.slang`, path];
}

function moduleNames(reference: string): string[] {
  const base = reference.replace(/\s+/g, '').replace(/\./g, '/');
  return [`${base}.slang`, `${base.replace(/_/g, '-')}.slang`];
}

function isAbsolute(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:\//.test(path);
}
