# slang-loader

[![CI](https://github.com/AbdBarho/slang-loader/actions/workflows/ci.yml/badge.svg)](https://github.com/AbdBarho/slang-loader/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/slang-loader)](https://www.npmjs.com/package/slang-loader)

Compile [Slang](https://shader-slang.org/) shaders to WGSL at build time. Supports Vite, Rollup,
Rolldown, webpack, Rspack, Rsbuild, esbuild, Farm, Bun and unloader.

Uses Slang 2026.14.1.

## Install

```sh
npm install -D slang-loader
```

## Setup

Import the entry point for your bundler:

```js
// vite.config.js
import slang from 'slang-loader/vite';

export default { plugins: [slang()] };
```

The same plugin is available from `slang-loader/rollup`, `slang-loader/rolldown`,
`slang-loader/webpack`, `slang-loader/rspack`, `slang-loader/rsbuild`, `slang-loader/esbuild`,
`slang-loader/farm`, `slang-loader/bun` and `slang-loader/unloader`.

`slang-loader/unplugin` exports the raw unplugin instance.

## Usage

```js
import wgsl, { entryPoints, reflection } from './scene.slang';

device.createShaderModule({ code: wgsl });
```

Each shader module exports:

- Default: generated WGSL code.
- `entryPoints`: names, stages and compute workgroup sizes.
- `reflection`: Slang's full reflection object.

See [`example/`](./example) for a runnable WebGPU example.

## Options

The `slang()` setup above works without configuration. All options are optional:

- `include`: unplugin filter pattern; defaults to `.slang` files.
- `exclude`: unplugin filter pattern added to the built-in passthrough exclusions.
- `types`: generate TypeScript sidecars for `.slang` files; defaults to `true`.

Custom `include` extensions are compiled but do not generate sidecars. The plugin leaves `?raw`,
`?url` and `?inline` imports to the bundler.

## TypeScript

Successful builds generate `*.slang.d.ts` sidecars with literal entry point names, workgroup sizes
and the full reflection type:

```ts
import { entryPoints } from './scene.slang';

entryPoints[0].name; // "computeMain"
entryPoints[0].workgroupSize; // [16, 16, 1]
```

Ignore generated sidecars when formatting:

- `.prettierignore`: `*.slang.d.ts` to skip formatting

Then choose one:

- `.gitignore`: `*.slang.d.ts` if sidecars are not committed
- `.gitattributes`: `*.slang.d.ts linguist-generated` if sidecars are committed

For files that have not been compiled yet, or when using `moduleResolution: nodenext`, add a fallback
to an environment declaration file such as `vite-env.d.ts`:

```ts
declare module '*.slang' {
  export { default } from 'slang-loader/module';
  export * from 'slang-loader/module';
}
```

The extension pattern is consumer-owned. Set `types: false` to disable sidecar generation.

## Multi-file Shaders

Slang `import`, `__include` and `#include` references resolve relative to the importing file.
Dependencies are watched by supported bundlers, so editing one rebuilds its importing shaders.

```hlsl
// scene.slang
import scene.sdf; // scene/sdf.slang

// scene/sdf.slang
public float smoothUnion(float a, float b, float k) { /* ... */ }
```

Imported symbols should be `public`. Search paths such as `-I` are not supported by the wasm API, so
references must resolve relative to their importer.

## Programmatic API

```js
import { loadSlang } from 'slang-loader';

const slang = await loadSlang();
const result = slang.compile(source, { path: '/blur.slang' });
```

`result` contains `code`, `entryPoints`, `reflection`, `diagnostics` and `dependencies`. The `path`
option controls relative dependency resolution; `readFile` can provide dependencies from another
source.

## Licence

The package source is MIT. The distributed Slang compiler is Apache-2.0 WITH LLVM-exception and
ships with its required licence notices. See [`LICENSE`](./LICENSE).
