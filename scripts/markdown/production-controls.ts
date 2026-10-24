import type { Browser } from 'playwright'

export async function productionBrowserControls(browser: Browser, url: string) {
  const context = await browser.newContext()
  try {
    const page = await context.newPage()
    const target = new URL(url)
    target.searchParams.set('engine', 'remark')
    await page.goto(target.href)
    await page.evaluate(() => window.markdownProductionProbe.ready)
    const source = 'Control **visible**.'
    const oracle = await page.evaluate(
      (source) => window.markdownProductionProbe.run(source, []),
      source,
    )
    const knownGood = await page.evaluate(
      ({ source, expected }) =>
        window.markdownProductionProbe.time(source, [], {
          arrival: 'paced',
          arrivalOffsetsMs: [0],
          expected: [expected],
        }),
      { source, expected: oracle.final.paintedOutput },
    )
    const missingExpectation = await page.evaluate(async (source) => {
      try {
        await window.markdownProductionProbe.time(source, [], {
          arrival: 'paced',
          arrivalOffsetsMs: [0],
          expected: [],
        })
        return { rejected: false, reason: null }
      } catch (error) {
        return { rejected: true, reason: error instanceof Error ? error.message : String(error) }
      }
    }, source)
    const wrongExpectation = await page.evaluate(
      async ({ source, expected }) => {
        try {
          await window.markdownProductionProbe.time(source, [], {
            arrival: 'paced',
            arrivalOffsetsMs: [0],
            expected: [{ ...expected, digest: '0'.repeat(64) }],
          })
          return { rejected: false, reason: null }
        } catch (error) {
          return { rejected: true, reason: error instanceof Error ? error.message : String(error) }
        }
      },
      { source, expected: oracle.final.paintedOutput },
    )
    const longTask = await page.evaluate(async () => {
      const before = window.markdownProductionProbe.activity().longTasks
      function blockFor80Ms() {
        const end = performance.now() + 80
        while (performance.now() < end) {
          /* A bounded negative control in an actual document timer task. */
        }
      }
      await new Promise<void>((resolve) =>
        setTimeout(() => {
          blockFor80Ms()
          resolve()
        }, 0),
      )
      await new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)))
      const after = window.markdownProductionProbe.activity().longTasks
      return {
        supported: before !== null && after !== null,
        observed: after?.slice(before?.length ?? 0) ?? null,
      }
    })
    return {
      knownGood: {
        expected: oracle.final.paintedOutput.digest,
        observed: knownGood.final.paintedOutput.digest,
        revision: knownGood.final.revision,
        observedRevision: knownGood.final.observedRevision,
      },
      missingExpectation,
      wrongExpectation,
      longTask,
    }
  } finally {
    await context.close()
  }
}
