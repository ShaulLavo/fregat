import { defineConfig } from 'vitest/config'
import base from './vitest.browser.config.ts'

const settingWriterFiles = [
  'src/features/editor/tests/syntax-settings.browser.tsx',
  'src/features/editor/tests/retention-acceptance-identity.browser.tsx',
]

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    name: 'syntax-settings-browser',
    fileParallelism: false,
    include: settingWriterFiles,
    exclude: base.test?.exclude?.filter((path) => !settingWriterFiles.includes(path)),
  },
})
