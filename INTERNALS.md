# Internals

Implementation notes for maintainers and agents. Consumer documentation belongs in `README.md`;
working instructions belong in `CLAUDE.md`.

## Architecture

`slang-loader` wraps the prebuilt `slang-wasm` release artifact behind an unplugin transform. The
compiler runs only during builds and emits WGSL modules with entry point metadata and reflection.

`tsdown.config.ts` uses an explicit entry map so nested source paths do not nest `dist/` outputs.
`deps.neverBundle: true` is load-bearing: declaration generation otherwise resolves and inlines
optional bundler types according to the local install tree.

`src/vendor.ts` is the only module that locates the artifact. Its literal
`new URL('../vendor/slang-wasm.js', import.meta.url)` must resolve from both `src/` during source tests
and a root-level `dist/` chunk after building. Keep the file at `src/` root. `src/dist.test.ts`
checks the built-package half of this constraint.

Vitest normally runs against `src/`; `src/dist.test.ts` runs against a prior build. `npm run
fetch-wasm` downloads the pinned, gitignored artifact into `vendor/`.

## Invariants

- Never commit the wasm binary. Fetch it before publishing and ship it in the npm tarball; never use
  a postinstall download.
- Never allow the compiler into a client bundle. It is a build-time development dependency, and the
  wasm is reachable only through `src/vendor.ts`.
- Never call `.delete()` on a Slang embind handle other than `Session`. The session owns modules,
  entry points, component types and layouts; deleting them corrupts compiler state and causes a later
  wasm abort.
- Boot wasm once and reuse `GlobalSession`, but create and delete a `Session` for every compile. A
  reused session rejects edited source loaded under the same module name.
- Stage dependencies in MEMFS for each compile and unstage them in the same `finally` block as
  `session.delete()`. MEMFS outlives sessions, so stale files otherwise produce incorrect successful
  compiles and missing watch dependencies.
- A missing generated shader declaration must never fail TypeScript. Consumers own their ambient
  extension patterns and re-export the generic contract from `slang-loader/module`.
- Only overwrite or remove a declaration whose first line contains `MARKER`. Handwritten declarations
  must survive plugin adoption, rebuilds and shader deletion.
- Treat watcher delete events as hints. Confirm that the shader is absent before removing its
  declaration because atomic saves and branch switches can report delete then add.
- Sidecar cleanup must be extension-agnostic because `include` is configurable.
- Keep the pinned Slang version and checksum together in `src/compiler/version.ts`.
- Ship Slang's Apache-2.0 WITH LLVM-exception notice and its bundled third-party licence texts.

## Compiler Lifecycle

The expensive operation is wasm boot plus `createGlobalSession()`. `createSession()` and individual
compiles are comparatively cheap. A session caches modules by name, so session reuse causes
`E38202: module already loaded with different source` after edits.

Teardown is wired to `closeBundle` for Vite, Rollup, Rolldown and unloader. Shared unplugin hooks are
not suitable: `buildEnd` runs on every watch rebuild and `writeBundle` can run once per output.
Other targets currently retain the compiler until process exit.

## Dependency Resolution

The wasm bindings do not expose `IModule::getDependencyFileCount()` or
`IModule::getDependencyFilePath()`, and dependencies must be staged before compilation. Therefore
`src/compiler/resolve.ts` scans source to build a candidate graph.

The scanner is a staging heuristic, not the final resolver. It may over-stage references in disabled
preprocessor branches. Unresolved references are left for Slang so diagnostics retain the correct
file, line and column.

MEMFS covers `import`, `__include` and `#include`. Slang resolves absolute paths, then paths relative
to the importer, then search paths; dotted module names map `.` to `/` and `_` to `-`. Search paths
and `ISlangFileSystem` are not exposed through wasm, so there is no real `-I` implementation.

Dependency paths are passed to `this.addWatchFile`. Unplugin normalizes this for supported targets,
but Bun currently treats it as a no-op. Vite uses the resulting module graph edge for HMR without a
custom `handleHotUpdate` hook.

## Host And MEMFS Paths

