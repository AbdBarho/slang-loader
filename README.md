# slang-loader

[![CI](https://github.com/AbdBarho/slang-loader/actions/workflows/ci.yml/badge.svg)](https://github.com/AbdBarho/slang-loader/actions/workflows/ci.yml)

Compile [Slang](https://shader-slang.org/) shaders to WGSL at build time. It runs under Vite, Rollup,
Rolldown, webpack, Rspack, Rsbuild, esbuild, Farm, Bun and unloader.

For now, it's pinned to **Slang 2026.14.1**.

## Install

```sh
npm install -D slang-loader
```

## Bundler

Import the entry point matching your bundler; every one takes the same options and behaves the same.

```js
// vite.config.js
import slang from 'slang-loader/vite';

export default { plugins: [slang()] };
```

<details>
<summary>Rollup, Rolldown, webpack, Rspack, Rsbuild, esbuild, Farm, Bun, unloader</summary>

```js
// rollup.config.js — same for slang-loader/rolldown and slang-loader/unloader
import slang from 'slang-loader/rollup';
export default { plugins: [slang()] };
```

```js
// webpack.config.js — same for slang-loader/rspack
const slang = require('slang-loader/webpack').default;
module.exports = { plugins: [slang()] };
```

```js
// esbuild — same shape for slang-loader/bun
import slang from 'slang-loader/esbuild';
await esbuild.build({ plugins: [slang()] });
```

```js
// rsbuild.config.js
import slang from 'slang-loader/rsbuild';
export default { plugins: [slang()] };
```

`slang-loader/unplugin` exports the raw unplugin instance if you need `.raw` or a target not listed
above.

</details>

## Usage

```js
import wgsl, { entryPoints, reflection } from './scene.slang';

device.createShaderModule({ code: wgsl });
// entryPoints → [{ name: 'vertexMain', stage: 'vertex', workgroupSize: null },
//                { name: 'fragmentMain', stage: 'fragment', workgroupSize: null }]
```

A `.slang` module exports the generated WGSL as its default export, plus `entryPoints` and the full
`reflection` object. Compile errors carry the offending file, line and column, so the host renders
them in its own error format — the Vite overlay, a webpack build error, and so on.

Both `include` and `exclude` accept anything unplugin's id filters accept (a string glob, a regular
expression, or an array of either). `include` defaults to `.slang` files, and whatever you pass to
`exclude` is added to the built-in skip list for `?raw`, `?url`, `?worker` and `?inline` rather than
replacing it.

See [`example/`](./example) for a runnable WebGPU render pipeline.

## Multi-file shaders

`import`, `__include` and `#include` all resolve against the filesystem, so a shader can be split
across files:

```hlsl
// scene.slang
import scene.sdf;                 // → scene/sdf.slang

// scene/sdf.slang
public float smoothUnion(float a, float b, float k) { /* … */ }
```

Resolution follows Slang's own rules — **relative to the importing file**, with `.` becoming a
directory separator and `_` becoming `-`, so `import lib.color_grade;` finds `lib/color-grade.slang`.
Quoted forms (`import "shared/util.slang";`, `#include "common.slang"`) work too.

Two things to know:

- **`import` crosses a module boundary, so symbols must be `public`.** Slang's legacy mode makes
  everything public in a file that has no `module` declaration, no `__include` and no visibility
  modifiers — which is why plain sibling files often import with no annotation — but upstream flags
  that mode for eventual deprecation, so prefer marking exports `public`. Use `__include` (with
  `module` / `implementing` declarations) when the files are really one module rather than a library.
- **No `-I` search paths.** The wasm build does not expose them, so every reference has to resolve
  relative to the file that makes it.

Imported files are registered with the bundler, so editing a dependency rebuilds the shaders that
use it. That works on Vite, Rollup, Rolldown, webpack, Rspack, Rsbuild and Farm; Bun's unplugin
target discards watch files, so dependency edits are missed there.

## Programmatic

```js
import { loadSlang } from 'slang-loader';

const slang = await loadSlang();
const { code, entryPoints, reflection, diagnostics, dependencies } = slang.compile(source, {
  path: '/blur.slang',
});
```

`path` is what imports resolve against, and `dependencies` lists the files that were pulled in. Pass
`readFile` to resolve them from somewhere other than disk.

`loadSlang()` boots the wasm once and caches it for the lifetime of the process; every subsequent
`compile()` reuses the same `GlobalSession`. Compilation itself is a few milliseconds.

## v0 limits

- **No typegen.** `reflection` is returned but nothing consumes it yet; generating typed uniform
  structs from it — so that a GPU-side rename becomes a compile error on the CPU side — is the
  planned next step, and the reason `reflection` is in the return shape already.
- **No automatic teardown outside the Rollup family.** Vite, Rollup, Rolldown and unloader dispose
  the compiler on `closeBundle`. The others have no once-per-run hook that a watch rebuild does not
  also fire, so the compiler lives until the process exits — call `disposeSlang()` yourself if you
  are running builds inside a long-lived process.

## Development

```sh
npm install
npm run fetch-wasm   # downloads and checksums the pinned artifact into vendor/
npm test             # vitest, against src/ (plus dist/, once built)
npm run build        # tsdown → dist/
```

## Bumping Slang

`SLANG_VERSION` and `SLANG_WASM_SHA256` in [`src/compiler/version.ts`](./src/compiler/version.ts) are the
only things to change, then `npm run fetch-wasm`.

## Licence

This package's own source is MIT. `vendor/` holds an unmodified redistribution of the prebuilt
Slang compiler, which is Apache-2.0 WITH LLVM-exception; its notice, the full Apache 2.0 text, and
the licence texts of Slang's own bundled third-party components ship alongside it. See
[`LICENSE`](./LICENSE).
