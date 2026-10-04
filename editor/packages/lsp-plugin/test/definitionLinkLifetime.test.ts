import { afterEach, describe, expect, it } from 'vitest'
import {
  connectedEditor,
  flushPromises,
  singleLineRange,
  type ConnectedEditor,
} from './connectedEditor'

describe('definition link caller lifetime', () => {
  afterEach(() => document.body.replaceChildren())

  it.each(['pointer', 'modifier', 'source', 'document', 'navigation', 'dispose'] as const)(
    'releases the displayed target once on %s departure',
    async (departure) => {
      const released: string[] = []
      const editor = await connectedEditor('const value = 1', 6, {
        onDefinitionLinkHover: (target) => () => released.push(target.path),
      })
      await displayTarget(editor, 'file:///helper.ts')
      expect(released).toEqual([])
      depart(editor, departure)
      await flushPromises()
      expect(released).toEqual(['helper.ts'])
      editor.dispose()
      expect(released).toEqual(['helper.ts'])
    },
  )

  it('releases the old target before reporting a replacement', async () => {
    const events: string[] = []
    const editor = await connectedEditor('const value = other', 6, {
      onDefinitionLinkHover: (target) => {
        events.push(`enter:${target.path}`)
        return () => events.push(`leave:${target.path}`)
      },
    })
    await displayTarget(editor, 'file:///first.ts')
    editor.setPointerOffset(14)
    await displayTarget(editor, 'file:///second.ts')
    expect(events).toEqual(['enter:first.ts', 'leave:first.ts', 'enter:second.ts'])
    editor.dispose()
    expect(events.at(-1)).toBe('leave:second.ts')
  })

  it('detaches an old disposer before reentrant departure starts a new target', async () => {
    const events: string[] = []
    let resolveSecondEntered: () => void = () => undefined
    const secondEntered = new Promise<void>((resolve) => {
      resolveSecondEntered = resolve
    })
    let editor: ConnectedEditor
    editor = await connectedEditor('const value = other', 6, {
      onDefinitionLinkHover: (target) => {
        events.push(`enter:${target.path}`)
        if (target.path === 'second.ts') resolveSecondEntered()
        return () => {
          events.push(`leave:${target.path}`)
          if (target.path !== 'first.ts') return
          editor.releaseNavigationModifier()
          editor.setPointerOffset(14)
          editor.pointerMove(40, 60, { metaKey: true })
        }
      },
    })
    await displayTarget(editor, 'file:///first.ts')
    editor.pointerLeave()
    await editor.awaitRequest('textDocument/definition', 2)
    expect(events).toEqual(['enter:first.ts', 'leave:first.ts'])
    editor.answerDefinition([{ uri: 'file:///second.ts', range: singleLineRange(0, 5) }])
    await secondEntered
    expect(events).toEqual(['enter:first.ts', 'leave:first.ts', 'enter:second.ts'])
    editor.dispose()
    expect(events).toEqual([
      'enter:first.ts',
      'leave:first.ts',
      'enter:second.ts',
      'leave:second.ts',
    ])
  })
})

async function displayTarget(editor: ConnectedEditor, uri: string) {
  editor.pointerMove(40, 60, { metaKey: true })
  await flushPromises()
  editor.answerDefinition([{ uri, range: singleLineRange(0, 5) }])
  await flushPromises()
}

function depart(
  editor: ConnectedEditor,
  departure: 'pointer' | 'modifier' | 'source' | 'document' | 'navigation' | 'dispose',
) {
  if (departure === 'pointer') return editor.pointerLeave()
  if (departure === 'modifier') return editor.releaseNavigationModifier()
  if (departure === 'source') return editor.editElsewhere({ from: 0, to: 0, text: ' ' })
  if (departure === 'document') return editor.replaceText('const next = 2')
  if (departure === 'navigation') return editor.runCommand('editor.action.goToDefinition')
  return editor.dispose()
}
