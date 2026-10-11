import { expect, test } from '@playwright/test'

type GutterWindow = Window & {
  gutterActivations: string[]
  touchEditor: { getSelections(): readonly { anchorOffset: number; headOffset: number }[] }
}

for (const input of ['mouse', 'touch']) {
  test(`fold gutter ${input} preserves caret and typing focus`, async ({ page }) => {
    await page.goto('/test/fixtures/mobile-gutter.html')
    const button = page.getByRole('button', { name: 'Collapse foldable region' }).first()
    await expect(button).toBeEnabled()
    const before = await page.evaluate(() => (window as GutterWindow).touchEditor.getSelections())
    if (input === 'touch') await button.tap()
    if (input === 'mouse') await button.click()
    await expect(page.getByRole('button', { name: 'Expand folded region' }).first()).toBeVisible()
    await page.waitForTimeout(700)
    expect(await page.evaluate(() => (window as GutterWindow).touchEditor.getSelections())).toEqual(
      before,
    )
    await expect(page.locator('.editor-virtualized-input')).not.toBeFocused()
    await page.screenshot({ path: test.info().outputPath(`fold-${input}.png`) })
  })
}

for (const control of ['line-comment', 'breakpoint']) {
  test(`${control} gutter touch activates its control without moving the caret`, async ({
    page,
  }) => {
    await page.goto('/test/fixtures/mobile-gutter.html')
    const button = page.getByRole('button', { name: control, exact: true }).first()
    await expect(button).toBeVisible()
    const before = await page.evaluate(() => (window as GutterWindow).touchEditor.getSelections())
    await button.tap()
    await page.waitForTimeout(700)
    expect(await page.evaluate(() => (window as GutterWindow).gutterActivations)).toEqual([control])
    expect(await page.evaluate(() => (window as GutterWindow).touchEditor.getSelections())).toEqual(
      before,
    )
    await expect(page.locator('.editor-virtualized-input')).not.toBeFocused()
  })
}

test('unclaimed fold gutter space still places the caret', async ({ page }) => {
  await page.goto('/test/fixtures/mobile-gutter.html')
  await expect(page.getByRole('button', { name: 'Collapse foldable region' }).first()).toBeEnabled()
  const cell = page.locator(
    '[data-editor-virtual-gutter-row="3"] [data-editor-gutter-contribution="fold-gutter"]',
  )
  await cell.tap()
  expect(
    await page.evaluate(() => (window as GutterWindow).touchEditor.getSelections()[0]),
  ).toMatchObject({ anchorOffset: 31, headOffset: 31 })
  await expect(page.locator('.editor-virtualized-input')).toBeFocused()
})