MEMFS uses POSIX paths even on Windows. For example, `E:\a\b.slang` mounts at `/E:/a/b.slang` while
preserving relative structure. Each compile tracks mount-to-host mappings so diagnostics point to
real host files rather than MEMFS paths. Virtual module ids beginning with `\0` have no mountable
host path and remain untested for compilation.

## Verified Wasm Behavior

These facts were verified against Slang 2026.14.1 in August 2026. Re-check load-bearing behavior on
every version bump because Slang releases frequently and WGSL code generation is still evolving.

- `ProgramLayout.toJsonObject()` exposes full reflection, including `parameters`, `entryPoints` and
  `bindlessSpaceIndex`.
- `getLastError()` clears after success, so successful compiles can safely collect warnings.
- Errors use `error[E20001]: ...` followed by `--> /path.slang:LINE:COL`.
- `getCompileTargets()` returns `{ name, value }` objects. The WGSL numeric value is not stable; look
  it up by name.
- The required release asset is `slang-<version>-wasm.zip`, containing ESM embind glue and wasm. The
  `-wasm-libs.zip` asset contains static archives and is not usable here.
- Emscripten `FS` is exported and is the mechanism for multi-file compilation.
- `import` crosses a module boundary, and internal symbols do not cross it. Slang's permissive legacy
  mode is deprecated upstream.
- Circular `import` is an error; circular `__include` is legal. Graph traversal must terminate for
  either form.
- `vendor/interface.d.ts` is the best reference for the exposed embind API. `src/compiler/types.ts`
  contains the subset needed by this project so clean clones typecheck without `vendor/`.
- No `slang-wasm` npm package exists; upstream publishes only release assets.

## Type Generation

Each successful writable shader compile generates `<shader>.d.ts` with a literal tuple describing
entry point names, stages and workgroup sizes, plus the full JSON reflection as a literal TypeScript
type. JSON syntax is valid in a TypeScript type position, so no separate reflection schema is needed.

`src/module.d.ts` supplies a generic module contract without choosing ambient extension patterns for the
consumer. A consumer declaration re-exports its default explicitly and its named exports with
`export *`; a real sidecar wins under `moduleResolution: bundler`, while `nodenext` falls back to the
ambient declaration. Pattern ambient modules allow one `*`, so query forms need separate patterns
and combined query forms cannot be represented generally.

The ambient declarations must not reference DOM-only types because Node consumers may load them with
`lib: ["ESNext"]` and `skipLibCheck: false`.

Generated entry points are a tuple while the fallback exposes `SlangEntryPoint[]`. This intentionally
preserves per-index literals, but code can typecheck differently before and after sidecar generation.

Sidecar writes use a temporary file and rename, skip unchanged content, avoid virtual modules,
custom extensions and `node_modules`, and warn rather than fail compilation on filesystem errors.
Only `ENOENT` means an existing declaration is absent; other read failures must stop the write before
creating a staging file. Watch deletion cleanup only removes marker-owned files after confirming the
shader is gone.

## Deliberately Excluded

| Feature                  | Reason                                                                                        |
| ------------------------ | --------------------------------------------------------------------------------------------- |
| Multiple output targets  | Additional configuration without a demonstrated use case; Slang's GLSL support is limited.    |
| Persistent disk cache    | In-process memoization is sufficient until build performance proves otherwise.                |
| Include paths            | Not exposed by the wasm API; emulation would alter resolution semantics.                      |
| Runtime specialization   | Would require shipping the compiler to the browser.                                           |
| Language server features | Separate product scope.                                                                       |
| Turbopack                | Unplugin has no Turbopack target, and Turbopack supports only part of webpack's loader model. |

## Open Questions

- Does Vite preserve the module-level `GlobalSession` across all HMR lifecycle paths?
- Should compiler ownership be reference-counted or scoped per plugin instance? Two concurrent builds
  can currently share a singleton that one build disposes first.
- Should webpack and Rspack hook compiler teardown into their shutdown lifecycle?
- Does webpack/Rspack loader execution share the booted wasm instance across transformed files?
- How should multiple Slang entry points map to ES exports? The current default export contains one
  WGSL module with every entry point.
- How should upstream WGSL codegen changes affect package semver?
