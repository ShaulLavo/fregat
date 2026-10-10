import { expect, test, webkit, type Page } from '@playwright/test'
import { existsSync } from 'node:fs'
import { mockGitHubSourceFiles } from './github-source.ts'

test.skip(
  ({ browserName }) => browserName === 'webkit' && !existsSync(webkit.executablePath()),
  'Install Playwright WebKit to run the mobile source checks.',
)

const files = [
  { path: 'README.md', text: '# Source' },
  { path: 'examples/app/src/app.ts', text: 'export const mobileSource = true;' },
]
const selectedPath = 'examples/app/src/app.ts'
const editorSelector = '#editor-host > .editor-virtualized'

test('opens a source file through nested folders with touch input', async ({ page }, testInfo) => {
  await mockGitHubSourceFiles(page, files)
  await page.goto('/')
  await tapSourceFile(page)
  await expect(page.locator('#status-file')).toHaveText(selectedPath)
  await expect(page.locator(editorSelector)).toContainText('mobileSource')
  await expect(page.locator('#source-status')).toHaveText('')
  await page.screenshot({ path: testInfo.outputPath('mobile-file-open.png') })
})

test('keeps the page fixed while the editor and file tree scroll', async ({
  page,
  browserName,
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Playwright mobile WebKit cannot synthesize touch swipes.')
  const longFile = {
    path: 'README.md',
    text: Array.from({ length: 300 }, (_, index) => `Line ${index + 1}`).join('\n'),
  }
  await mockGitHubSourceFiles(
    page,
    [longFile].concat(
      Array.from({ length: 80 }, (_, index) => ({ path: `file-${index}.md`, text: '# File' })),
    ),
  )
  await page.goto('/')
  await expect(page.locator('#status-file')).toHaveText('README.md')
  const initialGeometry = await page.locator(editorSelector).evaluate((element) => ({
    top: element.scrollTop,
    height: element.clientHeight,
    extent: element.scrollHeight,
    mode: element.getAttribute('data-editor-scroll-mode'),
    overflow: getComputedStyle(element).overflowY,
  }))
  await testInfo.attach('editor-before-swipe', {
    body: JSON.stringify(initialGeometry),
    contentType: 'application/json',
  })
  await scrollArea(page, '#tree')
  await expect
    .poll(() => page.locator('#tree').evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0)
  await scrollArea(page, editorSelector)
  await expect
    .poll(() => page.locator(editorSelector).evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0)
  const geometry = await page.evaluate(() => ({
    windowTop: window.scrollY,
    documentTop: document.documentElement.scrollTop,
    bodyTop: document.body.scrollTop,
    pageHeight: document.documentElement.scrollHeight,
    viewportHeight: window.innerHeight,
    appTop: document.querySelector('#app')?.getBoundingClientRect().top,
  }))
  expect(geometry).toMatchObject({ windowTop: 0, documentTop: 0, bodyTop: 0, appTop: 0 })
  expect(geometry.pageHeight).toBe(geometry.viewportHeight)
  await page.screenshot({ path: testInfo.outputPath('mobile-inner-scroll.png') })
})

test('keeps the mobile page inside the viewport after opening a file', async ({ page }) => {
  await mockGitHubSourceFiles(page, files)
  await page.goto('/')
  await tapSourceFile(page)
  await expect(page.locator('#status-file')).toHaveText(selectedPath)
  await page.evaluate(() => window.scrollTo(0, 1000))
  const geometry = await page.evaluate(() => ({
    scrollTop: window.scrollY,
    pageHeight: document.documentElement.scrollHeight,
    viewportHeight: window.innerHeight,
    appTop: document.querySelector('#app')?.getBoundingClientRect().top,
  }))
  expect(geometry.scrollTop).toBe(0)
  expect(geometry.appTop).toBe(0)
  expect(geometry.pageHeight).toBe(geometry.viewportHeight)
})

test('resumes failed file reads when returning to the mobile page', async ({ page }, testInfo) => {
  await page.clock.install()
  await mockGitHubSourceFiles(page, files)
  const requests = new Map<string, number>()
  await page.route('https://raw.githubusercontent.com/**', async (route) => {
    const url = route.request().url()
    const attempt = (requests.get(url) ?? 0) + 1
    requests.set(url, attempt)
    if (attempt > 1) {
      await route.fallback()
      return
    }
    await setVisible(page, false)
    await route.fulfill({ status: 503 })
  })

  await page.goto('/')
  await tapSourceFile(page)
  const selectedUrl = `https://raw.githubusercontent.com/ShaulLavo/singapore/mock-commit-sha/${selectedPath}`
  await expect.poll(() => requests.get(selectedUrl)).toBe(1)
  await page.clock.runFor(2000)
  await expect(page.locator('#status-file')).toHaveText('No file')
  expect(requests.get(selectedUrl)).toBe(1)
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
  })
  await setVisible(page, true)
  await expect(page.locator('#status-file')).toHaveText(selectedPath)
  await page.clock.runFor(100)
  await expect(page.locator(editorSelector)).toContainText('mobileSource')
  await expect(page.locator('#source-status')).toHaveText('')
  expect(requests.get(selectedUrl)).toBe(2)
  await page.screenshot({ path: testInfo.outputPath('mobile-recovered.png') })
})

async function tapSourceFile(page: Page): Promise<void> {
  for (const path of ['examples/', 'examples/app/', 'examples/app/src/', selectedPath]) {
    await page.locator(`[data-source-path="${path}"]`).tap()
  }
}

async function setVisible(page: Page, visible: boolean): Promise<void> {
  await page.evaluate((nextVisible) => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => (nextVisible ? 'visible' : 'hidden'),
    })
    document.dispatchEvent(new Event('visibilitychange', { bubbles: true }))
  }, visible)
}

async function scrollArea(page: Page, selector: string): Promise<void> {
  const point = await page.locator(selector).evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
  })
  const session = await page.context().newCDPSession(page)
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ ...point, id: 0 }],
  })
  for (let step = 1; step <= 10; step += 1) {
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: point.x, y: point.y - step * 12, id: 0 }],
    })
    await page.waitForTimeout(16)
  }
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await session.detach()
}
