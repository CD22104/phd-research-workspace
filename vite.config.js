import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  root: 'web',
  plugins: [vue()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['vue', 'vue-router'],
          naive: ['naive-ui'],
          charts: ['echarts', 'vue-echarts'],
          md: ['markdown-it', 'katex', '@vscode/markdown-it-katex', 'dompurify'],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:8788' },
  },
});
