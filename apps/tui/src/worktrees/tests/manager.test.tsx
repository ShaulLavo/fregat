import { access, readFile, writeFile } from 'node:fs/promises'
import { act } from 'react'
import { ScrollBoxRenderable, SelectRenderable } from '@opentui/core'
import { Application } from '@/components/application'
import { createWorktreeActions } from '@/worktrees/state/actions'
import { test, expect } from '../../../test/fixtures'
import { renderTui } from '../../../test/render'
import { runPaletteCommand } from '../../../test/actions'
import {
  openManagedTestChat,
  chooseWorktreeOption,
  readWorktreeDescription,
} from '../../../test/factories/worktrees'
import { runGit } from 'server/testing'

test('compact worktree dialogs keep selected actions visible and their full safety details readable', async ({
  server,
}) => {
  const { session, base, worktree, cleanupRequest } = await openManagedTestChat(server)
  await writeFile(`${worktree.canonicalPath}/sample.txt`, 'Keep my tracked changes\n')
  await writeFile(`${worktree.canonicalPath}/ignored.txt`, 'Keep my ignored file\n')
  await cleanupRequest()
  const frame = await renderTui(
    <Application
      session={session}
      onExit={() => {}}
      noColor
      initialLocation={{
        kind: 'agent',
        projectId: base.projectId,
        sessionId: null,
        worktreeId: base.id,
      }}
    />,
    { width: 40, height: 12, useThread: false, kittyKeyboard: true },
  )
  try {
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-composer')
    await runPaletteCommand(frame, 'chat.manageWorktrees')
    await chooseWorktreeOption(frame, worktree.branch ?? worktree.id)
    const actions = frame.renderer.currentFocusedRenderable
    if (!(actions instanceof SelectRenderable))
      return expect.unreachable('Expected worktree actions')
    for (const option of actions.options) {
      await frame.renderOnce()
      expect(frame.captureCharFrame()).toContain(`▶ ${option.name}`)
      expect(frame.captureCharFrame()).toContain('Worktree actions')
      expect(frame.captureCharFrame()).toContain('Esc cancel')
      await act(async () => frame.mockInput.pressArrow('down'))
    }
    const details = await readWorktreeDescription(frame)
    expect(details.text).toContain(worktree.canonicalPath)
    expect(actions.getSelectedIndex()).toBe(0)
    const scroll = frame.renderer.root.findDescendantById('worktree-description')
    if (!(scroll instanceof ScrollBoxRenderable))
      return expect.unreachable('Expected scrollable worktree details')
    const scrollTop = scroll.scrollTop
    await act(async () => frame.mockInput.pressKey('F1'))
    expect(frame.renderer.currentFocusedRenderable?.id).toBe('command-palette')
    await act(async () => frame.mockInput.pressKey('\u001b[5~'))
    expect(scroll.scrollTop).toBe(scrollTop)
    await act(async () => frame.mockInput.pressEscape())
    expect(frame.renderer.currentFocusedRenderable?.id).toBe('worktree-actions')
    await act(async () => {
      await chooseWorktreeOption(frame, 'Discard changes…')
      await expect
        .poll(() => frame.renderer.currentFocusedRenderable?.id)
        .toBe('worktree-cleanup-confirmation')
    })
    await frame.renderOnce()
    expect(frame.captureCharFrame()).toContain('Permanently discard 2 changed files')
    expect(frame.captureCharFrame()).toContain('▶ Cancel')
    expect(frame.captureCharFrame()).toContain('Esc cancel')
    const preview = await readWorktreeDescription(frame)
    expect(preview.text).toBe(
      `Permanently discard 2 changed files, including tracked, untracked, and ignored files in this checkout. Keep its branch and commits. Further edits require a new confirmation.Checkout: ${worktree.branch}`.replaceAll(
        /\s/g,
        '',
      ),
    )
    for (const page of preview.frames) {
      expect(page).toContain('▶ Cancel')
      expect(page).toContain('Esc cancel')
    }
    await act(async () => frame.mockInput.pressArrow('down'))
    await frame.renderOnce()
    expect(frame.captureCharFrame()).toContain('▶ Discard changes and remove')
    await act(async () => frame.mockInput.pressEscape())
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('worktree-actions')
    expect(await readFile(`${worktree.canonicalPath}/sample.txt`, 'utf8')).toBe(
      'Keep my tracked changes\n',
    )
  } finally {
    await frame.cleanup()
    session.dispose()
  }
})

