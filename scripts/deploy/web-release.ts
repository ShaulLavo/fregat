import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'

/** The document identifies the loaded client even if a deploy lands before its first API call. */
export async function stampWebRelease(web: string, release: string): Promise<void> {
  const tag = await new HTMLRewriter()
    .on('meta', {
      element(element) {
        element.setAttribute('name', 'platform-release')
        element.setAttribute('content', release.replaceAll('&', '&amp;'))
      },
    })
    .transform(new Response('<meta>'))
    .text()
  for (const name of ['index.html', 'dev.html']) {
    const file = path.join(web, name)
    if (!existsSync(file)) continue
    const html = await new HTMLRewriter()
      .on('meta[name="platform-release"]', {
        element(element) {
          element.remove()
        },
      })
      .on('head', {
        element(element) {
          element.append(tag, { html: true })
        },
      })
      .transform(new Response(Bun.file(file)))
      .text()
    await writeFile(file, html)
  }
}
