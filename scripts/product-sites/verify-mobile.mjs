import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { appendFile, mkdir, readdir, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, resolve, sep } from 'node:path'
import { chromium, webkit } from 'playwright'

// A row is one built page, browser, viewport and interaction state. The same crawl runs locally
// against build output or against a published sitemap; evidence is optional in CI.
const args = process.argv.slice(2)
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback)
const widths = option('--widths', '320,360,390').split(',').map(Number)
const evidence = option('--evidence')
const directory = option('--directory')
const base = option('--base', '/')
const workers = Number(option('--workers', '3'))
const limit = Number(option('--limit', 'Infinity'))
const offset = Number(option('--offset', '0'))
const shards = Number(option('--shards', '1'))
const shard = Number(option('--shard', '0'))
const readySelector = option('--ready-selector')
const screenshots = args.includes('--screenshots')
const engines = option('--engines', 'chromium,webkit').split(',')
assert(widths.every((width) => Number.isInteger(width) && width > 0))
assert(Number.isInteger(workers) && workers > 0, 'Workers must be a positive integer')
assert(limit === Infinity || (Number.isInteger(limit) && limit > 0), 'Limit must be positive')
assert(Number.isInteger(offset) && offset >= 0, 'Offset must be a nonnegative integer')
assert(Number.isInteger(shards) && shards > 0, 'Shards must be positive')
assert(
  Number.isInteger(shard) && shard >= 0 && shard < shards,
  'Shard must be within the shard count',
)
assert(
  engines.every((engine) => ['chromium', 'webkit'].includes(engine)),
  'Unknown browser engine',
)
assert(directory || option('--origin'), 'Supply --directory or --origin')
if (evidence) await mkdir(evidence, { recursive: true })

async function builtPages(root, prefix = '') {
  const pages = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = `${prefix}/${entry.name}`
    if (entry.isDirectory()) pages.push(...(await builtPages(join(root, entry.name), path)))
    if (entry.isFile() && entry.name.endsWith('.html')) pages.push(path.replace(/index\.html$/, ''))
  }
  return pages
}

async function sitemapPages(url) {
  const response = await fetch(url)
  assert(response.ok, `${url}: HTTP ${response.status}`)
  const xml = await response.text()
  const links = Array.from(xml.matchAll(/<loc>(.*?)<\/loc>/g), (match) =>
    match[1].replaceAll('&amp;', '&'),
  )
  if (!xml.includes('<sitemapindex')) return links
  return (await Promise.all(links.map(sitemapPages))).flat()
}

let server
let origin = option('--origin')
let urls
if (directory) {
  const root = resolve(directory)
  const types = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.woff2': 'font/woff2',
    '.wasm': 'application/wasm',
  }
  server = createServer(async (request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
    const relative = pathname.startsWith(base) ? pathname.slice(base.length) : pathname
    let path = resolve(root, `.${sep}${relative}`)
    if (path !== root && !path.startsWith(`${root}${sep}`)) {
      response.writeHead(403).end()
      return
    }
    if (!extname(path)) path = join(path, 'index.html')
    try {
      const body = await readFile(path)
      response
        .writeHead(200, { 'Content-Type': types[extname(path)] ?? 'application/octet-stream' })
        .end(body)
    } catch {
      response.writeHead(404).end()
    }
  })
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  origin = `http://127.0.0.1:${server.address().port}`
  const paths = option('--paths')?.split(',') ?? (await builtPages(root))
  urls = paths.map((path) => `${origin}${base.replace(/\/$/, '')}${path}`)
} else {
  const sitemaps = option('--sitemaps', '').split(',').filter(Boolean)
  const paths = option('--paths', '/').split(',').filter(Boolean)
  urls = paths
    .map((path) => new URL(path, origin).href)
    .concat(
      (await Promise.all(sitemaps.map((path) => sitemapPages(new URL(path, origin).href)))).flat(),
    )
}
urls = [...new Set(urls)]
  .sort()
  .filter((_, index) => index % shards === shard)
  .slice(offset, offset + limit)
