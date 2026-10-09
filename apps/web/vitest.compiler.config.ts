import { defineConfig } from 'vitest/config'
import base, { compilerProject, domProject } from './vitest.config'

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    projects: [
      { ...compilerProject, test: { ...compilerProject.test, include: domProject.test.include } },
    ],
  },
})
