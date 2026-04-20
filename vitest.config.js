import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      './packages/db/vitest.config.ts',
      './packages/pipeline/vitest.config.ts',
      './packages/web/vitest.config.ts',
    ],
  },
})