assert(urls.length > 0, 'No HTML pages selected')
let failed = 0
let checked = 0

async function inspect(page, viewportWidth) {
  return page.evaluate((width) => {
    const overflowing = []
    for (const element of document.querySelectorAll('body *')) {
      const rect = element.getBoundingClientRect()
      if (!rect.width || !rect.height || (rect.left >= 0 && rect.right <= width)) continue
      const computed = getComputedStyle(element)
      if (computed.visibility === 'hidden' || computed.visibility === 'collapse') continue
      const position = computed.position
      let contained = false
      for (
        let parent = element.parentElement;
        parent && parent !== document.body;
        parent = parent.parentElement
      ) {
        const style = getComputedStyle(parent)
        const bounds = parent.getBoundingClientRect()
        if (
          position !== 'fixed' &&
          (position !== 'sticky' || ['auto', 'scroll'].includes(style.overflowX)) &&
          ['auto', 'scroll', 'hidden', 'clip'].includes(style.overflowX) &&
          bounds.left >= 0 &&
          bounds.right <= width
        ) {
          contained = true
          break
        }
      }
      if (contained) continue
      overflowing.push({
        tag: element.tagName,
        id: element.id,
        class: element.className?.toString(),
        left: rect.left,
        right: rect.right,
        text: element.textContent?.trim().slice(0, 100),
      })
    }
    return { width: innerWidth, scrollWidth: document.scrollingElement.scrollWidth, overflowing }
  }, viewportWidth)
}

async function record(page, engine, url, width, state) {
  await page.setViewportSize({ width, height: width >= 667 ? 390 : 844 })
  await page.evaluate(async () => {
    await document.fonts.ready
    // The captured reader reflows at the font-ready animation frame after its resize observer.
    if (!document.querySelector('.paint-article')) return
    await new Promise((done) => requestAnimationFrame(done))
    await new Promise((done) => requestAnimationFrame(done))
  })
  const result = { url, engine, requestedWidth: width, state, ...(await inspect(page, width)) }
  const ok =
    result.scrollWidth <= width && result.width === width && result.overflowing.length === 0
  checked++
  if (!ok) failed++
  if (evidence && (screenshots || !ok)) {
    const id = createHash('sha256').update(url.replace(origin, '')).digest('hex').slice(0, 14)
    result.screenshot = `${id}-${engine}-${width}-${state}.jpg`
    result.screenshotAttempts = await captureScreenshot(page, join(evidence, result.screenshot))
  }
  if (evidence) await appendFile(join(evidence, 'results.jsonl'), `${JSON.stringify(result)}\n`)
  if (!ok)
    console.log(
      `FAIL ${engine} ${width} ${state} ${url}: root ${result.scrollWidth}, ${result.overflowing.length} overflowing elements`,
    )
}

async function captureScreenshot(page, path) {
  // Give a mobile viewport resize one more paint before retrying a failed capture.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await page.screenshot({ path, type: 'jpeg', quality: 45, animations: 'disabled' })
      return attempt + 1
    } catch (error) {
      if (attempt === 1) throw error
      await page.evaluate(() => new Promise((done) => requestAnimationFrame(done)))
    }
  }
}

async function navigate(page, engine, url) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await page.goto(url, { waitUntil: 'load', timeout: 45000 })
    } catch (error) {
      const interrupted =
        error.name === 'TimeoutError' ||
        error.message.includes('WebKit encountered an internal error')
      if (!interrupted || attempt === 1) throw error
      console.log(`RETRY ${engine} ${url}: ${error.message}`)
      if (evidence)
        await appendFile(
          join(evidence, 'navigation-retries.jsonl'),
          `${JSON.stringify({ url, engine, attempt: attempt + 1, error: error.message })}\n`,
        )
    }
  }
}

