import { defineConfig } from 'tsdown';

const bundlers = ['vite', 'rollup', 'rolldown', 'webpack', 'rspack', 'rsbuild', 'esbuild', 'farm', 'bun', 'unloader'];

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    unplugin: 'src/unplugin.ts',
    ...Object.fromEntries(bundlers.map(name => [name, `src/bundlers/${name}.ts`])),
  },
  format: 'esm',
  dts: true,
  clean: true,
  deps: { neverBundle: true },
});
