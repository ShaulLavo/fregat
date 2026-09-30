import { expect, test, type Page } from '@playwright/test'

const file = { path: 'src/note.ts', text: 'abc\n' }

async function openNote(page: Page): Promise<void> {
  await page.route('https://api.github.com/repos/ShaulLavo/singapore/commits/main', (route) =>
    route.fulfill({ json: { sha: 'mock-commit-sha', commit: { tree: { sha: 'tree-sha' } } } }),
  )
  await page.route(
    'https://api.github.com/repos/ShaulLavo/singapore/git/trees/tree-sha?recursive=1',
    (route) =>
      route.fulfill({
        json: {
          sha: 'tree-sha',
          truncated: false,
          tree: [{ path: file.path, type: 'blob', sha: 'file-sha-0', size: file.text.length }],
        },
      }),
  )
  await page.route(
    `https://raw.githubusercontent.com/ShaulLavo/singapore/mock-commit-sha/${file.path}`,
    (route) => route.fulfill({ body: file.text, contentType: 'text/plain' }),
  )
  await page.addInitScript((path) => {
    localStorage.clear()
    localStorage.setItem('editor-selected-file', path)
  }, file.path)
  await page.goto('/')
  await expect(page.locator('.editor-virtualized')).toContainText('abc')
}

// A at the end, undo, B at the end: the root has two children and B is current.
async function typeTwoBranches(page: Page): Promise<void> {
  await page.locator('.editor-virtualized').click({ position: { x: 200, y: 10 } })
  await expect(page.locator('.editor-virtualized-input')).toBeFocused()
  await page.keyboard.press('End')
  await page.keyboard.type('A')
  await page.keyboard.press('Control+z')
  await page.keyboard.type('B')
  await expect(page.locator('.editor-virtualized')).toContainText('abcB')
}

test('browses undo branches with the keyboard and restores one without typing into the editor', async ({
  page,
}) => {
  await openNote(page)
  await typeTwoBranches(page)

  await page.getByRole('button', { name: 'History' }).click()
  const rows = page.locator('#history-list [role="option"]')
  await expect(rows).toHaveCount(3)
  await expect(page.locator('#history-list [aria-selected="true"]')).toContainText('●')

  const list = page.locator('#history-list')
  await list.focus()
  await page.keyboard.press('ArrowUp')
  await expect(page.locator('#history-list [aria-selected="true"]')).toContainText('insert-text +1')
  await expect(page.locator('.editor-virtualized')).toContainText('abcB')

  await page.keyboard.press('Enter')
  await expect(page.locator('.editor-virtualized')).toContainText('abcA')
  await expect(page.locator('.editor-virtualized')).not.toContainText('abcB')
  await expect(page.locator('#history-list [role="option"]')).toHaveCount(3)
})

test('compares two selected states as a diff', async ({ page }) => {
  await openNote(page)
  await typeTwoBranches(page)

  await page.getByRole('button', { name: 'History' }).click()
  const rows = page.locator('#history-list [role="option"]')
  await rows.nth(1).click({ modifiers: ['Shift'] })
  await rows.nth(2).click({ modifiers: ['Shift'] })

  const compare = page.locator('#history-compare')
  await expect(compare).toContainText('-abcA')
  await expect(compare).toContainText('+abcB')
})
