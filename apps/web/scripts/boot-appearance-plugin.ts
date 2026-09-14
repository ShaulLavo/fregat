import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { Plugin } from 'vite'

export function bootAppearancePlugin(webRoot: string): Plugin {
  const stylesheet = path.join(webRoot, 'boot.css')
  return {
    name: 'fregat-boot-appearance',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        return html.replace(
          '<!-- boot-appearance -->',
          () => `<style>\n${readFileSync(stylesheet, 'utf8')}</style>`,
        )
      },
    },
  }
}
