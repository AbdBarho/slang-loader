# slang-loader

Compiles [Slang](https://shader-slang.org/) shaders to WGSL at build time, wrapping the prebuilt
`slang-wasm` artifact from shader-slang's GitHub releases behind an
[unplugin](https://unplugin.unjs.io/) plugin.

Status: v0 against Slang 2026.14.1.

## Layout

`tsdown.config.ts` uses an explicit name → path entry map so nesting the sources does not nest
`dist/`. `deps.neverBundle: true` is load-bearing: without it the dts pass resolves whatever happens
to be installed and inlines it (rolldown ships inside tsdown), and unplugin's optional bundler types
make which packages those are depend on the install tree, so an allowlist is the wrong shape.

`src/vendor.ts` holds the only path to the artifact. tsdown emits the literal
`new URL('../vendor/slang-wasm.js', import.meta.url)` verbatim into a chunk at `dist/` root, so that
one string has to resolve correctly from two places: the source file's directory under vitest, and
`dist/`. Both `src/` and `dist/` are one level below the package root, so `../vendor` satisfies both
— but only while the file stays at `src/` root. Move it into `src/compiler/` and the source tests
fail; "fix" the literal to `../../vendor` and they pass while the built package resolves above the
package root. `test/dist.test.ts` is what catches that second half.

`vitest` runs against `src/`, plus `test/dist.test.ts` against the build (skipped until
`npm run build` has run). `npm run fetch-wasm` populates the gitignored `vendor/`.

Dependency edits reach the bundler through `this.addWatchFile`, which unplugin normalises everywhere
except Bun (a no-op). On Vite it also inserts a module-graph edge, so HMR propagates without a
`handleHotUpdate` — verified end to end against a dev server, not just the unit test's fake context.

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
  `createGlobalSession()` is the only expensive step; `createSession()` and a compile are negligible
  beside it.
- **`compile()` returns `reflection` even though nothing consumes it.** Typegen is the eventual
  differentiator; keeping it in the return shape makes that additive rather than breaking.
- **Stage dependencies into MEMFS per compile, and unstage them in the same `finally` as
  `session.delete()`.** MEMFS outlives the `Session`, so a file left behind is a ghost: delete an
  imported shader and the next compile still succeeds against the stale copy while reporting no
  dependency on it — wrong output _and_ a file the bundler has stopped watching.
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
- `getCompileTargets()` returns `[{name, value}]`. The WGSL value is unstable across releases — look
  it up by name.
- The release ships two zips. `slang-<version>-wasm.zip` is the one we want: `slang-wasm.js` (embind
  glue, ESM default factory export) plus `slang-wasm.wasm` (~24 MB unpacked). `-wasm-libs.zip` is
  static archives for `emcc`, not usable here.
- **The Emscripten `FS` is exported (`-sEXPORTED_RUNTIME_METHODS=['FS']`) and is the whole multi-file
  story** — the Playground uses it the same way. Write a file where Slang will look and `import`,
  `__include` and `#include` all resolve natively: absolute → relative to the _importing_ file →
  search paths, with `.` → `/` and `_` → `-` on dotted names. Verified per mechanism, plus transitive
  imports, `/E:/…` mount paths and overwrite-then-recompile.
- **Search paths and `ISlangFileSystem` are not reachable from wasm** — `createSession` builds its
  `SessionDesc` internally and never sets `searchPaths`. No `-I` equivalent; MEMFS is the only lever.
- **`import` crosses a module boundary, and `internal` (the default) does not cross it** (`E30600`).
  Unannotated helpers work only via legacy mode — no `module` declaration, no `__include`, no
  visibility modifier anywhere in the file — which upstream has flagged for deprecation.
- **Circular `import` is an error (`E38200`); circular `__include` is legal.** The resolver walks the
  graph itself, so it has to terminate on both regardless.
- The zip's `interface.d.ts` is the best reference for the embind surface, which is narrower than
  the C++ API; `src/compiler/types.ts` is a hand-written subset so a clean clone typechecks without
  `vendor/`. Prefer either over secondhand summaries.
- No `slang-wasm` package exists on npm; upstream publishes the artifact only as a release asset.

### Why the resolver scans source instead of asking the compiler

`IModule::getDependencyFileCount()` / `getDependencyFilePath()` are **not exposed through embind**, so
nothing can ask a compiled module what it read — and the files have to be staged _before_ the compile
anyway. Hence `src/compiler/resolve.ts`.

It is a **staging heuristic, not a resolver**. Slang does the real resolution once the files exist, so
over-staging is free (preprocessor-disabled branches get staged; harmless) and an unresolvable
reference is deliberately left alone — Slang's own `E00001` names the file with the right line and
column, and a hand-rolled error would only diverge from it.

Exposing those two methods is still a worthwhile two-line upstream PR, but would only partly retire
the scanner: [#5332](https://github.com/shader-slang/slang/issues/5332) reports hash-like strings
rather than paths for modules loaded from source strings, which is exactly how the entry is loaded.

Preloading by name into a `Session` was the original plan; MEMFS beat it by covering `__include` and
`#include` too, and by keying on path rather than on the name's spelling — Slang carries a TODO about
two `util.slang` files in different directories fighting over the bare name in that cache.

## Deliberately cut from v0

Don't add these back without a reason; each was cut for a specific one.

| Cut                              | Why                                                                                                                        |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Typegen / `.d.ts` sidecars       | The eventual differentiator, but v0.2. Reflection in the return shape keeps the door open.                                 |
| Multi-target (SPIR-V, MSL, GLSL) | Config plumbing, no learning. Slang's GLSL support is documented as "limited" and is not a viable WebGL path anyway.       |
| Persistent disk cache            | In-process memoization is free. Add when someone complains about CI.                                                       |
| `includePaths` / `-I` option     | Not reachable from wasm; faking it means staging library files into the importer's directory.                              |
| Runtime generic specialization   | Would mean shipping the compiler to the browser. Different product.                                                        |
| `LanguageServer` / editor tools  | Different product.                                                                                                         |
| Turbopack                        | Runs only a _subset_ of webpack loaders, and unplugin has no Turbopack target. Every other bundler now comes via unplugin. |

## Known hard parts

- **Path mapping between the host and MEMFS.** MEMFS is POSIX, the host may not be: `E:\a\b.slang`
  mounts at `/E:/a/b.slang`, preserving relative structure so Slang resolves as it would on disk. The
  mapping has to be reversed on the way out — diagnostics and error text name the mount path, and
  handing that to a bundler points the error overlay at a file the user does not have. `compileOnce`
  keeps a per-compile mount → real map. Virtual module ids (`\0` prefix) have no path to mount at all;
  untried.
- **Semver against a WIP backend.** WGSL codegen shifts upstream → generated output changes → patch
  or break? No clean answer. Pin, and mirror upstream's version.

## Open questions

- Does a Vite dev server keep a single `GlobalSession` warm across HMR cycles, or is teardown beyond
  `closeBundle` needed?
- Teardown is uneven across unplugin targets. `closeBundle` is wired through the `vite`, `rollup`,
  `rolldown` and `unloader` escape hatches because unplugin's shared hooks don't fit: `buildEnd`
  fires on every watch rebuild (re-paying the boot) and `writeBundle` fires per output.
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

- **Test first.** Write the failing test, watch it fail, then make it pass. The bugs this project
  actually hits surface far from their cause — a deleted embind handle aborts a _later_ compile, a
  "fixed" `../vendor` literal passes under vitest and breaks the published package — so a test
  written after the fact tends to encode the bug rather than catch it. The loop is cheap once the
  wasm has booted.
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
