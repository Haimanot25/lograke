import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Align JSX transform with @vitejs/plugin-react (automatic runtime) so tests
  // don't require a manual React import, matching the production build.
  esbuild: { jsx: 'automatic' },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/')) return 'vendor-react';
          if (id.includes('node_modules/react-router')) return 'vendor-router';
          if (id.includes('node_modules/recharts')) return 'vendor-charts';
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['src/test-setup.js'],
    include: ['src/**/*.test.{js,jsx}'],
    coverage: {
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.{js,jsx}'],
      exclude: ['src/**/*.test.*', 'src/main.jsx'],
      // Regression floor set at the baseline established by the current suite
      // (most page components are covered by e2e, not unit tests). Raise as
      // coverage grows — never lower these.
      thresholds: {
        statements: 2,
        branches: 38,
        functions: 16,
        lines: 2,
      },
    },
  },
})
