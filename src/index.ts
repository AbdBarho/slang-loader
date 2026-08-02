export {
  compile,
  disposeSlang,
  loadSlang,
  SlangCompileError,
  type CompileOptions,
  type CompileResult,
  type ShaderStage,
  type Slang,
  type SlangEntryPoint,
} from './compiler/session.ts';

export type { Diagnostic, DiagnosticSeverity } from './compiler/diagnostics.ts';
export { SLANG_VERSION } from './compiler/version.ts';
