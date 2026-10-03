import { ok, strictEqual } from 'node:assert/strict'
import type { Page } from 'playwright'
import { preserveAppearance, writeUserOperations, writeUserSetting } from '../preserve-settings'
import { focusEditor, openFileByName, runPaletteCommand, selectors, waitForApp } from '../selectors'
import type { Scenario } from './index'

const receipts = new WeakMap<Page, unknown>()

export const commandFoundation: Scenario = {
  name: 'command-foundation',
  description:
    'Verify Markdown sidebar keys, Editor history, focus-canceled chords and exactly one Linux shell Ctrl+B with both terminal layers.',
  inspect: async (page) => receipts.get(page),
  async run(page, { step }) {
    const restore = await preserveAppearance(page, [
      'keybindings.preset',
      'keybindings.overrides',
      'terminal.shellKeys',
    ])
    const sent: number[] = []
    page.on('websocket', (socket) => {
      if (!new URL(socket.url()).pathname.endsWith('/terminal')) return
      socket.on('framesent', ({ payload }) => {
        if (typeof payload !== 'string') sent.push(...payload)
      })
    })
    try {
      await writeUserSetting(page, 'keybindings.preset', 'ours')
      await writeUserOperations(page, [{ kind: 'reset', keys: ['keybindings.overrides'] }])
      await writeUserSetting(page, 'terminal.shellKeys', false)
      await page.reload()
      await waitForApp(page)
      await openFileByName(page, 'AGENTS.md')
      await focusEditor(page)
      await selectors.resizablePanel(page, 'sidebar').waitFor()
      await page.keyboard.press('Control+b')
      await selectors.resizablePanel(page, 'sidebar').waitFor({ state: 'detached' })
      strictEqual(
        await page.evaluate(() => document.activeElement?.getAttribute('aria-label')),
        'Editor input',
      )
      await step('markdown-sidebar-hidden')
      await page.keyboard.press('Control+b')
      await selectors.resizablePanel(page, 'sidebar').waitFor()
      await step('markdown-sidebar-restored')

      await openFileByName(page, 'PLAN.md')
      await focusEditor(page)
      await page.keyboard.press('Control+[')
      await page.waitForFunction(() =>
        document
          .querySelector('[data-editor-tab-path][aria-selected="true"]')
          ?.getAttribute('data-editor-tab-path')
          ?.endsWith('/AGENTS.md'),
      )
      await step('editor-history-back')

      await focusEditor(page)
      await page.keyboard.press('Control+k')
      await selectors.pendingChord(page).waitFor()
      await selectors.sidebarTab(page, 'Files').click()
      await selectors.folderTree(page).focus()
      await selectors.pendingChord(page).waitFor({ state: 'detached' })
      await step('chord-canceled-on-focus')

      await runPaletteCommand(page, 'Show terminal')
      const shell: { shellKeys: boolean; controlBCount: number }[] = []
      for (const shellKeys of [false, true]) {
        await writeUserSetting(page, 'terminal.shellKeys', shellKeys)
        await page.waitForTimeout(150)
        await selectors.terminalSurface(page).first().waitFor()
        await selectors
          .terminalSurface(page)
          .first()
          .click({ position: { x: 100, y: 60 } })
        await page.waitForFunction(() =>
          Boolean(
            document.activeElement?.closest('[data-slot="tool-pane"][aria-label="Terminal"]'),
          ),
        )
        const start = sent.length
        await page.keyboard.press('Control+b')
        for (let attempt = 0; attempt < 40 && !sent.slice(start).includes(2); attempt++)
          await page.waitForTimeout(25)
        await page.waitForTimeout(100)
        const count = sent.slice(start).filter((byte) => byte === 2).length
        strictEqual(count, 1, 'Ctrl+B reaches the shell exactly once')
        ok(
          await selectors.resizablePanel(page, 'sidebar').isVisible(),
          'The shell key leaves the sidebar visible',
        )
        shell.push({ shellKeys, controlBCount: count })
        await step(shellKeys ? 'shell-pack-control-b' : 'zed-terminal-control-b')
      }
      receipts.set(page, {
        preset: 'ours',
        markdownSidebar: true,
        historyBack: 'AGENTS.md',
        focusCanceled: true,
        shell,
      })
    } finally {
      await restore()
    }
  },
}
