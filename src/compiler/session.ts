import assert from 'node:assert/strict';
import { basename, dirname } from 'node:path/posix';

import { bootWasm } from './wasm.ts';
import { parseDiagnostics, type Diagnostic } from './diagnostics.ts';
import { canonical, readFileFromDisk, resolveGraph, type ReadFile, type ShaderGraph } from './resolve.ts';
import type { ComponentType, EntryPoint, Session, SlangWasm } from './types.ts';

export type ShaderStage = 'compute' | 'vertex' | 'fragment' | (string & {});

export interface SlangEntryPoint {
  name: string;
  stage: ShaderStage;
  workgroupSize: [number, number, number] | null;
}

export interface CompileOptions {
  path?: string;
  readFile?: ReadFile;
}

export interface CompileResult {
  code: string;
  entryPoints: SlangEntryPoint[];
  reflection: unknown;
  diagnostics: Diagnostic[];
  dependencies: string[];
}

export interface Slang {
  readonly version: string;
  compile(source: string, options?: CompileOptions): CompileResult;
  dispose(): void;
}

export class SlangCompileError extends Error {
  readonly diagnostics: Diagnostic[];
  readonly path: string;
  readonly dependencies: string[];

  constructor(message: string, diagnostics: Diagnostic[], path: string, dependencies: string[] = []) {
    super(message);
    this.name = 'SlangCompileError';
    this.diagnostics = diagnostics;
    this.path = path;
    this.dependencies = dependencies;
  }
}

interface CompileContext {
  graph: ShaderGraph;
  staged: Map<string, string>;
}

interface ReflectionEntryPoint {
  name?: string;
  stage?: string;
  threadGroupSize?: number[];
}

let slangPromise: Promise<Slang> | undefined;

export function loadSlang(): Promise<Slang> {
  slangPromise ??= createSlang();
  return slangPromise;
}

export async function disposeSlang(): Promise<void> {
  if (!slangPromise) return;
  const slang = await slangPromise;
  slang.dispose();
}

export async function compile(source: string, options: CompileOptions = {}): Promise<CompileResult> {
  const slang = await loadSlang();
  return slang.compile(source, options);
}

async function createSlang(): Promise<Slang> {
  const wasm = await bootWasm();

  const target = wasm.getCompileTargets().find(t => t.name === 'WGSL');
  assert(target, `slang-loader: this Slang build (${wasm.getVersionString()}) does not expose a WGSL target.`);

  const globalSession = wasm.createGlobalSession();
  assert(globalSession, `slang-loader: createGlobalSession failed: ${wasm.getLastError().message}`);

  const cache = new Map<string, { source: string; files: Map<string, string>; result: CompileResult }>();
  let disposed = false;

  return {
    version: wasm.getVersionString(),

    compile(source, options = {}) {
      assert(!disposed, 'slang-loader: this Slang instance has been disposed.');

      const path = canonical(options.path ?? '/anonymous.slang');
      const graph = resolveGraph(path, source, options.readFile ?? readFileFromDisk);

      const cached = cache.get(path);
      if (cached?.source === source && unchanged(cached.files, graph.files)) return cached.result;

      const result = compileOnce(wasm, globalSession.createSession(target.value), source, graph);
      cache.set(path, { source, files: graph.files, result });
      return result;
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      cache.clear();
      globalSession.delete();
      slangPromise = undefined;
    },
  };
}

