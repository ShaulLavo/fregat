import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const directory = resolve(process.argv[2] ?? 'scripts/product-sites/dist/ghostty-webgpu')
const pages = ['index.html', 'docs/index.html', 'docs/start/quick-start/index.html', '404.html']
let fontUrl = ''
for (const pathname of pages) {
  const html = await readFile(join(directory, pathname), 'utf8')
  const preloads = Array.from(html.matchAll(/<link\b[^>]*>/g), (match) => match[0]).filter(
    (tag) => /rel="preload"/.test(tag) && /as="font"/.test(tag),
  )
  assert.equal(preloads.length, 1, `${pathname} preloads Paper Mono`)
  const url = preloads[0].match(/href="([^"]+)"/)[1]
  // A hashed bundler URL is cached for a year, so moving between pages never refetches or swaps the face.
  assert.match(url, /\/_astro\/[^/]+\.[\w-]+\.woff2$/)
  assert((await stat(join(directory, url.slice(url.indexOf('/_astro/') + 1)))).isFile())
  if (!fontUrl) fontUrl = url
  assert.equal(url, fontUrl, `${pathname} and the landing page share the font URL`)
  assert.match(
    html,
    new RegExp(
      `@font-face\\{font-family:'Paper Mono'[^}]*font-display:optional[^}]*url\\('${fontUrl.replaceAll('.', '\\.')}'\\)`,
    ),
  )
  assert.doesNotMatch(html, /["'(][^"'()]*fonts\/[^"')]+\.woff2/)
}
const licenses = {
  'licenses/ascii.rest.txt': /Copyright \(c\) 2026 bas3line[\s\S]*Permission is hereby granted/,
  'licenses/paper-mono.txt': /SIL OPEN FONT LICENSE/,
}
for (const [pathname, notice] of Object.entries(licenses)) {
  assert.match(
    await readFile(join(directory, pathname), 'utf8'),
    notice,
    `${pathname} ships its notice`,
  )
}
console.log(
  'Ghostty font and licence assets: one hashed, preloaded Paper Mono face and both notices passed',
)
