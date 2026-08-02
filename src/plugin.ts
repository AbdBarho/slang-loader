import type { FilterPattern, UnpluginMessage, UnpluginOptions } from 'unplugin';

import { firstErrorLocation } from './compiler/diagnostics.ts';
import { disposeSlang, loadSlang, SlangCompileError, type CompileResult } from './compiler/session.ts';

export interface SlangPluginOptions {
  include?: FilterPattern;
  exclude?: FilterPattern;
}

const DEFAULT_INCLUDE = /\.slang(?:\?.*)?$/;
const PASSTHROUGH_QUERY = /[?&](?:raw|url|worker|inline)\b/;

const TEARDOWN = { closeBundle: disposeSlang };

export function slangFactory(options: SlangPluginOptions = {}): UnpluginOptions {
  return {
    name: 'slang-loader',

    transform: {
      filter: {
        id: {
          include: options.include ?? DEFAULT_INCLUDE,
          exclude: [PASSTHROUGH_QUERY, ...[options.exclude ?? []].flat()],
        },
      },

      async handler(source, id) {
        const [path = ''] = id.split('?');

        let result: CompileResult;
        try {
          const slang = await loadSlang();
          result = slang.compile(source, { path });
        } catch (error) {
          if (error instanceof SlangCompileError) this.error(toMessage(error, path));
          throw error;
        }

        return { code: emitModule(result), map: null };
      },
    },

    vite: TEARDOWN,
    rollup: TEARDOWN,
    rolldown: TEARDOWN,
    unloader: TEARDOWN,
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

function toMessage(error: SlangCompileError, path: string): UnpluginMessage {
  const location = firstErrorLocation(error.diagnostics);

  return {
    message: error.message,
    id: path,
    plugin: 'slang-loader',
    ...(location ? { loc: { file: path, line: location.line, column: location.column ?? 1 } } : {}),
  };
}
