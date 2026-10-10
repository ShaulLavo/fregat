// Checks build-time highlighting and unbroken migration expressions with JavaScript disabled.
// Usage: bun scripts/verify-migration.ts [evidence-directory] (after `bun run build`)
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, webkit } from 'playwright'
import { migrationComparison } from '../src/examples/migration-comparison'

const dist = fileURLToPath(new URL('../dist/', import.meta.url))
const evidence = process.argv[2]
if (evidence) await mkdir(evidence, { recursive: true })

for (const [engine, launcher] of Object.entries({ chromium, webkit })) {
  const browser = await launcher.launch()
  try {
    for (const width of [320, 390, 1440]) {
      const page = await browser.newPage({
        javaScriptEnabled: false,
        viewport: { width, height: 1000 },
      })
      await page.route('http://migration.test/**', async (route) => {
        const path = new URL(route.request().url()).pathname.replace(/^\/ghostty-webgpu\//, '')
        const file = join(dist, path.endsWith('/') || !path ? `${path}index.html` : path)
        await route.fulfill({ path: file })
      })
      await page.goto('http://migration.test/ghostty-webgpu/')
      await page.evaluate(() => document.fonts.ready)
      const table = page.getByRole('table', { name: 'xterm.js to ghostty-webgpu' })
      const expected = migrationComparison.flatMap(({ from, to }) =>
        Array.of<string>(from).concat(to),
      )
      assert.equal(await table.locator('tbody tr').count(), migrationComparison.length)
      assert.deepEqual(await table.locator('pre code').allTextContents(), expected)
      assert.equal(
        await table
          .locator('td')
          .filter({ hasText: /built in|terminal\.onData/ })
          .count(),
        0,
      )
      const layout = await table.evaluate((element) => ({
        viewport: innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        tableWidth: element.getBoundingClientRect().width,
        tableScrollWidth: element.scrollWidth,
        expressions: Array.from(element.querySelectorAll('pre code'), (code) => {
          const range = document.createRange()
          range.selectNodeContents(code)
          const bounds = range.getBoundingClientRect()
          const pre = code.parentElement!
          const colors = Array.from(
            code.querySelectorAll('span[style]'),
            (span) => getComputedStyle(span).color,
          )
          return {
            text: code.textContent,
            height: bounds.height,
            lineHeight: Number.parseFloat(getComputedStyle(pre).lineHeight),
            width: bounds.width,
            availableWidth: pre.clientWidth,
            colors: Array.from(new Set(colors)),
          }
        }),
      }))
      assert.ok(layout.documentWidth <= width, `${engine} ${width}: page fits viewport`)
      assert.ok(
        layout.tableScrollWidth <= Math.ceil(layout.tableWidth),
        `${engine} ${width}: table fits`,
      )
      for (const expression of layout.expressions) {
        assert.ok(
          expression.height <= expression.lineHeight + 1,
          `${expression.text} stays on one line`,
        )
        assert.ok(
          expression.width <= expression.availableWidth + 1,
          `${expression.text} fits its cell`,
        )
        if (expression.text === '@xterm/headless') continue
        assert.ok(expression.colors.length >= 2, `${expression.text} has syntax colours`)
      }
      if (evidence) {
        await Bun.write(join(evidence, `${engine}-${width}.json`), JSON.stringify(layout, null, 2))
        await page
          .locator('.callout')
          .screenshot({ path: join(evidence, `${engine}-${width}.png`) })
      }
      await page.goto('http://migration.test/ghostty-webgpu/docs/start/xterm/')
      await page.evaluate(() => document.fonts.ready)
      const guideTable = page.getByRole('table', { name: 'xterm.js to ghostty-webgpu' })
      assert.deepEqual(await guideTable.locator('pre code').allTextContents(), expected)
      const guideLayout = await guideTable.evaluate((element) => ({
        viewport: innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        tableWidth: element.getBoundingClientRect().width,
        tableScrollWidth: element.scrollWidth,
      }))
      assert.ok(guideLayout.documentWidth <= width, `${engine} ${width}: guide page fits`)
      assert.ok(
        guideLayout.tableScrollWidth <= Math.ceil(guideLayout.tableWidth),
        `${engine} ${width}: guide comparison fits`,
      )
      if (evidence) {
        await guideTable.screenshot({ path: join(evidence, `${engine}-${width}-guide.png`) })
      }
      console.log(
        `${engine} ${width}: matching guide, highlighted static API snippets and unbroken landing expressions pass`,
      )
      await page.close()
    }
  } finally {
    await browser.close()
  }
}
