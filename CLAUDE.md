# slang-loader

Compiles [Slang](https://shader-slang.org/) shaders to WGSL at build time, wrapping the prebuilt
`slang-wasm` artifact from shader-slang's GitHub releases behind an
[unplugin](https://unplugin.unjs.io/) plugin.

Status: v0 against Slang 2026.14.1.

## Layout

```
src/index.ts       public API barrel  →  slang-loader
src/unplugin.ts    createUnplugin     →  slang-loader/unplugin
src/plugin.ts      the UnpluginFactory — the whole plugin, once
src/vendor.ts      where vendor/ is — must stay at src/ root, see below
src/bundlers/*.ts  two-line re-exports of slang.<target>  →  slang-loader/<target>
src/compiler/      session, wasm boot, diagnostics, embind types, the version pin
```

Targets: vite, rollup, rolldown, webpack, rspack, rsbuild, esbuild, farm, bun, unloader.

`tsdown` builds esm only, with an explicit name → path entry map so nesting the sources does not
nest `dist/`, and `deps.neverBundle: true` — nothing from `node_modules` is ever inlined. Without it
the dts pass resolves whatever happens to be installed and inlines it (rolldown ships inside tsdown:
~210 kB of type surface), and unplugin's optional bundler types make which packages those are depend
on the install tree, so an allowlist is the wrong shape.

`src/vendor.ts` holds the only path to the artifact. tsdown emits the literal
`new URL('../vendor/slang-wasm.js', import.meta.url)` verbatim into a chunk at `dist/` root, so that
one string has to resolve correctly from two places: the source file's directory under vitest, and
`dist/`. Both `src/` and `dist/` are one level below the package root, so `../vendor` satisfies both
— but only while the file stays at `src/` root. Move it into `src/compiler/` and the source tests
fail; "fix" the literal to `../../vendor` and they pass while the built package resolves above the
package root. `test/dist.test.ts` is what catches that second half.

`vitest` runs against `src/`, plus `test/dist.test.ts` against the build (skipped until
`npm run build` has run). `npm run fetch-wasm` populates the gitignored `vendor/`.

## Invariants

The ways this package fails badly. Non-negotiable.

- **The wasm binary is never committed to git.** Fetched from GitHub releases at prepublish and
  shipped inside the npm tarball. Never a postinstall download — that breaks offline and air-gapped
  installs.
- **The compiler must never reach a client bundle.** A 24 MB wasm compiler in someone's browser
  build is the reputational failure mode. A build-time dev dependency, documented as such; the wasm
  is reachable from exactly one module (`src/vendor.ts`), and a test pins that. A throwing
  `browser.ts` under a non-node `exports` condition was tried and cut — boilerplate on every entry
  to catch a mistake nobody was making, since only a bundler config imports this.
- **Never `.delete()` a Slang embind handle other than the `Session`.** Deleting a `Module`,
  `EntryPoint`, `ComponentType` or `ProgramLayout` corrupts compiler state and aborts the wasm
  (`RuntimeError: unreachable`) on a _later_ compile, far from the cause. The `Session` owns them.
- **Boot the wasm once and reuse the `GlobalSession`; create a `Session` per compile.** A `Session`
  caches modules by name and rejects edited source under a name it has seen
  (`E38202: module already loaded with different source`), so it cannot be reused. Boot +
  `createGlobalSession()` costs ~380 ms, `createSession()` ~0.1 ms, a small compile ~4 ms.
- **`compile()` returns `reflection` even though nothing consumes it.** Typegen is the eventual
  differentiator; keeping it in the return shape makes that additive rather than breaking.
- **The pinned version lives in one constant** (`src/compiler/version.ts`, version + sha256).
  Bumping is a one-line change plus `npm run fetch-wasm`.
- **Ship Slang's licence notices.** The binary is Apache-2.0 WITH LLVM-exception and vendors its own
  third-party components. `vendor/SLANG-LICENSE.txt` and `vendor/LICENSES/` go in the tarball; the
  LLVM exception does not waive attribution when redistributing the binary as-is.

## Verified facts about the wasm

Checked Aug 2026 against the shipped 2026.14.1 artifact, not from docs. Don't re-derive — but do
re-verify anything load-bearing after a version bump: Slang releases roughly monthly and its WGSL
backend is explicitly work-in-progress.

- **Reflection is fully available from wasm.** This was the question gating the project, and the
  answer is favourable — no shelling out to `slangc`. `ProgramLayout.toJsonObject()` returns
  `{ parameters, entryPoints, bindlessSpaceIndex }`, each entry point already carrying `name`,
  `stage`, `threadGroupSize` and typed `parameters`.
- **`getLastError()` is cleared on success**, so it can be read after a successful compile to
  collect warnings without picking up a stale failure.
- Errors carry a parseable location: `error[E20001]: <text>` then `--> /path.slang:LINE:COL`. That
  feeds the host's error overlay.
- `getCompileTargets()` returns `[{name, value}]`. WGSL is 28 — look it up by name anyway.
- The release ships two zips. `slang-<version>-wasm.zip` (~9.9 MB) is the one we want:
  `slang-wasm.js` (embind glue, ESM default factory export) plus `slang-wasm.wasm` (~24 MB
  unpacked). `-wasm-libs.zip` (~87 MB) is static archives for `emcc`, not usable here.
- The zip's `interface.d.ts` is the best reference for the embind surface, which is narrower than
  the C++ API; `src/compiler/types.ts` is a hand-written subset so a clean clone typechecks without
  `vendor/`. Prefer either over secondhand summaries.
- A full `LanguageServer` is exposed. Different product; out of scope.
- No `slang-wasm` package exists on npm, and upstream publishes the artifact only as a release
  asset. If that ever changes this package is unaffected — it pins and vendors rather than
  republishes, and the value is in the bundler integration and (later) typegen.

### The one real gap: dependency tracking

`IModule::getDependencyFileCount()` / `getDependencyFilePath()` exist in the C++ API but are **not
exposed through embind** — `Module` registers only the entry-point methods. Exposing them is a
two-line upstream PR (`Module` already holds the raw pointer via `moduleInterface()`) and is the one
planned upstream contribution, worth filing once this package is a concrete consumer.

Even then, [#5332](https://github.com/shader-slang/slang/issues/5332) reports relative paths for
shaders in `cwd` and hash-like strings rather than `nullptr` for modules loaded from **source
strings** — exactly where a bundler plugin lands. Expect to need own resolver bookkeeping for the
entry module. v0 sidesteps this with single-file shaders only. Preloading a module by name into a
`Session` does make `import thatName;` resolve, which is the seam a real resolver would use.

## Deliberately cut from v0

Don't add these back without a reason; each was cut for a specific one.

| Cut                              | Why                                                                                                                        |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Typegen / `.d.ts` sidecars       | The eventual differentiator, but v0.2. Reflection in the return shape keeps the door open.                                 |
| Multi-target (SPIR-V, MSL, GLSL) | Config plumbing, no learning. Slang's GLSL support is documented as "limited" and is not a viable WebGL path anyway.       |
| Persistent disk cache            | In-process memoization is free. Add when someone complains about CI.                                                       |
| HMR / dependency tracking        | Dodges both the missing embind methods and #5332. Single-file shaders only, documented as a known limit.                   |
| Runtime generic specialization   | Would mean shipping the compiler to the browser. Different product.                                                        |
| `LanguageServer` / editor tools  | Different product.                                                                                                         |
| Turbopack                        | Runs only a _subset_ of webpack loaders, and unplugin has no Turbopack target. Every other bundler now comes via unplugin. |

## Known hard parts

- **Virtual filesystem plumbing.** Slang's `import` wants files; wasm has none. Mount MEMFS or
  intercept resolution, and interoperate with virtual module ids (`\0` prefix). The fiddliest code
  in the project, and what the single-file limit defers.
- **Semver against a WIP backend.** WGSL codegen shifts upstream → generated output changes → patch
  or break? No clean answer. Pin, and mirror upstream's version.

## Open questions

- Does a Vite dev server keep a single `GlobalSession` warm across HMR cycles, or is teardown beyond
  `closeBundle` needed?
- Teardown is uneven across unplugin targets. `closeBundle` is wired through the `vite`, `rollup`,
  `rolldown` and `unloader` escape hatches because unplugin's shared hooks don't fit: `buildEnd`
  fires on every watch rebuild (re-paying the ~380 ms boot) and `writeBundle` fires per output.
  webpack/Rspack could use `compiler.hooks.shutdown` if it turns out to matter. `closeBundle` also
  fires per rebuild under `rollup -w` / `vite build --watch`, so watch mode re-pays that boot anyway
  — the same objection that ruled out `buildEnd`, unresolved.
- `disposeSlang()` tears down a module-global singleton, but `closeBundle` is per build. Two plugin
  instances, or two builds in one process, means the first teardown disposes a compiler the second
  is still using. Refcount, or scope the compiler to the plugin instance.
- Nothing has run the webpack/Rspack path, where unplugin routes `transform` through a loader.
  Whether the booted wasm and cached `GlobalSession` are shared across files there is assumed.
- How should multi-entry-point modules map to ES exports? Slang emits one WGSL module containing
  every entry point, so a named export each would repeat the same string or need a `{ code, name }`
  wrapper, and would collide with `entryPoints` / `reflection`. Default export is the WGSL for now;
  settle it with the typegen design. Additive either way.

## Working style

- **No code comments** unless explicitly asked. When one is warranted it explains _why_, never
  _what_.
- Module-level functions use `function foo()`, not arrow consts. Inline callbacks stay arrows.
- Relative imports carry explicit `.ts` extensions, so `node src/index.ts` runs the sources directly
  under type stripping. `erasableSyntaxOnly` keeps that possible — no enums, namespaces or parameter
  properties. Bundlers resolve `.ts` fine and `dist/` carries no `.ts` specifier.
- **Search the internet for current documentation** rather than relying on training data. Slang,
  WGSL, WebGPU and Emscripten/embind all move fast.
- For one-shot bulk work, produce the files directly — don't commit a generator script.
- For open-ended design decisions, give a real recommendation and discuss one decision at a time.
- Python, if it comes up: `uv run` with PEP 723 inline `# /// script` metadata. Never `pip install`.