function compileOnce(wasm: SlangWasm, session: Session | null, source: string, graph: ShaderGraph): CompileResult {
  assert(session, `slang-loader: createSession failed: ${wasm.getLastError().message}`);

  const { entry, files } = graph;
  const mounted = mount(entry);
  const context: CompileContext = { graph, staged: mountMap(graph) };

  try {
    stage(wasm, graph);

    const module = session.loadModuleFromSource(source, moduleNameFor(entry), mounted);
    assertCompiled(module, wasm, context);

    const entryPoints: ComponentType[] = [];
    const count = module.getDefinedEntryPointCount();
    for (let i = 0; i < count; i++) {
      const entryPoint: EntryPoint | null = module.getDefinedEntryPoint(i);
      assertCompiled(entryPoint, wasm, context);
      entryPoints.push(entryPoint);
    }

    const composite = session.createCompositeComponentType([module, ...entryPoints]);
    assertCompiled(composite, wasm, context);

    const linked = composite.link();
    assertCompiled(linked, wasm, context);

    const code = linked.getTargetCode(0);
    const lastError = wasm.getLastError();
    assertCompiled(code, wasm, context);

    const layout = linked.getLayout(0);
    const reflection = layout ? (layout.toJsonObject() as unknown) : null;

    return {
      code,
      entryPoints: readEntryPoints(reflection),
      reflection,
      diagnostics: diagnose(lastError.message, context.staged),
      dependencies: [...files.keys()],
    };
  } finally {
    try {
      session.delete();
    } finally {
      unstage(wasm, graph);
    }
  }
}

function mountMap(graph: ShaderGraph): Map<string, string> {
  const staged = new Map<string, string>([[mount(graph.entry), graph.entry]]);
  for (const path of graph.files.keys()) staged.set(mount(path), path);
  return staged;
}

function stage(wasm: SlangWasm, graph: ShaderGraph): void {
  if (graph.files.size === 0) return;

  mkdirFor(wasm, mount(graph.entry));

  for (const [path, source] of graph.files) {
    const mounted = mount(path);
    mkdirFor(wasm, mounted);
    wasm.FS.writeFile(mounted, source);
  }
}

function mkdirFor(wasm: SlangWasm, mounted: string): void {
  wasm.FS.mkdirTree(dirname(mounted));
}

function unstage(wasm: SlangWasm, graph: ShaderGraph): void {
  for (const path of graph.files.keys()) {
    try {
      wasm.FS.unlink(mount(path));
    } catch {
      // a file we failed to write is a file we do not need to remove
    }
  }
}

function mount(path: string): string {
  return path.startsWith('/') ? path : `/${path}`;
}

function diagnose(text: string, staged: Map<string, string>): Diagnostic[] {
  return parseDiagnostics(text).map(diagnostic =>
    diagnostic.file && staged.has(diagnostic.file) ? { ...diagnostic, file: staged.get(diagnostic.file)! } : diagnostic,
  );
}

function unmount(text: string, staged: Map<string, string>): string {
  let unmounted = text;

  for (const [mounted, path] of staged) {
    if (mounted === path) continue;
    unmounted = unmounted.replaceAll(new RegExp(`(?<![^\\s'"(\\[<])${escapeRegExp(mounted)}`, 'g'), path);
  }

  return unmounted;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function unchanged(before: Map<string, string>, after: Map<string, string>): boolean {
  if (before.size !== after.size) return false;
  for (const [path, source] of after) if (before.get(path) !== source) return false;
  return true;
}

function readEntryPoints(reflection: unknown): SlangEntryPoint[] {
  const entries = (reflection as { entryPoints?: ReflectionEntryPoint[] } | null)?.entryPoints;
  if (!Array.isArray(entries)) return [];

  return entries.map(entry => {
    const size = entry.threadGroupSize;
    return {
      name: entry.name ?? '',
      stage: entry.stage ?? 'unknown',
      workgroupSize: Array.isArray(size) && size.length === 3 ? [size[0] ?? 1, size[1] ?? 1, size[2] ?? 1] : null,
    };
  });
}

function assertCompiled<T>(value: T, wasm: SlangWasm, context: CompileContext): asserts value is NonNullable<T> {
  if (value === null || value === undefined || value === '') {
    const { message } = wasm.getLastError();
    const text = message || 'Slang reported no diagnostics.';
    const diagnostics = diagnose(text, context.staged);
    const reported = unmount(text.trimEnd(), context.staged);
    const { entry, files } = context.graph;
    assert.fail(new SlangCompileError(reported, diagnostics, entry, [...files.keys()]));
  }
}

function moduleNameFor(path: string): string {
  const stem = basename(path).replace(/\.slang$/i, '') || 'shader';
  const sanitized = stem.replace(/[^A-Za-z0-9_]/g, '_');
  return /^[A-Za-z_]/.test(sanitized) ? sanitized : `m_${sanitized}`;
}
