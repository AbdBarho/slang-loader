# Agent Guidelines

Read [`INTERNALS.md`](./INTERNALS.md) before changing compiler lifecycle, dependency resolution,
type generation, packaging or the wasm artifact. It records the verified behavior and design
constraints behind those areas.

## Workflow

- Write a failing test first, confirm the failure, then implement the fix.
- Run `npm run typecheck`, `npm test` and `npm run build` before finishing substantial changes.
- Run tests against `dist/` after building when changing packaging, exports or artifact paths.
- Search current upstream documentation for Slang, WGSL, WebGPU and Emscripten behavior rather than
  relying on memory.
- Preserve unrelated worktree changes.
- Do not commit generated wasm binaries.

## Code Style

- Use module-level function declarations (`function foo()`); inline callbacks may use arrows.
- Keep explicit `.ts` extensions on relative imports.
- Preserve `erasableSyntaxOnly`: do not add enums, namespaces or parameter properties.
- Do not add comments unless they explain a non-obvious reason.
- Prefer the smallest correct implementation; do not add compatibility paths without a concrete
  consumer need.
- For one-shot bulk work, create the final files directly rather than adding a generator script.
- If Python is needed, use `uv run` with PEP 723 metadata; never `pip install`.

## Design Work

- Treat the invariants in `INTERNALS.md` as non-negotiable unless the task explicitly changes one.
- Re-verify load-bearing wasm behavior after a Slang version bump.
- For open-ended decisions, make a recommendation and discuss one decision at a time.
- Record new durable implementation knowledge, rejected approaches and unresolved architecture
  questions in `INTERNALS.md`, not here or in the consumer README.
