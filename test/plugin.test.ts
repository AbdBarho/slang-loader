import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, test, expect } from 'vitest';

import { MARKER } from '../src/typegen.ts';
import { slangFactory, type SlangPluginOptions } from '../src/plugin.ts';
import { slang } from '../src/unplugin.ts';
import { APPLY_ONLY, BUNDLERS, NOT_CONSTRUCTIBLE_UNDER_NODE, compute } from './manifest.ts';

interface CapturedError {
  message: string;
  id?: string;
  plugin?: string;
  loc?: { file?: string; line: number; column: number };
}

interface TransformHook {
  filter: { id: { include: RegExp; exclude: RegExp[] } };
  handler: (this: unknown, code: string, id: string) => Promise<{ code: string } | null>;
}

function context() {
  const errors: CapturedError[] = [];
  const warnings: unknown[] = [];
  const watched: string[] = [];
  return {
    errors,
    warnings,
    watched,
    error(error: CapturedError) {
      errors.push(error);
    },
    warn(warning: unknown) {
      warnings.push(warning);
    },
    addWatchFile(id: string) {
      watched.push(id);
    },
  };
}

const temporary: string[] = [];

afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function workspace(nested = ''): string {
  const root = mkdtempSync(join(tmpdir(), 'slang-plugin-'));
  temporary.push(root);

  const dir = nested ? join(root, nested) : root;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'scene.slang'), COMPUTE);

  return dir.replace(/\\/g, '/');
}

const COMPUTE = compute(16);

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url)).replace(/\\/g, '/');

function transformOf(options?: SlangPluginOptions): TransformHook {
  return slangFactory(options).transform as unknown as TransformHook;
}

test('transforms a .slang import into a WGSL module', async () => {
  const result = await transformOf().handler.call(context(), COMPUTE, '/src/shader.slang');

  expect(result?.code).toMatch(/export default code/);
  expect(result?.code).toMatch(/@workgroup_size\(16, 1, 1\)/);
  expect(result?.code).toMatch(/export const entryPoints =/);
  expect(result?.code).toMatch(/export const reflection =/);
});

test('the emitted module carries no reference back to the compiler', async () => {
  const result = await transformOf().handler.call(context(), COMPUTE, '/src/shader.slang');

  expect(result?.code).not.toMatch(/slang-loader|vendor|slang-wasm|\bimport\b/);
});

test('the declared id filter selects .slang and skips passthrough queries', () => {
  const { include, exclude } = transformOf().filter.id;
  const matches = (id: string) => include.test(id) && !exclude.some(pattern => pattern.test(id));

  expect(matches('/src/shader.slang')).toBe(true);
  expect(matches('/src/shader.slang?used')).toBe(true);
  expect(matches('/src/main.js')).toBe(false);
  expect(matches('/src/shader.slang?raw')).toBe(false);
  expect(matches('/src/shader.slang?url')).toBe(false);
  expect(matches('/src/shader.slang?worker')).toBe(true);
});

test('a user-supplied exclude is added to the passthrough queries, not swapped for them', () => {
  const { exclude } = transformOf({ exclude: /generated/ }).filter.id;

  expect(exclude).toHaveLength(2);
  expect(exclude.some(pattern => pattern.test('/src/shader.slang?raw'))).toBe(true);
  expect(exclude.some(pattern => pattern.test('/src/generated/shader.slang'))).toBe(true);
});

test('reports a compile error the host can locate and frame', async () => {
  const ctx = context();

  const transformed = transformOf().handler.call(ctx, 'void f( { }', '/src/broken.slang');
  await expect(transformed).rejects.toThrow();

  expect(ctx.errors[0]).toMatchObject({
    plugin: 'slang-loader',
    id: '/src/broken.slang',
    loc: { file: '/src/broken.slang', line: 1, column: 9 },
  });
});

