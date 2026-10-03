import { detectPlatform } from '@fregat/hotkeys'
import { expect, test } from '../../../test/fixtures'
import { binding } from '../../../test/factories/key-binding'
import { renderHookWithProviders } from '../../../test/render'
import { useCommand } from '@/keymap/hooks/use-command'
import { useFocusService } from '@/lib/focus/hooks/use-service'

test('a menu command uses its captured feature node and preserves the active chord owner', async () => {
  const view = renderHookWithProviders(
    () => ({ command: useCommand(), focus: useFocusService() }),
    { command: { bindings: [binding('Mod+K Mod+S', { command: 'workspace.toggleWallpaper' })] } },
  )
  const tree = document.createElement('button')
  const other = document.createElement('button')
  document.body.append(tree, other)
  const registration = view.result.current.focus.register({
    area: 'file-tree',
    id: { kind: 'file-tree', rootPath: '/repo' },
    element: tree,
    onIntent: () => true,
  })
  const otherRegistration = view.result.current.focus.register({
    area: 'file-tree',
    id: { kind: 'file-tree', rootPath: '/other-repo' },
    element: other,
    onIntent: () => true,
  })
  let calls = 0
  let otherCalls = 0
  const removeOther = view.result.current.command.keymap.registerNode({
    parent: () => view.result.current.command.keymap.parentFor('file-tree'),
    element: () => other,
    context: () => 'TreeSelection',
    commands: {
      'fileTree.rename': () => {
        otherCalls++
        return true
      },
    },
  })
  const remove = view.result.current.command.keymap.registerNode({
    parent: () => view.result.current.command.keymap.parentFor('file-tree'),
    element: () => tree,
    context: () => 'TreeSelection',
    commands: {
      'fileTree.rename': () => {
        calls++
        return true
      },
    },
  })
  try {
    other.focus()
    other.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'k',
        bubbles: true,
        cancelable: true,
        ctrlKey: detectPlatform() !== 'mac',
        metaKey: detectPlatform() === 'mac',
      }),
    )
    const dispatcher = view.result.current.command.keymap.hotkeys
    const before = dispatcher.contextStack()
    await expect.poll(() => view.result.current.command.pendingChord).not.toBeNull()
    const pending = view.result.current.command.pendingChord
    const ticket = view.result.current.command.bus.dispatch('fileTree.rename', {
      origin: registration.token,
      source: { kind: 'menu', surface: 'files.row' },
    })
    expect(ticket.claimed).toBe(true)
    await expect(ticket.completion).resolves.toEqual({ status: 'handled' })
    expect(calls).toBe(1)
    expect(document.activeElement).toBe(other)
    expect(dispatcher.contextStack()).toEqual(before)
    expect(view.result.current.command.pendingChord).toEqual(pending)
    remove()
    const declined = view.result.current.command.bus.dispatch('fileTree.rename', {
      origin: registration.token,
      source: { kind: 'palette' },
    })
    expect(declined.claimed).toBe(false)
    await expect(declined.completion).resolves.toEqual({
      status: 'unhandled',
      reason: 'handler-declined',
    })
    expect(calls).toBe(1)
    registration.unregister()
    const stale = view.result.current.command.bus.dispatch('fileTree.rename', {
      origin: registration.token,
      source: { kind: 'palette' },
    })
    expect(stale.claimed).toBe(false)
    await expect(stale.completion).resolves.toEqual({
      status: 'unhandled',
      reason: 'handler-declined',
    })
    expect(otherCalls).toBe(0)
  } finally {
    remove()
    removeOther()
    registration.unregister()
    otherRegistration.unregister()
    view.unmount()
    tree.remove()
    other.remove()
  }
})
