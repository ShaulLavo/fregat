import fs from 'node:fs'
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
      const fontRoot = path.resolve(
        import.meta.dirname,
        '../../../packages/ui/node_modules/@fontsource-variable',
      )
      modules.push(
        path.join(fontRoot, 'inter/package.json'),
        path.join(fontRoot, 'jetbrains-mono/package.json'),
      )
      this.emitFile({
        type: 'asset',
        fileName: 'licenses/THIRD_PARTY_NOTICES.txt',
        source: packageNotices(modules),
      })

      const grammars = path.resolve(
        import.meta.dirname,
        '../node_modules/@singapore-editor/tree-sitter-languages',
      )
      const grammarFiles = [
        'NOTICE',
        ...fs
          .readdirSync(path.join(grammars, 'notices'))
          .sort()
          .map((name) => `notices/${name}`),
      ]
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