test('registers imported shaders as watch files', async () => {
  const ctx = context();
  const entry = `import util;\n[shader("compute")][numthreads(2,1,1)]\nvoid main(uint3 t : SV_DispatchThreadID, uniform RWStructuredBuffer<float> o) { o[t.x] = scaleBy(1.0); }`;

  const result = await transformOf().handler.call(ctx, entry, `${FIXTURES}entry.slang`);

  expect(result?.code).toMatch(/\* 21\.0f/);
  expect(ctx.watched).toEqual([`${FIXTURES}util.slang`]);
});

test('watches nothing extra for a single-file shader', async () => {
  const ctx = context();

  await transformOf().handler.call(ctx, COMPUTE, `${FIXTURES}solo.slang`);

  expect(ctx.watched).toEqual([]);
});

test('writes a type declaration beside the shader it compiled', async () => {
  const dir = workspace();

  await transformOf().handler.call(context(), COMPUTE, `${dir}/scene.slang`);

  const sidecar = readFileSync(`${dir}/scene.slang.d.ts`, 'utf8');
  expect(sidecar.startsWith(MARKER)).toBe(true);
  expect(sidecar).toMatch(/name: "main"/);
});

test('leaves an unchanged declaration alone rather than rewriting it', async () => {
  const dir = workspace();
  const path = `${dir}/scene.slang`;

  await transformOf().handler.call(context(), COMPUTE, path);

  const past = new Date(Date.now() - 60_000);
  utimesSync(`${path}.d.ts`, past, past);

  await transformOf().handler.call(context(), COMPUTE, path);

  expect(statSync(`${path}.d.ts`).mtimeMs).toBe(past.getTime());
});

test('still writes when the bundler appends a query of its own', async () => {
  const dir = workspace();

  await transformOf().handler.call(context(), COMPUTE, `${dir}/scene.slang?used`);

  expect(existsSync(`${dir}/scene.slang.d.ts`)).toBe(true);
});

test('writes nothing when typegen is switched off', async () => {
  const dir = workspace();

  await transformOf({ types: false }).handler.call(context(), COMPUTE, `${dir}/scene.slang`);

  expect(existsSync(`${dir}/scene.slang.d.ts`)).toBe(false);
});

test('writes nothing for a virtual module, which has no path to sit beside', async () => {
  const dir = workspace();

  await transformOf().handler.call(context(), COMPUTE, `\0${dir}/scene.slang`);

  expect(existsSync(`${dir}/scene.slang.d.ts`)).toBe(false);
});

test('writes nothing into node_modules, where the file would not survive an install', async () => {
  const dir = workspace('node_modules/some-dep');

  await transformOf().handler.call(context(), COMPUTE, `${dir}/scene.slang`);

  expect(existsSync(`${dir}/scene.slang.d.ts`)).toBe(false);
});

test('writes nothing for an id that is not a file on disk', async () => {
  const dir = workspace();

  await transformOf().handler.call(context(), COMPUTE, `${dir}/synthesised.slang`);

  expect(existsSync(`${dir}/synthesised.slang.d.ts`)).toBe(false);
});

test('refuses to overwrite a declaration it did not write', async () => {
  const dir = workspace();
  const ctx = context();
  const handwritten = 'declare const code: string;\nexport default code;\n';
  writeFileSync(`${dir}/scene.slang.d.ts`, handwritten);

  await transformOf().handler.call(ctx, COMPUTE, `${dir}/scene.slang`);

  expect(readFileSync(`${dir}/scene.slang.d.ts`, 'utf8')).toBe(handwritten);
  expect(ctx.warnings).toHaveLength(1);
});

test('a declaration that cannot be written warns instead of failing the build', async () => {
  const dir = workspace();
  const ctx = context();
  mkdirSync(`${dir}/scene.slang.d.ts`);
  const past = new Date(Date.now() - 60_000);
  utimesSync(dir, past, past);

  const result = await transformOf().handler.call(ctx, COMPUTE, `${dir}/scene.slang`);

  expect(result?.code).toMatch(/export default code/);
  expect(ctx.warnings).toHaveLength(1);
  expect(statSync(dir).mtimeMs).toBe(past.getTime());
});

