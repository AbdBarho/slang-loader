import { disposeSlang, loadSlang, SlangCompileError, type CompileResult } from './index.js';
import { firstErrorLocation } from './diagnostics.js';

export interface SlangPluginOptions {
  include?: RegExp;
}

interface RollupError {
  message: string;
  id?: string;
  loc?: { file: string; line: number; column: number };
  plugin?: string;
}

interface TransformContext {
  error(error: RollupError): never;
}

interface VitePlugin {
  name: string;
  transform(this: TransformContext, code: string, id: string): Promise<{ code: string; map: null } | null>;
  closeBundle(): Promise<void>;
}

const DEFAULT_INCLUDE = /\.slang$/;
const PASSTHROUGH_QUERY = /[?&](raw|url|worker|inline)\b/;

export default function slang(options: SlangPluginOptions = {}): VitePlugin {
  const include = options.include ?? DEFAULT_INCLUDE;

  return {
    name: 'slang-loader',

    async transform(source, id) {
      const [path = ''] = id.split('?');
      if (!include.test(path) || PASSTHROUGH_QUERY.test(id)) return null;

      let result: CompileResult;
      try {
        const slang = await loadSlang();
        result = slang.compile(source, { path });
      } catch (error) {
        if (error instanceof SlangCompileError) {
          this.error(toRollupError(error, path));
        }
        throw error;
      }

      return { code: emitModule(result), map: null };
    },

    async closeBundle() {
      await disposeSlang();
    },
  };
}

function emitModule(result: CompileResult): string {
  return [
    `const code = ${JSON.stringify(result.code)};`,
    `export const entryPoints = ${JSON.stringify(result.entryPoints)};`,
    `export const reflection = ${JSON.stringify(result.reflection)};`,
    `export default code;`,
  ].join('\n');
}

// No `frame`: given a `loc`, both Vite's dev plugin container and Rollup render the source frame
// themselves, in whatever style the rest of that host's errors use.
function toRollupError(error: SlangCompileError, path: string): RollupError {
  const location = firstErrorLocation(error.diagnostics);

  return {
    message: error.message,
    id: path,
    plugin: 'slang-loader',
    ...(location && location.line !== null
      ? { loc: { file: path, line: location.line, column: location.column ?? 1 } }
      : {}),
  };
}
