import { test, expect } from 'vitest';

import { loadSlang, SlangCompileError } from '../src/index.ts';

function reader(files: Record<string, string>) {
  return (path: string) => files[path] ?? null;
}

const CALLER = `
[shader("compute")][numthreads(4,1,1)]
void main(uint3 t : SV_DispatchThreadID, uniform RWStructuredBuffer<float> o)
{ o[t.x] = helperFn(1.0); }
`;

test('resolves an import of a sibling file', async () => {
  const slang = await loadSlang();
  const result = slang.compile(`import util;${CALLER}`, {
    path: '/proj/entry.slang',
    readFile: reader({ '/proj/util.slang': 'public float helperFn(float v) { return v * 3.0; }' }),
  });

  expect(result.code).toMatch(/fn helperFn\w*\(/);
  expect(result.code).toMatch(/\* 3\.0f/);
  expect(result.dependencies).toEqual(['/proj/util.slang']);
});

test('translates a dotted module name into a path, underscores into hyphens', async () => {
  const slang = await loadSlang();
  const result = slang.compile(`import lib.color_grade;${CALLER}`, {
    path: '/dot/entry.slang',
    readFile: reader({ '/dot/lib/color-grade.slang': 'public float helperFn(float v) { return v * 17.0; }' }),
  });

  expect(result.code).toMatch(/\* 17\.0f/);
  expect(result.dependencies).toEqual(['/dot/lib/color-grade.slang']);
});

test('resolves a quoted import path', async () => {
  const slang = await loadSlang();
  const result = slang.compile(`import "shared/util.slang";${CALLER}`, {
    path: '/quoted/entry.slang',
    readFile: reader({ '/quoted/shared/util.slang': 'public float helperFn(float v) { return v * 29.0; }' }),
  });

  expect(result.code).toMatch(/\* 29\.0f/);
});

test('resolves a preprocessor #include', async () => {
  const slang = await loadSlang();
  const result = slang.compile(`#include "common.slang"\n${CALLER}`, {
    path: '/pp/entry.slang',
    readFile: reader({ '/pp/common.slang': 'float helperFn(float v) { return v * 11.0; }' }),
  });

  expect(result.code).toMatch(/\* 11\.0f/);
  expect(result.dependencies).toEqual(['/pp/common.slang']);
});

test('resolves __include into the same module', async () => {
  const slang = await loadSlang();
  const result = slang.compile(`module m;\n__include part;\n${CALLER}`, {
    path: '/mi/entry.slang',
    readFile: reader({ '/mi/part.slang': 'implementing m;\nfloat helperFn(float v) { return v * 13.0; }' }),
  });

  expect(result.code).toMatch(/\* 13\.0f/);
  expect(result.dependencies).toEqual(['/mi/part.slang']);
});

test('follows imports transitively', async () => {
  const slang = await loadSlang();
  const result = slang.compile(`import a;${CALLER}`, {
    path: '/t/entry.slang',
    readFile: reader({
      '/t/a.slang': 'import b;\npublic float helperFn(float v) { return other(v); }',
      '/t/b.slang': 'public float other(float v) { return v * 19.0; }',
    }),
  });

  expect(result.code).toMatch(/\* 19\.0f/);
  expect(result.dependencies.sort()).toEqual(['/t/a.slang', '/t/b.slang']);
});

test('resolves relative to the importing file, not the entry', async () => {
  const slang = await loadSlang();
  const result = slang.compile(`import nested.a;${CALLER}`, {
    path: '/rel/entry.slang',
    readFile: reader({
      '/rel/nested/a.slang': 'import b;\npublic float helperFn(float v) { return other(v); }',
      '/rel/nested/b.slang': 'public float other(float v) { return v * 31.0; }',
    }),
  });

  expect(result.code).toMatch(/\* 31\.0f/);
});

test('terminates on a circular __include', async () => {
  const slang = await loadSlang();
  const result = slang.compile(`module m;\n__include a;\n${CALLER}`, {
    path: '/cyc/entry.slang',
    readFile: reader({
      '/cyc/a.slang': 'implementing m;\n__include b;\nfloat helperFn(float v) { return other(v); }',
      '/cyc/b.slang': 'implementing m;\n__include a;\nfloat other(float v) { return v * 37.0; }',
    }),
  });

  expect(result.code).toMatch(/\* 37\.0f/);
  expect(result.dependencies.sort()).toEqual(['/cyc/a.slang', '/cyc/b.slang']);
});

test('rejects a circular import the way Slang does', async () => {
  const slang = await loadSlang();

  try {
    slang.compile(`import a;${CALLER}`, {
      path: '/rec/entry.slang',
      readFile: reader({
        '/rec/a.slang': 'import b;\npublic float helperFn(float v) { return other(v); }',
        '/rec/b.slang': 'import a;\npublic float other(float v) { return v * 37.0; }',
      }),
    });
    expect.unreachable('compile should have thrown');
  } catch (error) {
    expect(error).toBeInstanceOf(SlangCompileError);
    expect((error as SlangCompileError).diagnostics[0]).toMatchObject({
      code: 'E38200',
      file: '/rec/b.slang',
    });
  }
});

test('reports an error inside a dependency against the dependency path', async () => {
  const slang = await loadSlang();

  try {
    slang.compile(`import util;${CALLER}`, {
      path: '/err/entry.slang',
      readFile: reader({ '/err/util.slang': 'public float helperFn(float v) { return v * ; }' }),
    });
    expect.unreachable('compile should have thrown');
  } catch (error) {
    expect(error).toBeInstanceOf(SlangCompileError);
    expect((error as SlangCompileError).diagnostics[0]).toMatchObject({
      severity: 'error',
      file: '/err/util.slang',
      line: 1,
    });
  }
});

test('leaves an unresolvable import to Slang to report', async () => {
  const slang = await loadSlang();

  try {
    slang.compile(`import nope;${CALLER}`, { path: '/miss/entry.slang', readFile: reader({}) });
    expect.unreachable('compile should have thrown');
  } catch (error) {
    expect(error).toBeInstanceOf(SlangCompileError);
    expect((error as SlangCompileError).diagnostics[0]).toMatchObject({
      severity: 'error',
      file: '/miss/entry.slang',
      line: 1,
      column: 8,
    });
    expect((error as SlangCompileError).message).toMatch(/nope\.slang/);
  }
});

test('recompiles when only a dependency changed', async () => {
  const slang = await loadSlang();
  const entry = `import util;${CALLER}`;

  const first = slang.compile(entry, {
    path: '/hot/entry.slang',
    readFile: reader({ '/hot/util.slang': 'public float helperFn(float v) { return v * 2.0; }' }),
  });
  const second = slang.compile(entry, {
    path: '/hot/entry.slang',
    readFile: reader({ '/hot/util.slang': 'public float helperFn(float v) { return v * 4.0; }' }),
  });

  expect(first.code).toMatch(/\* 2\.0f/);
  expect(second.code).toMatch(/\* 4\.0f/);
});

test('memoizes when neither the entry nor its dependencies changed', async () => {
  const slang = await loadSlang();
  const entry = `import util;${CALLER}`;
  const files = { '/memo2/util.slang': 'public float helperFn(float v) { return v * 6.0; }' };

  const first = slang.compile(entry, { path: '/memo2/entry.slang', readFile: reader(files) });
  const second = slang.compile(entry, { path: '/memo2/entry.slang', readFile: reader(files) });

  expect(second).toBe(first);
});

test('ignores references inside comments', async () => {
  const slang = await loadSlang();
  const result = slang.compile(`// import ghost;\n/* import phantom; */\nimport util;${CALLER}`, {
    path: '/cmt/entry.slang',
    readFile: reader({ '/cmt/util.slang': 'public float helperFn(float v) { return v * 41.0; }' }),
  });

  expect(result.code).toMatch(/\* 41\.0f/);
  expect(result.dependencies).toEqual(['/cmt/util.slang']);
});

test('reports no dependencies for a single-file shader', async () => {
  const slang = await loadSlang();
  const result = slang.compile(`float helperFn(float v) { return v; }${CALLER}`, { path: '/solo/entry.slang' });

  expect(result.dependencies).toEqual([]);
});

test('stops resolving a dependency once it is gone', async () => {
  const slang = await loadSlang();
  const files: Record<string, string> = { '/gone/util.slang': 'public float helperFn(float v) { return v * 23.0; }' };

  const first = slang.compile(`import util;${CALLER}`, { path: '/gone/entry.slang', readFile: reader(files) });
  expect(first.code).toMatch(/\* 23\.0f/);

  delete files['/gone/util.slang'];

  expect(() => slang.compile(`import util;${CALLER}`, { path: '/gone/entry.slang', readFile: reader(files) })).toThrow(
    SlangCompileError,
  );
});

test('normalizes a parent-relative reference from a relative entry path', async () => {
  const slang = await loadSlang();
  const result = slang.compile(`import "../common.slang";${CALLER}`, {
    path: 'norm/entry.slang',
    readFile: reader({ 'common.slang': 'public float helperFn(float v) { return v * 47.0; }' }),
  });

  expect(result.code).toMatch(/\* 47\.0f/);
  expect(result.dependencies).toEqual(['common.slang']);
});

test('resolves imports against a Windows-style entry path', async () => {
  const slang = await loadSlang();
  const result = slang.compile(`import util;${CALLER}`, {
    path: 'E:\\work\\shaders\\entry.slang',
    readFile: reader({ 'E:/work/shaders/util.slang': 'public float helperFn(float v) { return v * 43.0; }' }),
  });

  expect(result.code).toMatch(/\* 43\.0f/);
  expect(result.dependencies).toEqual(['E:/work/shaders/util.slang']);
});

test('never leaks the mount path into an error message', async () => {
  const slang = await loadSlang();

  try {
    slang.compile(`import util;${CALLER}`, {
      path: 'E:\\work\\shaders\\entry.slang',
      readFile: reader({ 'E:/work/shaders/util.slang': 'public float helperFn(float v) { return v * ; }' }),
    });
    expect.unreachable('compile should have thrown');
  } catch (error) {
    const { message, diagnostics } = error as SlangCompileError;
    expect(message).not.toMatch(/\/E:/);
    expect(message).toMatch(/E:\/work\/shaders\/util\.slang/);
    expect(diagnostics[0]).toMatchObject({ file: 'E:/work/shaders/util.slang' });
  }
});
