import { makeSettingsOwner } from '../../../test/factories/settings-owner'
import { readSettings } from '@workspace/client-core/settings/read'
import { createTextDiff } from '@singapore-editor/diff'
import { act } from 'react'
import { CommandProvider } from '@/commands/providers/command-provider'
import { DiffView } from '@/git/components/diff'
import { resolveTheme } from '@/theme/utils/theme'
import { test, expect } from '../../../test/fixtures'
import { renderTui } from '../../../test/render'

for (const width of [70, 119, 120, 160]) {
  test(`diff paints shared model at ${width} columns and expands real context`, async ({
    client,
  }) => {
    const owner = await makeSettingsOwner(client)
    const oldText = Array.from({ length: 25 }, (_, index) => `line ${index + 1}`).join('\n')
    const file = createTextDiff({
      oldFile: { path: 'sample.txt', text: oldText },
      newFile: { path: 'sample.txt', text: oldText.replace('line 20', 'changed value') },
    })
    const frame = await renderTui(
      <CommandProvider
        scope={{ screen: 'workbench', environmentId: 'test', projectId: '' }}
        handlers={{}}
        overrides={{}}
        onError={(error) => expect.unreachable(String(error))}
      >
        <DiffView owner={owner} file={file} theme={resolveTheme('dark', 'dark', true)} enabled />
      </CommandProvider>,
      { width, height: 30, useThread: false },
    )
    try {
      await act(async () => {
        await frame.renderOnce()
      })
      await act(async () => {
        await frame.renderOnce()
      })
      expect(frame.captureCharFrame()).toContain('· stacked')
      await act(async () => {
        const submission = owner.submit('user', [
          { kind: 'set', key: 'editor.diff.viewMode', value: 'split' },
        ])
        if (submission.kind === 'submitted') await submission.settled
        await frame.renderOnce()
      })
      await act(async () => {
        await frame.renderOnce()
      })
      expect(frame.captureCharFrame()).toContain(width >= 120 ? '· split' : '· stacked')
      expect(frame.captureCharFrame()).toContain('changed value')
      expect(frame.captureCharFrame()).not.toMatch(/\bline 1\s/)
      await act(async () => {
        frame.renderer.root.findDescendantById('workbench-diff')?.focus()
      })
      await act(async () => {
        frame.mockInput.pressKey('k', { ctrl: true })
        frame.mockInput.pressKey('x')
      })
      await act(async () => {
        await frame.renderOnce()
      })
      expect(frame.captureCharFrame()).toMatch(/\bline 1\s/)
      await act(async () => {
        frame.mockInput.pressKey('k', { ctrl: true })
        frame.mockInput.pressKey('d')
        await expect.poll(() => owner.readSettingsMirror()['editor.diff.viewMode']).toBe('stacked')
      })
      await act(async () => {
        await frame.renderOnce()
      })
      expect(frame.captureCharFrame()).toContain('· stacked')
      expect((await readSettings({ client })).values['editor.diff.viewMode']).toBe('stacked')
      expect(frame.renderer.currentFocusedRenderable?.id).toBe('workbench-diff')
    } finally {
      await frame.cleanup()
      owner.dispose()
    }
  })
}
