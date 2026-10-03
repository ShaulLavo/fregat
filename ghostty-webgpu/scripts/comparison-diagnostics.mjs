import { chromium } from 'playwright'

export function diagnosticFailed(run) {
  return [run.legacyWriteControl, run.originalUnicodeProbe].some(
    (probe) => probe?.status === 'failed',
  )
}

export function legacyDiagnostic({ origin, testCase, method, ...options }) {
  return isolatedDiagnostic(options, async (page, result) => {
    result.phase = 'prepare'
    await page.goto(origin)
    await page.waitForFunction(() => Boolean(window.__compare))
    await page.evaluate((testCase) => window.__compare.prepare(testCase), testCase)
    result.phase = method
    return page.evaluate((method) => window.__compare[method](), method)
  })
}

export async function isolatedDiagnostic(
  { launchOptions, contextOptions, contexts = new Set() },
  operation,
) {
  const result = {
    status: 'running',
    isolation: 'browser-process',
    crashed: false,
    trace: [],
    pageErrors: [],
  }
  let browser
  let context
  try {
    result.phase = 'launch'
    // A separate Chromium process keeps renderer death outside the correctness browser.
    browser = await chromium.launch(launchOptions)
    result.browser = browser.version()
    context = await browser.newContext(contextOptions)
    contexts.add(context)
    const page = await context.newPage()
    page.on('crash', () => {
      result.crashed = true
    })
    page.on('pageerror', (error) => result.pageErrors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') result.pageErrors.push(message.text())
      const prefix = 'legacy-original-unicode '
      if (message.text().startsWith(prefix))
        result.trace.push(JSON.parse(message.text().slice(prefix.length)))
    })
    const probe = await operation(page, result)
    Object.assign(result, probe)
    result.status =
      result.pageErrors.length || Object.values(probe).some((api) => api?.accepted === false)
        ? 'failed'
        : 'complete'
    return result
  } catch (error) {
    result.status = 'failed'
    result.error = String(error.stack ?? error)
    return result
  } finally {
    await browser?.close()
    if (context) contexts.delete(context)
  }
}