async function checkPage(page, engine, url) {
  try {
    const response = await navigate(page, engine, url)
    assert(response?.ok(), `${url}: HTTP ${response?.status()}`)
    if (readySelector) await page.locator(readySelector).waitFor({ timeout: 45000 })
    for (const width of widths) await record(page, engine, url, width, 'page')
    await checkLive(page, engine, url)
    await checkSearch(page, engine, url)
    await checkInspector(page, engine, url)
  } catch (error) {
    failed++
    console.log(`FAIL ${engine} ${url}: ${error.message}`)
    if (evidence)
      await appendFile(
        join(evidence, 'results.jsonl'),
        `${JSON.stringify({ url, engine, error: error.message })}\n`,
      )
  }
}

async function checkLive(page, engine, url) {
  const toggle = page.getByRole('button', { name: 'Go live', exact: true })
  if (!(await toggle.count())) return
  await toggle.click()
  await page.locator('body[data-mode="editor"]').waitFor({ timeout: 20000 })
  for (const width of widths) {
    await record(page, engine, url, width, 'live')
    // Resizing schedules caret placement after the rows; two frames can still read its old position.
    await page.waitForFunction(
      () => {
        const element = document.querySelector('.editor-host .editor-virtualized')
        return (
          element &&
          element.scrollWidth === element.clientWidth &&
          element.scrollHeight === element.clientHeight
        )
      },
      undefined,
      { timeout: 5000 },
    )
    const extents = await page.locator('.editor-host .editor-virtualized').evaluate((element) => ({
      x: element.scrollWidth - element.clientWidth,
      y: element.scrollHeight - element.clientHeight,
    }))
    assert.deepEqual(extents, { x: 0, y: 0 }, `${url}: live editor owns scrolling`)
  }
  await page.getByRole('button', { name: 'Go static', exact: true }).click()
  await page.locator('body[data-mode="static"]').waitFor()
  for (const width of widths) await record(page, engine, url, width, 'returned-static')
}

async function checkSearch(page, engine, url) {
  // Pagefind's dialog has a separate layout on each documentation page.
  const search = page.locator('site-search button, button.search-open')
  if (!(await search.count())) return
  await search.first().click()
  await page.locator('dialog[open]').waitFor()
  for (const width of widths) await record(page, engine, url, width, 'search')
  await page.keyboard.press('Escape')
}

async function checkInspector(page, engine, url) {
  const trigger = page.locator('#toolbar').getByRole('button', {
    name: 'Inspect piece tree',
    exact: true,
  })
  if (!(await trigger.count())) return
  await trigger.click()
  const dialog = page.getByRole('dialog', { name: 'Piece tree inspector' })
  await dialog.waitFor()
  for (const width of widths) await record(page, engine, url, width, 'inspector')
  await dialog.getByRole('button', { name: 'Close inspector', exact: true }).click()
}

async function checkWorker(browser, engine, nextUrl) {
  for (let url = nextUrl(); url; url = nextUrl()) {
    const context = await browser.newContext({
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
      viewport: { width: widths[0], height: 844 },
      reducedMotion: 'reduce',
    })
    try {
      const page = await context.newPage()
      await checkPage(page, engine, url)
    } finally {
      await context.close()
    }
  }
}

async function checkBrowser(engine) {
  // Bound process lifetime across large reference crawls; failed pages still fail the run.
  for (let start = 0; start < urls.length; start += 200) {
    const browser = await { chromium, webkit }[engine].launch()
    const end = Math.min(start + 200, urls.length)
    let next = start
    const nextUrl = () => {
      if (next >= end) return undefined
      if (next % 100 === 0)
        console.log(
          `${engine}: ${next}/${urls.length} pages, ${checked} checks, ${failed} failures`,
        )
      return urls[next++]
    }
    try {
      await Promise.all(
        Array.from({ length: workers }, () => checkWorker(browser, engine, nextUrl)),
      )
    } finally {
      await browser.close()
    }
  }
}

try {
  for (const engine of engines) await checkBrowser(engine)
} finally {
  if (server) await new Promise((done) => server.close(done))
}
console.log(`Mobile layout: ${urls.length} pages, ${checked} checks, ${failed} failures`)
process.exitCode = failed ? 1 : 0
