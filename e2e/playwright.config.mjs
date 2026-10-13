import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  timeout: 30000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:5000',
    headless: true,
  },
  webServer: {
    command: 'node backend/src/index.js',
    cwd: '..',
    port: 5000,
    timeout: 15000,
    reuseExistingServer: true,
  },
});