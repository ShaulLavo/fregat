import { defineConfig } from 'vitest/config'
import { existsSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { createScriptError } from '../../scripts/structured-errors'
import base from './vitest.browser.config'
import { mockQualificationImages } from './test/factories/qualification-image-command'

const require = createRequire(import.meta.url)
const parserRoots = ['tree-sitter-md', 'web-tree-sitter'].map(parserPackageRoot)

function parserPackageRoot(name: string): string {
  let directory = path.dirname(realpathSync(require.resolve(name)))
  while (!existsSync(path.join(directory, 'package.json'))) {
    const parent = path.dirname(directory)
    if (parent === directory)
      throw createScriptError('A parser package has no package root.', {
        internal: { package: name },
      })
    directory = parent
  }
  return directory
}

export default defineConfig(({ mode }) => {
  const engine = mode === 'candidate' || mode === 'candidate-webkit' ? 'tree-sitter' : 'remark'
  const browser = mode.endsWith('-webkit') ? 'webkit' : 'chromium'
  return {
    ...base,
    root: import.meta.dirname,
    server: {
      ...base.server,
      fs: { ...base.server?.fs, allow: (base.server?.fs?.allow ?? []).concat(parserRoots) },
    },
    optimizeDeps: {
      ...base.optimizeDeps,
      exclude: (base.optimizeDeps?.exclude ?? []).concat(['tree-sitter-md', 'web-tree-sitter']),
    },
    test: {
      ...base.test,
      name: `markdown-${engine}-${browser}`,
      include: ['src/features/chat/tests/qualification*.browser.tsx'],
      provide: { markdownEngine: engine },
      browser: {
        ...base.test?.browser,
        commands: { ...base.test?.browser?.commands, mockQualificationImages },
        instances: [{ browser, viewport: { height: 700, width: 900 } }],
      },
    },
  }
})
