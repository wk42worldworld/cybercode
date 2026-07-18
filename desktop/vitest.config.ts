import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    css: true,
    maxWorkers: 4,
    setupFiles: ['./src/test-setup.ts'],
    exclude: [
      ...configDefaults.exclude,
      'sidecars/**/*.test.ts',
      'scripts/sidecarTarget.test.ts',
    ],
  },
})
