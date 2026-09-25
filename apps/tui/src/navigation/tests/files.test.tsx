import { act } from 'react'
import { InputRenderable } from '@opentui/core'
import { runPaletteCommand } from '../../../test/actions'
import { renderAgentNavigation } from '../../../test/factories/agent-navigation'
import { test, expect } from '../../../test/fixtures'

test('Files opens the selected project and navigates parents, history, and project places', async ({
  server,
}) => {
  const navigation = await renderAgentNavigation(server)
  const { frame, ready, rootPath } = navigation
  ready.storage.setItem('file-picker-directory', '')
  const currentPath = async () => {
    await act(async () => {
      await frame.renderOnce()
    })
    if (!frame.renderer.root.findDescendantById('file-picker-list')) return null
    const path = frame.renderer.root.findDescendantById('file-picker-path')
    return path instanceof InputRenderable ? path.value : null
  }
  const frameText = async () => {
    await act(async () => {
      await frame.renderOnce()
    })
    return frame.captureCharFrame()
  }
  try {
    await act(async () => {
      frame.mockInput.pressKey('p', { ctrl: true })
    })
    await expect.poll(currentPath).toBe(`${server.root}/${rootPath}`)
    expect(frame.renderer.root.findDescendantById('file-view')?.width).toBe(132)
    expect(frame.renderer.root.findDescendantById('settings-search')).toBeUndefined()
    await expect.poll(frameText).toContain('inside-project.txt')
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('file-picker-filter')

    await act(async () => {
      frame.mockInput.pressKey('BACKSPACE')
    })
    await expect.poll(currentPath).toBe(`${server.root}/nested`)
    await act(async () => {
      frame.mockInput.pressKey('BACKSPACE')
    })
    await expect.poll(currentPath).toBe(server.root)
    await expect.poll(frameText).toContain('outside-project.txt')
    await act(async () => {
      frame.mockInput.pressKey('BACKSPACE')
    })
    expect(await currentPath()).toBe(server.root)

    await runPaletteCommand(frame, 'Back')
    await expect.poll(currentPath).toBe(`${server.root}/nested`)
    await runPaletteCommand(frame, 'Back')
    await expect.poll(currentPath).toBe(`${server.root}/${rootPath}`)
    await runPaletteCommand(frame, 'Forward')
    await expect.poll(currentPath).toBe(`${server.root}/nested`)
    await runPaletteCommand(frame, 'Forward')
    await expect.poll(currentPath).toBe(server.root)

    await act(async () => {
      frame.mockInput.pressKey('TAB', { shift: true })
    })
    expect(frame.renderer.currentFocusedRenderable?.id).toBe('file-picker-places')
    await act(async () => {
      frame.mockInput.pressEnter()
    })
    await expect.poll(currentPath).toBe(`${server.root}/${rootPath}`)
    await expect.poll(frameText).toContain('inside-project.txt')
    expect(frame.renderer.currentFocusedRenderable?.id).toBe('file-picker-filter')
  } finally {
    await navigation.cleanup()
  }
})
