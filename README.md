# slang-loader

Compile [Slang](https://shader-slang.org/) shaders to WGSL at build time. Ships the prebuilt
`slang-wasm` compiler from shader-slang's GitHub releases, with a Vite plugin on top.

For now, its pinned to **Slang 2026.14.1**.

## Install

```sh
npm install -D slang-loader
```

## Vite

```js
// vite.config.js
import slang from 'slang-loader/vite';

export default { plugins: [slang()] };
```

```js
import wgsl, { entryPoints, reflection } from './scene.slang';

device.createShaderModule({ code: wgsl });
// entryPoints → [{ name: 'vertexMain', stage: 'vertex', workgroupSize: null },
//                { name: 'fragmentMain', stage: 'fragment', workgroupSize: null }]
```

A `.slang` module exports the generated WGSL as its default export, plus `entryPoints` and the full
`reflection` object. Compile errors surface in the Vite overlay pointing at the offending line.

See [`example/`](./example) for a runnable WebGPU render pipeline — a raymarched scene written in
Slang, compiled to WGSL by the plugin, drawn fullscreen.

## Programmatic

```js
import { loadSlang } from 'slang-loader';

const slang = await loadSlang();
const { code, entryPoints, reflection, diagnostics } = slang.compile(source, {
  path: '/blur.slang',
});
```

`loadSlang()` boots the wasm once and caches it for the lifetime of the process; every subsequent
`compile()` reuses the same `GlobalSession`. Compilation itself is a few milliseconds.

## v0 limits

- **WGSL only.** No SPIR-V, MSL, GLSL.
- **Single-file shaders.** `import` of sibling `.slang` files is not resolved yet, so there is no
  dependency tracking and no HMR beyond the edited file itself.
- **No typegen.** `reflection` is returned but nothing consumes it yet; generating typed uniform
  structs from it — so that a GPU-side rename becomes a compile error on the CPU side — is the
  planned next step, and the reason `reflection` is in the return shape already.
- **Vite only.** The core API is bundler-agnostic; other bundlers come once it has proven itself.

## Development

```sh
npm install
npm run fetch-wasm   # downloads and checksums the pinned artifact into vendor/
npm test             # vitest, against src/
npm run build        # tsdown → dist/
```

## Bumping Slang

`SLANG_VERSION` and `SLANG_WASM_SHA256` in [`src/slang-version.ts`](./src/slang-version.ts) are the
only things to change, then `npm run fetch-wasm`.

## Licence

This package's own source is MIT. `vendor/` holds an unmodified redistribution of the prebuilt
Slang compiler, which is Apache-2.0 WITH LLVM-exception; its notice, the full Apache 2.0 text, and
the licence texts of Slang's own bundled third-party components ship alongside it. See
[`LICENSE`](./LICENSE).
