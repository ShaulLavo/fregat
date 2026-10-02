import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/** The document identifies the loaded client even if a deploy lands before its first API call. */
export function stampWebRelease(web: string, release: string) {
  const content = release.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')
  for (const name of ['index.html', 'dev.html']) {
    const file = path.join(web, name)
    if (!existsSync(file)) continue
    const html = readFileSync(file, 'utf8').replaceAll(/<meta name="platform-release"[^>]*>/g, '')
    writeFileSync(
      file,
      html.replace('</head>', `<meta name="platform-release" content="${content}"></head>`),
    )
  }
}
