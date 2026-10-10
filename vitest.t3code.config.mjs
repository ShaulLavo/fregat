import path from 'node:path'
import { defineConfig } from 'vitest/config'
import { gitFixtureEnv } from './apps/server/src/testing/git-identity.ts'

const appRoot = (app) => path.resolve(import.meta.dirname, 'apps', app)

export default defineConfig({
  test: {
    projects: [
      {
        root: appRoot('server'),
        test: {
          name: 't3code-server',
          environment: 'node',
          env: gitFixtureEnv,
          include: ['src/**/*.t3code.test.ts'],
          testTimeout: 30_000,
        },
      },
      {
        root: appRoot('web'),
        resolve: { alias: { '@': path.join(appRoot('web'), 'src') } },
        test: {
          name: 't3code-web',
          environment: 'node',
          env: gitFixtureEnv,
          include: ['src/**/*.t3code.test.ts'],
          setupFiles: [path.join(appRoot('web'), 'test/env/msw.ts')],
          testTimeout: 30_000,
        },
      },
    ],
  },
})