test('a failed compile leaves the previous declaration in place', async () => {
  const dir = workspace();
  const path = `${dir}/scene.slang`;

  await transformOf().handler.call(context(), COMPUTE, path);
  const before = readFileSync(`${path}.d.ts`, 'utf8');

  const broken = transformOf().handler.call(context(), 'void f( { }', path);
  await expect(broken).rejects.toThrow();

  expect(readFileSync(`${path}.d.ts`, 'utf8')).toBe(before);
});

interface Instance {
  transform: TransformHook;
  watchChange: (this: unknown, id: string, change: { event: string }) => void;
}

function instance(options?: SlangPluginOptions): Instance {
  const plugin = slangFactory(options) as unknown as {
    transform: TransformHook;
    vite: { closeBundle: () => Promise<void> };
    watchChange: (id: string, change: { event: string }) => void;
  };

  return { transform: plugin.transform, watchChange: plugin.watchChange };
}

async function compiled(options?: SlangPluginOptions): Promise<{ dir: string; plugin: Instance }> {
  const dir = workspace();
  const plugin = instance(options);
  await plugin.transform.handler.call(context(), COMPUTE, `${dir}/scene.slang`);
  return { dir, plugin };
}

test('drops the declaration as soon as a watcher reports the shader deleted', async () => {
  const { dir, plugin } = await compiled();
  rmSync(`${dir}/scene.slang`);

  plugin.watchChange.call(context(), `${dir}/scene.slang`, { event: 'delete' });

  expect(existsSync(`${dir}/scene.slang.d.ts`)).toBe(false);
});

test('a delete event for a shader still on disk is an atomic save, not a deletion', async () => {
  const { dir, plugin } = await compiled();

  plugin.watchChange.call(context(), `${dir}/scene.slang`, { event: 'delete' });

  expect(existsSync(`${dir}/scene.slang.d.ts`)).toBe(true);
});

test('does not generate declarations for custom include extensions', async () => {
  const dir = workspace();
  const plugin = instance({ include: /\.(?:slang|hlsl)$/ });
  writeFileSync(join(dir, 'effects.hlsl'), COMPUTE);

  await plugin.transform.handler.call(context(), COMPUTE, `${dir}/effects.hlsl`);

  expect(existsSync(`${dir}/effects.hlsl.d.ts`)).toBe(false);
});

test('a watcher reporting an edit is not a reason to delete anything', async () => {
  const { dir, plugin } = await compiled();

  plugin.watchChange.call(context(), `${dir}/scene.slang`, { event: 'update' });

  expect(existsSync(`${dir}/scene.slang.d.ts`)).toBe(true);
});

test('switching typegen off does not turn the plugin into a deleter', async () => {
  const { dir, plugin } = await compiled({ types: false });
  writeFileSync(join(dir, 'ghost.slang.d.ts'), `${MARKER} — do not edit.\nexport {};\n`);

  plugin.watchChange.call(context(), `${dir}/scene.slang`, { event: 'delete' });

  expect(existsSync(`${dir}/ghost.slang.d.ts`)).toBe(true);
});

test('every supported bundler gets a plugin from the same factory', () => {
  const targets = slang as unknown as Record<string, () => { name?: string; apply?: unknown }>;

  for (const bundler of BUNDLERS) {
    if (NOT_CONSTRUCTIBLE_UNDER_NODE.includes(bundler)) {
      expect(typeof targets[bundler], bundler).toBe('function');
      continue;
    }

    const plugin = targets[bundler]?.();
    if (APPLY_ONLY.includes(bundler)) expect(typeof plugin?.apply, bundler).toBe('function');
    else expect(plugin?.name, bundler).toBe('slang-loader');
  }
});