test('worktree manager survives the last session and confirms safe and dirty cleanup separately', async ({
  server,
}) => {
  const { session, chat, base, worktree, repository } = await openManagedTestChat(server)
  expect(chat.getSnapshot().projection.sessionIds).toEqual([])
  expect(worktree.lifecycle.state).toBe('ready')
  await writeFile(`${worktree.canonicalPath}/sample.txt`, 'Keep my tracked changes\n')
  await writeFile(`${worktree.canonicalPath}/ignored.txt`, 'First ignored content\n')
  const frame = await renderTui(
    <Application
      session={session}
      onExit={() => {}}
      noColor
      initialLocation={{
        kind: 'agent',
        projectId: base.projectId,
        sessionId: null,
        worktreeId: base.id,
      }}
    />,
    { width: 132, height: 40, useThread: false, kittyKeyboard: true },
  )
  try {
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-composer')
    await runPaletteCommand(frame, 'Filter sessions')
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-rail-filter')
    await act(async () => frame.mockInput.pressEnter())
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-rail')
    await runPaletteCommand(frame, 'chat.manageWorktrees')
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('worktree-manager')
    await chooseWorktreeOption(frame, worktree.branch ?? worktree.id)
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('worktree-actions')
    await chooseWorktreeOption(frame, 'Clean up…')
    await expect
      .poll(() => frame.renderer.currentFocusedRenderable?.id)
      .toBe('worktree-cleanup-confirmation')
    await chooseWorktreeOption(frame, 'Cancel')
    expect(chat.getSnapshot().projection.worktreeById[worktree.id]?.lifecycle.state).toBe('ready')
    await chooseWorktreeOption(frame, 'Clean up…')
    await chooseWorktreeOption(frame, 'Clean up')
    await expect
      .poll(() => chat.getSnapshot().projection.worktreeById[worktree.id]?.lifecycle)
      .toMatchObject({ state: 'cleanup-blocked', reason: 'dirty' })
    expect(await readFile(`${worktree.canonicalPath}/sample.txt`, 'utf8')).toBe(
      'Keep my tracked changes\n',
    )
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('worktree-actions')
    await chooseWorktreeOption(frame, 'Discard changes…')
    await expect
      .poll(() => frame.renderer.currentFocusedRenderable?.id)
      .toBe('worktree-cleanup-confirmation')
    await frame.renderOnce()
    expect(frame.captureCharFrame()).toContain('tracked, untracked, and')
    expect(frame.captureCharFrame()).toContain('ignored files')
    await writeFile(`${worktree.canonicalPath}/ignored.txt`, 'Edited after preview\n')
    await chooseWorktreeOption(frame, 'Discard changes and remove')
    await expect
      .poll(() => chat.getSnapshot().projection.worktreeById[worktree.id]?.lifecycle)
      .toMatchObject({ state: 'cleanup-blocked', reason: 'needs-reconfirmation' })
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('worktree-actions')
    await chooseWorktreeOption(frame, 'Discard changes…')
    await expect
      .poll(() => frame.renderer.currentFocusedRenderable?.id)
      .toBe('worktree-cleanup-confirmation')
    await chooseWorktreeOption(frame, 'Discard changes and remove')
    await expect
      .poll(() => chat.getSnapshot().projection.worktreeById[worktree.id]?.lifecycle.state)
      .toBe('removed')
    await expect(access(worktree.canonicalPath)).rejects.toThrow()
    expect(
      (await runGit(repository, ['show-ref', '--verify', `refs/heads/${worktree.branch}`])).stdout,
    ).toContain(worktree.baseCommit)
    await frame.renderOnce()
    expect(frame.captureCharFrame()).toContain('Checkout removed')
    await act(async () => frame.mockInput.pressEscape())
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('worktree-manager')
    await frame.renderOnce()
    expect(frame.captureCharFrame()).toContain('Removed')
  } finally {
    await frame.cleanup()
    session.dispose()
  }
})

