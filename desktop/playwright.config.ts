import { defineConfig, devices } from '@playwright/test'
import { fileURLToPath } from 'node:url'

const mockCliPath = fileURLToPath(
  new URL('../src/server/__tests__/fixtures/mock-sdk-cli.ts', import.meta.url),
)

const host = '127.0.0.1'
const apiPort = Number.parseInt(process.env.CYBERCODE_E2E_API_PORT || '3467', 10)
const webPort = Number.parseInt(process.env.CYBERCODE_E2E_WEB_PORT || '1430', 10)
const apiUrl = `http://${host}:${apiPort}`
const webUrl = `http://${host}:${webPort}`

export default defineConfig({
  testDir: './e2e',
  outputDir: 'test-results/artifacts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: {
    timeout: 15_000,
  },
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],
  use: {
    baseURL: webUrl,
    colorScheme: 'light',
    locale: 'en-US',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'bun run ./scripts/start-playwright-backend.ts',
      url: `${apiUrl}/health`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        CYBERCODE_E2E_API_PORT: String(apiPort),
        CLAUDE_CLI_PATH: process.env.CLAUDE_CLI_PATH ?? mockCliPath,
      },
    },
    {
      command: `bun run dev -- --host ${host} --port ${webPort} --strictPort`,
      url: webUrl,
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        TAURI_DEV_HOST: host,
        VITE_DEV_PORT: String(webPort),
        VITE_HMR_PORT: String(webPort + 1),
      },
    },
  ],
  projects: [
    {
      name: 'chromium-desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: 'chromium-compact',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1024, height: 720 },
      },
    },
  ],
})
