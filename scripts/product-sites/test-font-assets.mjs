import assert from 'node:assert/strict'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const directory = resolve(process.argv[2] ?? 'scripts/product-sites/dist/ghostty-webgpu')
const pages = ['index.html', 'docs/index.html', 'docs/start/quick-start/index.html']
let fontUrls = []
for (const pathname of pages) {
  const html = await readFile(join(directory, pathname), 'utf8')
  const preloads = Array.from(html.matchAll(/<link\b[^>]*>/g), (match) => match[0]).filter(
    (tag) => /rel="preload"/.test(tag) && /as="font"/.test(tag),
  )
  assert.equal(preloads.length, 4, `${pathname} preloads every shared font face`)
  const urls = preloads.map((tag) => tag.match(/href="([^"]+)"/)[1]).sort()
  for (const url of urls) {
    assert.match(url, /\/_astro\/[^/]+\.[\w-]+\.woff2$/)
    assert((await stat(join(directory, url.slice(url.indexOf('/_astro/') + 1)))).isFile())
  }
  if (fontUrls.length === 0) fontUrls = urls
  assert.deepEqual(urls, fontUrls, `${pathname} and the landing page share font URLs`)
  assert.doesNotMatch(html, /["'(]\/fonts\/[^"')]+\.woff2/)
}
const assets = join(directory, '_astro')
const styles = await Promise.all(
  (await readdir(assets))
    .filter((name) => name.endsWith('.css'))
    .map((name) => readFile(join(assets, name), 'utf8')),
)
const docsCss = styles.join('\n')
assert.match(docsCss, /font-display:optional/)
assert.match(docsCss, /size-adjust:95\.272%/)
assert.match(docsCss, /ascent-override:97\.615%/)
assert.match(docsCss, /descent-override:28\.34(?:0)?%/)
assert.match(docsCss, /size-adjust:99\.984%/)
assert.doesNotMatch(docsCss, /url\(["']?\/fonts\//)
console.log('Ghostty font assets: shared hashed preloads and metric-matched fallbacks passed')
