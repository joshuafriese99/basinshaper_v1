import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `npm run build` produces dist/index.html: one self-contained file that runs
// offline (double-click) and can be published as a claude.ai artifact.
export default defineConfig({
  plugins: [viteSingleFile()],
  server: { open: true },
});
