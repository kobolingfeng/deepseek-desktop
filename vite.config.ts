import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// DeepSeek Desktop frontend — runs inside the QiangQiang WebView2 shell.
// base './' keeps asset URLs relative so they resolve both from the Vite dev
// server and from the app.localhost virtual host / single-exe pak in production.
export default defineConfig({
  base: './',
  plugins: [react()],
  clearScreen: false,
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
});
