import { defineConfig, devices } from '@playwright/test'

const port = process.env.SOUL_ALBUM_E2E_PORT ?? '4173'

export default defineConfig({
  testDir: './tests',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: `node node_modules/vite/bin/vite.js --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env.CI,
  },
})
