import { expect, test } from 'vitest';

import { codes, typecheck } from './test-tsc.ts';
import { loadSlang, type SlangEntryPoint } from './index.ts';
import { emitDeclaration, MARKER } from './typegen.ts';

const SHADER = `
struct Params { float time; float2 resolution; };
ConstantBuffer<Params> params;
RWStructuredBuffer<float> output;

[shader("compute")][numthreads(16, 8, 1)]
void computeMain(uint3 t : SV_DispatchThreadID) { output[t.x] = params.time; }

[shader("vertex")]
float4 vertexMain(uint vid : SV_VertexID) : SV_Position { return float4(float(vid), 0, 0, 1); }
`;

async function entryPoints(source = SHADER, path = '/scene.slang'): Promise<SlangEntryPoint[]> {
  const slang = await loadSlang();
  return slang.compile(source, { path }).entryPoints;
}

const EMPTY_REFLECTION = { entryPoints: [], parameters: [] };

function consumer(sidecar: string, index: string): Record<string, string> {
  return {
    'package.json': JSON.stringify({ name: 'consumer', private: true, type: 'module' }),
    'tsconfig.json': JSON.stringify({
      compilerOptions: {
        noEmit: true,
        strict: true,
        skipLibCheck: false,
        module: 'preserve',
        moduleResolution: 'bundler',
        types: [],
      },
    }),
    'index.ts': index,
    'scene.slang': SHADER,
    'scene.slang.d.ts': sidecar,
  };
}

test('emits a declaration that typechecks and keeps entry point names literal', async () => {
  const sidecar = emitDeclaration(await entryPoints(), EMPTY_REFLECTION);

  const index = `import code, { entryPoints, reflection } from './scene.slang';
const wgsl: string = code;
const name: 'computeMain' = entryPoints[0].name;
const size: [16, 8, 1] = entryPoints[0].workgroupSize;
const vertex: 'vertexMain' = entryPoints[1].name;
const none: null = entryPoints[1].workgroupSize;
const reflected: unknown = reflection;
`;

  expect(typecheck(consumer(sidecar, index))).toEqual([]);
});

test('emits the concrete reflection type', async () => {
  const slang = await loadSlang();
  const result = slang.compile(SHADER, { path: '/scene.slang' });
  const sidecar = emitDeclaration(result.entryPoints, result.reflection);
  const index = `import { reflection } from './scene.slang';
const parameter: 'params' = reflection.parameters[0].name;
const scalar: 'float32' = reflection.parameters[0].type.elementType.fields[0].type.scalarType;
`;

  expect(typecheck(consumer(sidecar, index))).toEqual([]);
});

test('the round trip really is checking, not just resolving', async () => {
  const sidecar = emitDeclaration(await entryPoints(), EMPTY_REFLECTION);
  const index = `import { entryPoints } from './scene.slang';\nconst name: 'nope' = entryPoints[0].name;\n`;

  expect(codes(typecheck(consumer(sidecar, index)))).toContain('TS2322');
});

test('marks the file so cleanup can tell it apart from a hand-written one', async () => {
  const sidecar = emitDeclaration(await entryPoints(), EMPTY_REFLECTION);

  expect(sidecar.startsWith(MARKER)).toBe(true);
});

test('is byte-deterministic, so an unchanged shader never rewrites its sidecar', async () => {
  const entries = await entryPoints();

  expect(emitDeclaration(entries, EMPTY_REFLECTION)).toBe(
    emitDeclaration(structuredClone(entries), structuredClone(EMPTY_REFLECTION)),
  );
});

test('escapes entry point names using JSON string syntax', () => {
  const sidecar = emitDeclaration(
    [{ name: 'line\nbreak"quoted"', stage: 'compute', workgroupSize: null }],
    EMPTY_REFLECTION,
  );
  const index = `import code from './scene.slang';\nconst wgsl: string = code;\n`;

  expect(typecheck(consumer(sidecar, index))).toEqual([]);
});

test('a shader with no entry points still produces a usable declaration', () => {
  const index = `import code from './scene.slang';\nconst wgsl: string = code;\n`;

  expect(typecheck(consumer(emitDeclaration([], EMPTY_REFLECTION), index))).toEqual([]);
});
