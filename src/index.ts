import assert from 'node:assert/strict';
import { basename } from 'node:path';

import { bootWasm } from './wasm.js';
import { parseDiagnostics, type Diagnostic } from './diagnostics.js';
import type { ComponentType, EntryPoint, Session, SlangWasm } from './wasm-types.js';

export type { Diagnostic, DiagnosticSeverity } from './diagnostics.js';
export { SLANG_VERSION } from './slang-version.js';

export type ShaderStage = 'compute' | 'vertex' | 'fragment' | (string & {});

export interface SlangEntryPoint {
  name: string;
  stage: ShaderStage;
  workgroupSize: [number, number, number] | null;
}

export interface CompileOptions {
  path?: string;
}

export interface CompileResult {
  code: string;
  entryPoints: SlangEntryPoint[];
  reflection: unknown;
  diagnostics: Diagnostic[];
}

export interface Slang {
  readonly version: string;
  compile(source: string, options?: CompileOptions): CompileResult;
  dispose(): void;
}

export class SlangCompileError extends Error {
  readonly diagnostics: Diagnostic[];
  readonly path: string;

  constructor(message: string, diagnostics: Diagnostic[], path: string) {
    super(message);
    this.name = 'SlangCompileError';
    this.diagnostics = diagnostics;
    this.path = path;
  }
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

  const cache = new Map<string, { source: string; result: CompileResult }>();
  let disposed = false;

  return {
    version: wasm.getVersionString(),

    compile(source, options = {}) {
      assert(!disposed, 'slang-loader: this Slang instance has been disposed.');

      const path = options.path ?? '/anonymous.slang';
      // Keyed by path alone, so editing a shader replaces its entry instead of accumulating one
      // per revision for the life of a dev server.
      const cached = cache.get(path);
      if (cached?.source === source) return cached.result;

      const result = compileOnce(wasm, globalSession.createSession(target.value), source, path);
      cache.set(path, { source, result });
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

function compileOnce(wasm: SlangWasm, session: Session | null, source: string, path: string): CompileResult {
  assert(session, `slang-loader: createSession failed: ${wasm.getLastError().message}`);

  try {
    const module = session.loadModuleFromSource(source, moduleNameFor(path), path);
    assertCompiled(module, wasm, path);

    const entryPoints: ComponentType[] = [];
    const count = module.getDefinedEntryPointCount();
    for (let i = 0; i < count; i++) {
      const entryPoint: EntryPoint | null = module.getDefinedEntryPoint(i);
      assertCompiled(entryPoint, wasm, path);
      entryPoints.push(entryPoint);
    }

    const composite = session.createCompositeComponentType([module, ...entryPoints]);
    assertCompiled(composite, wasm, path);

    const linked = composite.link();
    assertCompiled(linked, wasm, path);

    const code = linked.getTargetCode(0);
    const lastError = wasm.getLastError();
    assertCompiled(code, wasm, path);

    const layout = linked.getLayout(0);
    const reflection = layout ? (layout.toJsonObject() as unknown) : null;

    return {
      code,
      entryPoints: readEntryPoints(reflection),
      reflection,
      diagnostics: parseDiagnostics(lastError.message),
    };
  } finally {
    // Deleting the individual embind handles (module, entry points, layout) aborts the wasm on the
    // next compile — they stay owned by the session, which frees them here.
    session.delete();
  }
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

function assertCompiled<T>(value: T, wasm: SlangWasm, path: string): asserts value is NonNullable<T> {
  // assert()'s message argument is eager, so the SlangCompileError is built lazily here instead of
  // allocating one per step on every successful compile.
  if (value === null || value === undefined || value === '') {
    const { message } = wasm.getLastError();
    const text = message || 'Slang reported no diagnostics.';
    assert.fail(new SlangCompileError(text.trimEnd(), parseDiagnostics(text), path));
  }
}

function moduleNameFor(path: string): string {
  const stem = basename(path).replace(/\.slang$/i, '') || 'shader';
  const sanitized = stem.replace(/[^A-Za-z0-9_]/g, '_');
  return /^[A-Za-z_]/.test(sanitized) ? sanitized : `m_${sanitized}`;
}
