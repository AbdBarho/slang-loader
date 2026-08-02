import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts', 'src/vite.ts', 'src/browser.ts'],
  format: 'esm',
  dts: true,
  clean: true,
});
