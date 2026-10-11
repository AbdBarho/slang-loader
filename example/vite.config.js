import { defineConfig } from 'vite';
import slang from 'slang-loader/vite';
export default defineConfig({ root: 'src', build: { outDir: '../dist', emptyOutDir: true }, plugins: [slang()] });
