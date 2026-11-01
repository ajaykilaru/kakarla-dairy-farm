const { defineConfig } = require('vite');
const react = require('@vitejs/plugin-react');
const apiTarget = process.env.MILKMATE_API_TARGET || 'http://127.0.0.1:3000';
module.exports = defineConfig({
  plugins: [react()],
  cacheDir: '.vite-cache',
  server: { host: '0.0.0.0', proxy: { '/api': { target: apiTarget, changeOrigin: true } } },
  preview: { host: '0.0.0.0' },
  build: { outDir: 'dist', emptyOutDir: true }
});
