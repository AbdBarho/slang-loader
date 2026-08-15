import { test, expect } from 'vitest';

import { loadSlang, SlangCompileError, SLANG_VERSION } from './index.ts';

const COMPUTE = `
[shader("compute")]
[numthreads(8, 4, 1)]
void computeMain(uint3 tid : SV_DispatchThreadID, uniform RWStructuredBuffer<float> outBuf)
{
    outBuf[tid.x] = float(tid.x) * 2.0;
}
`;

const TRIANGLE = `
struct VOut { float4 pos : SV_Position; };

[shader("vertex")]
VOut vertexMain(uint vid : SV_VertexID)
{
    VOut o;
    o.pos = float4(float(vid), 0, 0, 1);
    return o;
}

[shader("fragment")]
float4 fragmentMain() : SV_Target { return float4(1, 0, 0, 1); }
`;

function compute(size: number): string {
  return `[shader("compute")][numthreads(${size},1,1)]\nvoid main(uint3 t : SV_DispatchThreadID) { }`;
}

test('compiles a compute shader to WGSL', async () => {
  const slang = await loadSlang();
  const result = slang.compile(COMPUTE, { path: '/double.slang' });

  expect(result.code).toMatch(/@compute/);
  expect(result.code).toMatch(/@workgroup_size\(8, 4, 1\)/);
  expect(result.code).toMatch(/fn computeMain/);
  expect(result.diagnostics).toEqual([]);
});

test('reports entry points with stage and workgroup size', async () => {
  const slang = await loadSlang();
  const result = slang.compile(COMPUTE, { path: '/double.slang' });

  expect(result.entryPoints).toEqual([{ name: 'computeMain', stage: 'compute', workgroupSize: [8, 4, 1] }]);
});

test('returns reflection alongside the code', async () => {
  const slang = await loadSlang();
  const { reflection } = slang.compile(COMPUTE, { path: '/double.slang' });

  expect(reflection).toMatchObject({ entryPoints: [{ name: 'computeMain', stage: 'compute' }] });
});

test('handles multiple entry points in one module', async () => {
  const slang = await loadSlang();
  const result = slang.compile(TRIANGLE, { path: '/triangle.slang' });

  expect(result.entryPoints.map(e => `${e.stage}:${e.name}`)).toEqual(['vertex:vertexMain', 'fragment:fragmentMain']);
  expect(result.code).toMatch(/@vertex/);
  expect(result.code).toMatch(/@fragment/);
});

test('surfaces a syntax error with the source line and column', async () => {
  const slang = await loadSlang();

  try {
    slang.compile('void f( { }', { path: '/broken.slang' });
    expect.unreachable('compile should have thrown');
  } catch (error) {
    expect(error).toBeInstanceOf(SlangCompileError);
    expect((error as SlangCompileError).diagnostics[0]).toMatchObject({
      severity: 'error',
      code: 'E20001',
      file: '/broken.slang',
      line: 1,
      column: 9,
    });
  }
});

test('recompiles edited source under the same path', async () => {
  const slang = await loadSlang();

  expect(slang.compile(compute(1), { path: '/hot.slang' }).code).toMatch(/@workgroup_size\(1, 1, 1\)/);
  expect(slang.compile(compute(2), { path: '/hot.slang' }).code).toMatch(/@workgroup_size\(2, 1, 1\)/);
});

test('memoizes an unchanged source', async () => {
  const slang = await loadSlang();

  const first = slang.compile(compute(3), { path: '/memo.slang' });
  const second = slang.compile(compute(3), { path: '/memo.slang' });

  expect(second).toBe(first);
});

test('survives many compiles without aborting the wasm', async () => {
  const slang = await loadSlang();

  for (let i = 4; i < 30; i++) {
    expect(slang.compile(compute(i), { path: `/stress-${i}.slang` }).code).toMatch(
      new RegExp(`@workgroup_size\\(${i}, 1, 1\\)`),
    );
  }
});

test('exposes the Slang version it was built against', async () => {
  const slang = await loadSlang();
  expect(slang.version).toBe(SLANG_VERSION);
});
