import { describe, expect, it } from 'vitest'

import {
  createEditorOptionSync,
  EDITOR_OPTION_DESCRIPTORS,
  type EditorOptionDescriptor,
} from '../src/editor/optionDescriptors'
import type { Editor } from '../src/editor/Editor'

/**
 * The change tracker behind every binding's controlled options. What it records is what it will
 * later compare against, so a value it records without the editor ever seeing it is a value the
 * host can never ask for again.
 */
describe('editor option sync', () => {
  it('re-applies suspicious characters the host stopped controlling and then asked for again', () => {
    const applied: unknown[] = []
    const editor = {
      setSuspiciousCharacters: (value: unknown) => applied.push(value),
    } as unknown as Editor
    const descriptor = descriptorNamed('suspiciousCharacters')
    const sync = createEditorOptionSync()

    // The ordinary `suspiciousCharacters={enabled ? options : undefined}` idiom: off, uncontrolled,
    // then back on at the editor's own defaults.
    sync.apply(editor, descriptor, { ambiguous: false, invisible: false })
    sync.apply(editor, descriptor, undefined)
    sync.apply(editor, descriptor, { ambiguous: true, invisible: true })

    expect(applied).toHaveLength(2)
    expect(applied[1]).toMatchObject({ ambiguous: true, invisible: true })
  })

  // Nothing about the hole is specific to suspicious characters: any option whose `equals` reads
  // through `undefined` to a default falls into it, so the tracker has to be right about what
  // reached the editor rather than right about one option's name.
  it('records nothing for a value the descriptor refused to apply', () => {
    const applied: unknown[] = []
    const descriptor = {
      ...descriptorNamed('wordWrap'),
      equals: (left: unknown, right: unknown) => (left ?? true) === (right ?? true),
      applyTo: (_editor: Editor, value: unknown) => {
        if (value === undefined) return false

        applied.push(value)
        return true
      },
    } as unknown as EditorOptionDescriptor
    const editor = {} as Editor
    const sync = createEditorOptionSync()

    sync.apply(editor, descriptor, false)
    sync.apply(editor, descriptor, undefined)
    sync.apply(editor, descriptor, true)

    expect(applied).toEqual([false, true])
  })

  // The other half of the same rule: where the setter is the reset path, `undefined` did reach the
  // editor, so repeating it must not reach it twice.
  it('records a value the descriptor applied, including undefined', () => {
    const applied: unknown[] = []
    const editor = { setKeymap: (value: unknown) => applied.push(value) } as unknown as Editor
    const descriptor = descriptorNamed('keymap')
    const sync = createEditorOptionSync()

    sync.apply(editor, descriptor, { enabled: true })
    sync.apply(editor, descriptor, undefined)
    sync.apply(editor, descriptor, undefined)

    expect(applied).toEqual([{ enabled: true }, undefined])
  })

  it('validates, compares, and applies controlled selection affinity', () => {
    const applied: unknown[][] = []
    const editor = {
      setSelection: (...args: unknown[]) => applied.push(args),
    } as unknown as Editor
    const descriptor = descriptorNamed('selection')
    const sync = createEditorOptionSync()

    const before = {
      affinity: 'before',
      anchor: 4,
      head: 2,
      reveal: false,
      revealBlock: 'center',
      revealOffset: 9,
    }
    sync.apply(editor, descriptor, before)
    sync.apply(editor, descriptor, { ...before })
    sync.apply(editor, descriptor, { ...before, affinity: 'after' })
    sync.apply(editor, descriptor, { ...before, affinity: 'after', revealBlock: 'nearest' })

    expect(applied).toEqual([
      [4, 2, { affinity: 'before', reveal: false, revealBlock: 'center', revealOffset: 9 }],
      [4, 2, { affinity: 'after', reveal: false, revealBlock: 'center', revealOffset: 9 }],
      [4, 2, { affinity: 'after', reveal: false, revealBlock: 'nearest', revealOffset: 9 }],
    ])
    expect(descriptor.validate({ affinity: 'sideways', anchor: 1 })).toMatchObject({
      affinity: undefined,
      anchor: 1,
    })
  })
})

function descriptorNamed(name: string): EditorOptionDescriptor {
  const descriptor = EDITOR_OPTION_DESCRIPTORS.find((entry) => entry.name === name)
  if (!descriptor) throw new Error(`${name} is not in the option registry`)

  return descriptor
}