test('an async checkout opening failure stays visible in the worktree manager', async ({
  server,
}) => {
  const { session, base, worktree, repository } = await openManagedTestChat(server)
  const frame = await renderTui(
    <Application
      session={session}
      onExit={() => {}}
      noColor
      initialLocation={{
        kind: 'agent',
        projectId: base.projectId,
        sessionId: null,
        worktreeId: base.id,
      }}
    />,
    { width: 132, height: 40, useThread: false, kittyKeyboard: true },
  )
  try {
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-composer')
    await runPaletteCommand(frame, 'chat.manageWorktrees')
    await chooseWorktreeOption(frame, worktree.branch ?? worktree.id)
    await runGit(repository, ['worktree', 'remove', worktree.canonicalPath])
    await chooseWorktreeOption(frame, 'Open checkout')
    await expect
      .poll(async () => {
        await act(async () => {
          await frame.renderOnce()
        })
        return frame.captureCharFrame()
      })
      .toContain('file not found')
    expect(frame.renderer.currentFocusedRenderable?.id).toBe('worktree-actions')
  } finally {
    await frame.cleanup()
    session.dispose()
  }
})

test('manager and command owner refuse removal of the current and protected checkout', async ({
  server,
}) => {
  const { session, chat, base, worktree } = await openManagedTestChat(server)
  const actions = createWorktreeActions({
    session,
    chat,
    worktreeId: worktree.id,
    currentWorktreeId: worktree.id,
  })
  await actions.request('cleanup')
  expect(actions.getSnapshot().confirmation).toBeNull()
  expect(actions.getSnapshot().error).toContain('no longer available')
  await actions.request('force')
  expect(actions.getSnapshot().confirmation).toBeNull()
  actions.dispose()
  const frame = await renderTui(
    <Application
      session={session}
      onExit={() => {}}
      noColor
      initialLocation={{
        kind: 'agent',
        projectId: base.projectId,
        sessionId: null,
        worktreeId: worktree.id,
      }}
    />,
    { width: 132, height: 40, useThread: false, kittyKeyboard: true },
  )
  try {
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-composer')
    await runPaletteCommand(frame, 'Filter sessions')
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-rail-filter')
    await act(async () => frame.mockInput.pressEnter())
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('agent-rail')
    await runPaletteCommand(frame, 'chat.manageWorktrees')
    await chooseWorktreeOption(frame, worktree.branch ?? worktree.id)
    const current = frame.renderer.currentFocusedRenderable
    expect(current).toBeInstanceOf(SelectRenderable)
    if (current instanceof SelectRenderable)
      expect(current.options.map((option) => option.name).join(' ')).not.toMatch(/Clean up|Discard/)
    await frame.renderOnce()
    expect(frame.captureCharFrame()).toContain('Current checkout')
    await act(async () => frame.mockInput.pressEscape())
    await chooseWorktreeOption(frame, base.branch ?? base.id)
    await frame.renderOnce()
    expect(frame.captureCharFrame()).toContain('protected from removal')
    const protectedCheckout = frame.renderer.currentFocusedRenderable
    if (protectedCheckout instanceof SelectRenderable)
      expect(protectedCheckout.options.map((option) => option.name).join(' ')).not.toMatch(
        /Clean up|Discard|Release/,
      )
  } finally {
    await frame.cleanup()
    session.dispose()
  }
})
