# slang-loader

An npm package that compiles [Slang](https://shader-slang.org/) shaders to WGSL at build time,
wrapping the prebuilt `slang-wasm` artifact from shader-slang's GitHub releases, with a Vite
plugin on top.

Status: v0 implemented against Slang 2026.14.1.

## Shape

One package, two entry points:

```
slang-loader        → { loadSlang, compile }   build-time / node only
slang-loader/vite   → default export plugin
```

Built with `tsdown` (esm only), tested with `vitest` against `src/`. `npm run fetch-wasm` populates
the gitignored `vendor/` directory.

## Invariants

These are the ways this package fails badly. Treat them as non-negotiable.

- **The wasm binary is never committed to git.** ~10 MB zipped, and it would be in the history
  forever. It is fetched from GitHub releases at prepublish and shipped inside the npm tarball.
  Never a postinstall download — that breaks offline installs and air-gapped CI.
- **The compiler must never reach a client bundle.** A 24 MB wasm compiler leaking into someone's
  browser build is the reputational failure mode. Strict node-only `exports` conditions, and a
  test that asserts it.
- **Boot the wasm once per build and reuse the `GlobalSession`.** Booting per file is fatal to
  build times. A `Session`, by contrast, is per-compile — it caches modules by name and rejects
  edited source otherwise.
- **Never `.delete()` a Slang embind handle other than the `Session`.** It aborts the wasm on a
  later compile, far from the cause.
- **`compile()` returns `reflection` even while nothing consumes it.** Typegen is the eventual
  differentiator; keeping reflection in the return shape from day one makes it additive rather
  than a breaking change.
- **The pinned Slang version lives in one constant** (`src/slang-version.ts`, version + sha256).
  Bumping it should be a one-line change followed by `npm run fetch-wasm`.
- **Ship Slang's licence notices.** The bundled binary is Apache-2.0 WITH LLVM-exception, and its
  vendored third-party components (glslang, lz4, miniz, spirv-headers, spirv-tools, LLVM) have
  their own terms. `vendor/SLANG-LICENSE.txt` and `vendor/LICENSES/` go in the tarball; do not
  assume the LLVM exception waives attribution, because we redistribute the binary as-is.

## Verified facts about the wasm

Verified Aug 2026 against the shipped 2026.14.1 artifact, not from docs. Do not re-derive this —
but do re-verify anything load-bearing after a version bump, because Slang releases roughly
monthly and its WGSL backend is explicitly work-in-progress.

### Behaviour that cost real debugging time

- **Never call `.delete()` on a Slang embind handle.** Deleting a `Module`, `EntryPoint`,
  `ComponentType` or `ProgramLayout` corrupts compiler state and aborts the wasm
  (`RuntimeError: unreachable`) on a _later_ compile, not on the delete itself. The `Session` owns
  them; deleting the session is safe and is the only cleanup we do.
- **A `Session` caches modules by name.** Reloading edited source under a name the session has
  already seen fails with `E38202: module already loaded with different source`. So the reusable
  unit is the `GlobalSession`, not the `Session`: boot the wasm once, then create a throwaway
  `Session` per `compile()`. Session creation costs ~0.1 ms; wasm boot plus `createGlobalSession()`
  costs ~380 ms, and a small compile ~4 ms.
- **`getLastError()` is cleared on success**, so it can be read after a successful compile to
  collect warnings without picking up a stale message from an earlier failure.

### Surface

The release ships two wasm assets. `slang-<version>-wasm.zip` (~9.9 MB) is the one we want:
`slang-wasm.js` (embind glue, ESM with a default factory export) plus `slang-wasm.wasm` (~24 MB
unpacked). `slang-<version>-wasm-libs.zip` (~87 MB) is static archives for linking Slang into a
C++ app with `emcc` — no JavaScript, not usable here.

The zip also contains an `interface.d.ts` describing the whole embind surface. It is the best
available reference; we keep a hand-written subset in `src/wasm-types.ts` so a clean clone
typechecks without `vendor/` present. Prefer it, or the bindings source
(`source/slang-wasm/slang-wasm-bindings.cpp`, `source/slang-wasm/slang-wasm.h` on `master`), over
secondhand summaries — the embind surface is narrower than the C++ API and the difference matters.

**Reflection is fully available from wasm** — this was the open question that gated the whole
project, and the answer is favourable. No need to shell out to `slangc`.
`ProgramLayout.toJsonObject()` returns `{ parameters, entryPoints, bindlessSpaceIndex }`, where each
entry point already has `name`, `stage`, `threadGroupSize` and typed `parameters` — so `entryPoints`
in the return value needs no extra reflection calls, and typegen has everything it needs.

Error messages carry a parseable location: `error[E20001]: <text>` followed by
`--> /path.slang:LINE:COL`, which is what feeds the Vite overlay.

`getCompileTargets()` returns `[{name, value}]`; WGSL is 28, but look it up by name rather than
hardcoding.

A full `LanguageServer` (LSP) is exposed too. Different product; out of scope.

### The one real gap: dependency tracking

`Module` registers only `findEntryPointByName`, `findAndCheckEntryPoint`, `getDefinedEntryPoint`,
`getDefinedEntryPointCount`. `IModule::getDependencyFileCount()` / `getDependencyFilePath()` exist
in the C++ API but are **not exposed through embind** — narrower than "depfile is CLI-only", the
capability is there, just unsurfaced. Exposing them is a small upstream PR (two `.function(...)`
lines; `Module` already holds the raw pointer via `moduleInterface()`), and is the one planned
upstream contribution — worth filing once this package is a concrete consumer justifying the ask.

Even after exposure,
[issue #5332](https://github.com/shader-slang/slang/issues/5332) reports `getDependencyFilePath`
returning relative paths for shaders in `cwd`, and hash-like strings rather than `nullptr` for
modules loaded from **source strings** — exactly the case a bundler plugin lands in. Expect to need
own resolver-callback bookkeeping for the entry module, with the API's list covering transitively
loaded files. v0 sidesteps this by supporting single-file shaders only.

Preloading a module by name into a `Session` does make `import thatName;` resolve, which is the
seam a real resolver would use.

### Distribution

No `slang-wasm` package exists on npm under any namespace, and no open issue requests one. Upstream
builds the artifact in CI every release but only publishes it as a GitHub release asset — so every
JS consumer, including `slang-playground` itself, unpacks the zip by hand.

If upstream ever publishes to npm, this package is unaffected: it pins and vendors the artifact
rather than republishing it, and the value lives in the bundler integration and (later) typegen,
which upstream will not build.

## Deliberately cut from v0

Do not add these back without a reason; each was cut for a specific one.

| Cut                               | Why                                                                                                                                                                                                                                                                                                                    |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Typegen / `.d.ts` sidecars        | The eventual differentiator, but v0.2. Reflection in the return shape keeps the door open.                                                                                                                                                                                                                             |
| Multi-target (SPIR-V, MSL, GLSL)  | Config plumbing, no learning. Note Slang's GLSL/OpenGL support is documented as "limited" and is not a viable WebGL path anyway.                                                                                                                                                                                       |
| Persistent disk cache             | In-process memoization only (free). Add when someone complains about CI.                                                                                                                                                                                                                                               |
| HMR / dependency tracking         | Dodges both the missing embind methods and #5332. Single-file shaders only, documented as a known limit.                                                                                                                                                                                                               |
| Runtime generic specialization    | Would mean shipping the compiler to the browser. Different product.                                                                                                                                                                                                                                                    |
| `LanguageServer` / editor tooling | Different product.                                                                                                                                                                                                                                                                                                     |
| Bundlers other than Vite          | Vite has a clean async plugin API and the WebGPU audience is already there. Turbopack runs only a _subset_ of webpack loaders; booting a 24 MB wasm module inside it and keeping the instance alive across files is unproven, and v0 should not be gated on that. Generalize via unplugin once the core API is proven. |

## Known hard parts

- **Virtual filesystem plumbing.** Slang's `import` wants files; wasm has none. Mount MEMFS or
  intercept resolution, and interoperate with Vite's virtual module ids (`\0` prefix). The
  fiddliest actual code in the project, and what v0's single-file limit defers.
- **Semver against a WIP backend.** WGSL codegen shifts upstream → generated output changes → is
  that a patch or a break? No clean answer. Pin, and mirror upstream's version.

## Open questions

- Does the Vite dev server keep the module graph warm well enough that a single `GlobalSession`
  survives across HMR cycles, or does it need explicit teardown beyond `closeBundle`?
- How should multi-entry-point modules map to ES exports? Slang emits one WGSL module containing
  every entry point, so a named export per entry point would be the same string repeated or a
  `{ code, name }` wrapper, and would collide with `entryPoints` / `reflection`. Currently the
  default export is the WGSL. Worth settling as part of the typegen design; additive either way.

## Working style

- **No code comments** unless explicitly asked. When a comment is warranted, it explains _why_,
  never _what_.
- Module-level functions use `function foo()`, not arrow consts. Inline callbacks stay arrows.
- **Never install packages or tools** unless explicitly asked. No `--legacy-peer-deps` or `--force`
  to paper over an `ERESOLVE` — investigate the real conflict.
- **Do not run npm scripts** (dev server, build) unless asked. Typechecking, `eslint`, and
  `prettier` are fine.
- **Search the internet for current documentation** rather than relying on training data. Slang,
  WGSL, WebGPU and Emscripten/embind are all fast-moving.
- For one-shot bulk work, produce the files directly — don't commit a generator script that has to
  be run.
- For open-ended design decisions, give a real recommendation and discuss one decision at a time.
- Python, if it ever comes up: run via `uv run` with PEP 723 inline `# /// script` metadata. Never
  `pip install`.
