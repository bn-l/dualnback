import { defineConfig, devices } from '@playwright/test'

const PORT = 5174
const BASE_URL = `http://localhost:${PORT}`
// A real round runs for over a minute (22+ trials, 2.5–3 s apart), so tests that play
// one need room.
const TEST_TIMEOUT_MS = 240_000
const SERVER_TIMEOUT_MS = 60_000

export default defineConfig({
    testDir: 'tests/e2e',
    timeout: TEST_TIMEOUT_MS,
    fullyParallel: true,
    reporter: 'list',
    use: {
        baseURL: BASE_URL,
        trace: 'retain-on-failure',
        launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
    },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
    webServer: {
        command: `npx vp dev --port ${PORT} --strictPort`,
        url: BASE_URL,
        reuseExistingServer: true,
        timeout: SERVER_TIMEOUT_MS,
    },
})
