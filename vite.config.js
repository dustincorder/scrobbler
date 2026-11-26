import { defineConfig } from 'vite';

export default defineConfig({
  // Project pages live under /<repo>/. Local dev and custom domains use '/'.
  base: process.env.VITE_BASE_PATH || '/',
  build: {
    target: 'es2022',
    sourcemap: false,
  },
});
