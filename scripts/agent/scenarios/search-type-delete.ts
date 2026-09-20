import type { Scenario } from './index'
import { selectors } from '../selectors'

// Page scripts are strings: the scripts project compiles without the DOM lib.
const startSampling = `(() => {
  const log = { running: true, frames: 0, changes: [] }
  window.__agentSearchFrames = log
  let last = ''
  const sample = () => {
    if (!log.running) return
    log.frames += 1
    const tree = document.querySelector('[role="tree"][aria-label="Search results"]')
    const rows = tree ? tree.querySelectorAll('[role="treeitem"]') : []
    const editor = document.querySelector('[aria-label="Search result editor"]')
    const state = JSON.stringify({
      editor: Boolean(editor),
      editorTop: editor ? Math.round(editor.scrollTop) : null,
      editorRows: editor ? editor.querySelectorAll('[role="treeitem"]').length : 0,
      tree: Boolean(tree),
      top: tree ? Math.round(tree.scrollTop) : null,
      rows: rows.length,
      height: tree ? tree.scrollHeight : null,
      first: rows[0] ? rows[0].textContent.slice(0, 40) : null,
    })
    if (state !== last) log.changes.push({ frame: log.frames, ...JSON.parse(state) })
    last = state
    requestAnimationFrame(sample)
  }
  requestAnimationFrame(sample)
})()`

const stopSampling = `(() => {
  const log = window.__agentSearchFrames
  log.running = false
  return log
})()`

interface FrameLog {
  readonly frames: number
  readonly changes: readonly { frame: number; tree: boolean; top: number | null; rows: number }[]
}

/** Typing a query and deleting it must not scroll the results or repaint them more than once per answer. */
export const searchTypeDelete: Scenario = {
  name: 'search-type-delete',
  description:
    'Type ddd in workspace search, delete it, and record every frame the results changed.',
  async run(page, { step }) {
    await selectors.sidebarTab(page, 'Search').click()
    await selectors.workspaceSearch(page).fill('')
    await selectors.workspaceSearch(page).click()
    await page.evaluate(startSampling)
    await page.keyboard.type('ddd', { delay: 700 })
    await page.waitForTimeout(2_500)
    await step('typed')
    for (let index = 0; index < 3; index += 1) {
      await page.keyboard.press('Backspace')
      await page.waitForTimeout(700)
      await step(`deleted-${index + 1}`)
    }
    await page.waitForTimeout(2_500)
    const log = await page.evaluate<FrameLog>(stopSampling)
    const scrolled = log.changes.filter((change) => (change.top ?? 0) > 0).length
    console.log(JSON.stringify(log.changes, null, 1))
    await step(`changes-${log.changes.length}-scrolled-${scrolled}`)
  },
}
