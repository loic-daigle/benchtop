import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  build: {
    rollupOptions: {
      // ws tries these optional native add-ons inside try/catch. Left external, the require
      // fails at runtime and ws uses its built-in JavaScript code. Bundled as empty stubs,
      // ws would think they exist and crash on the first message.
      external: ['bufferutil', 'utf-8-validate'],
    },
  },
});
