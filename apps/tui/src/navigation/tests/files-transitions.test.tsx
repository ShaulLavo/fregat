import { writeFile } from 'node:fs/promises'
import { InputRenderable } from '@opentui/core'
import { act } from 'react'
import { renderAgentNavigation } from '../../../test/factories/agent-navigation'
import { test, expect } from '../../../test/fixtures'

test('Forward cancels an earlier Back while its filesystem path discovery is still pending', async ({
  server,
}) => {
  const navigation = await renderAgentNavigation(server)
  const { frame, transport, rootPath } = navigation
  try {
    await act(async () => frame.mockInput.pressKey('p', { ctrl: true }))
    await expectListedPath(frame, `${server.root}/${rootPath}`)
    await act(async () => frame.mockInput.pressKey('BACKSPACE'))
    await expectListedPath(frame, `${server.root}/nested`)
    const gate = transport.pauseNextResponse('/health')
    try {
      await act(async () => {
        frame.mockInput.pressKey('k', { ctrl: true })
        frame.mockInput.pressKey('b')
      })
      const paused = await gate.reached
      await act(async () => {
        frame.mockInput.pressKey('k', { ctrl: true })
        frame.mockInput.pressKey('n')
      })
      expect(paused.signal.aborted).toBe(true)
      await act(async () => gate.release())
      await expectListedPath(frame, `${server.root}/nested`)
      await act(async () => {
        frame.mockInput.pressKey('k', { ctrl: true })
        frame.mockInput.pressKey('b')
      })
      await expectListedPath(frame, `${server.root}/${rootPath}`)
    } finally {
      await act(async () => gate.release())
    }
  } finally {
    await navigation.cleanup()
  }
})

test('Escape cancels a pending narrow preview and restores its Files listing', async ({
  server,
}) => {
  const navigation = await renderAgentNavigation(server, { width: 72 })
  const { frame, transport, rootPath } = navigation
  const gate = transport.pauseNextResponse('/fs/read')
  try {
    await act(async () => frame.mockInput.pressKey('p', { ctrl: true }))
    await expectListedPath(frame, `${server.root}/${rootPath}`)
    await act(async () => {
      await frame.mockInput.typeText('inside-project')
      frame.mockInput.pressEnter()
    })
    const paused = await gate.reached
    expect(frame.renderer.root.findDescendantById('file-picker-list')).toBeUndefined()
    await act(async () => frame.mockInput.pressKey('ESCAPE'))
    expect(paused.signal.aborted).toBe(true)
    await act(async () => gate.release())
    await expectListedPath(frame, `${server.root}/${rootPath}`)
    expect(frame.captureCharFrame()).toContain('inside-project.txt')
    expect(frame.captureCharFrame()).not.toContain('Inside the selected project.')
    expect(frame.renderer.currentFocusedRenderable?.id).toBe('file-picker-filter')
  } finally {
    await act(async () => gate.release())
    await navigation.cleanup()
  }
})

test('Escape clears a failed narrow preview without navigating away from Files', async ({
  server,
}) => {
  const navigation = await renderAgentNavigation(server, { width: 72 })
  const { frame, rootPath } = navigation
  await writeFile(`${server.root}/${rootPath}/binary.txt`, new Uint8Array([0, 0, 0xff]))
  try {
    await act(async () => frame.mockInput.pressKey('p', { ctrl: true }))
    await expectListedPath(frame, `${server.root}/${rootPath}`)
    await act(async () => {
      await frame.mockInput.typeText('binary')
      frame.mockInput.pressEnter()
    })
    await act(async () => {
      await expect
        .poll(async () => {
          await frame.renderOnce()
          return frame.captureCharFrame()
        })
        .toContain('seems to be binary')
    })
    expect(frame.renderer.root.findDescendantById('file-picker-list')).toBeUndefined()
    await act(async () => frame.mockInput.pressKey('ESCAPE'))
    await expectListedPath(frame, `${server.root}/${rootPath}`)
    expect(frame.captureCharFrame()).toContain('binary.txt')
    expect(frame.captureCharFrame()).not.toContain('seems to be binary')
    expect(frame.renderer.currentFocusedRenderable?.id).toBe('file-picker-filter')
  } finally {
    await navigation.cleanup()
  }
})

async function expectListedPath(
  frame: Awaited<ReturnType<typeof renderAgentNavigation>>['frame'],
  expected: string,
) {
  await act(async () => {
    await expect
      .poll(async () => {
        await frame.renderOnce()
        if (!frame.renderer.root.findDescendantById('file-picker-list')) return null
        const input = frame.renderer.root.findDescendantById('file-picker-path')
        return input instanceof InputRenderable ? input.value : null
      })
      .toBe(expected)
  })
}
