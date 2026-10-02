import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import { stampWebRelease } from './web-release'

test('built documents carry their own release identity before any request can race a deploy', () => {
  const web = mkdtempSync(path.join(tmpdir(), 'web-release-'))
  try {
    for (const name of ['index.html', 'dev.html'])
      writeFileSync(path.join(web, name), '<html><head></head><body></body></html>')
    stampWebRelease(web, 'release-1')
    for (const name of ['index.html', 'dev.html'])
      expect(readFileSync(path.join(web, name), 'utf8')).toContain(
        '<meta name="platform-release" content="release-1">',
      )
    stampWebRelease(web, 'installed-release')
    stampWebRelease(web, 'installed-release')
    for (const name of ['index.html', 'dev.html']) {
      const html = readFileSync(path.join(web, name), 'utf8')
      expect(html.match(/<meta name="platform-release"[^>]*>/g)).toEqual([
        '<meta name="platform-release" content="installed-release">',
      ])
    }
  } finally {
    rmSync(web, { recursive: true, force: true })
  }
})
