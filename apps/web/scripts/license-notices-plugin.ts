import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import type { Plugin } from 'vite'
import { packageNotices } from '../../../scripts/licenses/notices.ts'

export function licenseNoticesPlugin(): Plugin {
  return {
    name: 'platform-license-notices',
    apply: 'build',
    generateBundle(_options, bundle) {
      if (this.environment.name !== 'client') return

      const modules = Object.values(bundle).flatMap((output) =>
        output.type === 'chunk' ? Object.keys(output.modules) : [],
      )
      const uiRequire = createRequire(
        path.resolve(import.meta.dirname, '../../../packages/ui/package.json'),
      )
      const webRequire = createRequire(path.resolve(import.meta.dirname, '../package.json'))
      modules.push(
        uiRequire.resolve('@fontsource-variable/inter/package.json'),
        uiRequire.resolve('@fontsource-variable/jetbrains-mono/package.json'),
      )
      this.emitFile({
        type: 'asset',
        fileName: 'licenses/THIRD_PARTY_NOTICES.txt',
        source: packageNotices(modules),
      })

      const grammars = path.dirname(
        webRequire.resolve('@singapore-editor/tree-sitter-languages/package.json'),
      )
      const grammarFiles = ['NOTICE'].concat(
        fs
          .readdirSync(path.join(grammars, 'notices'))
          .sort()
          .map((name) => `notices/${name}`),
      )
      this.emitFile({
        type: 'asset',
        fileName: 'licenses/editor-grammars.txt',
        source: grammarFiles
          .map((file) => fs.readFileSync(path.join(grammars, file), 'utf8'))
          .join('\n\n'),
      })
    },
  }
}
