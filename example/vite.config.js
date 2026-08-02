import { defineConfig } from 'vite';
import slang from 'slang-loader/vite';

export default defineConfig({
  plugins: [slang()],
});
