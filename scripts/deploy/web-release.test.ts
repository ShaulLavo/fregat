import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import path from 'node:path'
import { expect, test } from 'vitest'
import { stampWebRelease } from './web-release'

test('built documents carry their own release identity before any request can race a deploy', async () => {
  const web = mkdtempSync(path.join(tmpdir(), 'web-release-'))
  try {
    for (const name of ['index.html', 'dev.html'])
      writeFileSync(path.join(web, name), '<html><head></head><body></body></html>')
    await stampWebRelease(web, 'release-1')
    for (const name of ['index.html', 'dev.html'])
      expect(readFileSync(path.join(web, name), 'utf8')).toContain(
        '<meta name="platform-release" content="release-1">',
      )
    await stampWebRelease(web, 'installed-release')
    await stampWebRelease(web, 'installed-release')
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

test('release stamping replaces duplicate differently formatted tags and escapes attribute values', async () => {
  const web = mkdtempSync(path.join(tmpdir(), 'web-release-'))
  try {
    writeFileSync(
      path.join(web, 'index.html'),
      `<html><head><meta content='old' name='platform-release'><META NAME="platform-release" content="older"><meta name="unrelated" content="kept"></head><body>kept</body></html>`,
    )
    const release = 'release "quoted" &copy; <tag></head><script>unsafe</script>'
    await stampWebRelease(web, release)
    await stampWebRelease(web, release)
    const html = readFileSync(path.join(web, 'index.html'), 'utf8')
    const webDependencies = createRequire(new URL('../../apps/web/package.json', import.meta.url))
    const { Window } = await import(webDependencies.resolve('happy-dom'))
    const browser = new Window()
    const document = new browser.DOMParser().parseFromString(html, 'text/html')
    await browser.happyDOM.close()
    const tags = document.querySelectorAll('meta[name="platform-release"]')
    expect(tags).toHaveLength(1)
    expect(tags[0]?.getAttribute('content')).toBe(release)
    expect(document.querySelectorAll('script')).toHaveLength(0)
    expect(html).toContain('<meta name="unrelated" content="kept">')
    expect(html).toContain('<body>kept</body>')
  } finally {
    rmSync(web, { recursive: true, force: true })
  }
})
