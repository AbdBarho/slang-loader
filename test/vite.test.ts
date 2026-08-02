import { test, expect } from 'vitest';

import slang from '../src/vite.js';

interface CapturedError {
  message: string;
  plugin?: string;
  loc?: { file: string; line: number; column: number };
}

function context() {
  const errors: CapturedError[] = [];
  return {
    errors,
    error(error: CapturedError): never {
      errors.push(error);
      throw Object.assign(new Error(error.message), error);
    },
  };
}

const COMPUTE = `[shader("compute")][numthreads(16,1,1)]\nvoid main(uint3 t : SV_DispatchThreadID) { }`;

test('transforms a .slang import into a WGSL module', async () => {
  const plugin = slang();
  const result = await plugin.transform.call(context(), COMPUTE, '/src/shader.slang');

  expect(result?.code).toMatch(/export default code/);
  expect(result?.code).toMatch(/@workgroup_size\(16, 1, 1\)/);
  expect(result?.code).toMatch(/export const entryPoints =/);
  expect(result?.code).toMatch(/export const reflection =/);
});

test('the emitted module carries no reference back to the compiler', async () => {
  const plugin = slang();
  const result = await plugin.transform.call(context(), COMPUTE, '/src/shader.slang');

  expect(result?.code).not.toMatch(/slang-loader|vendor|slang-wasm|\bimport\b/);
});

test('ignores files the include pattern does not match', async () => {
  const plugin = slang();

  await expect(plugin.transform.call(context(), 'x', '/src/main.js')).resolves.toBeNull();
  await expect(plugin.transform.call(context(), 'x', '/src/shader.slang?raw')).resolves.toBeNull();
});

test('reports a compile error the host can locate and frame', async () => {
  const plugin = slang();
  const ctx = context();

  await expect(plugin.transform.call(ctx, 'void f( { }', '/src/broken.slang')).rejects.toThrow();

  expect(ctx.errors[0]).toMatchObject({
    plugin: 'slang-loader',
    id: '/src/broken.slang',
    loc: { file: '/src/broken.slang', line: 1, column: 9 },
  });
});
