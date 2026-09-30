import { detectPlatform, normalizeRegisterableHotkey } from '@tanstack/hotkeys'
import type { EditorCommandContext, EditorCommandId } from './commands'
import { createKeymapRuntime } from '../keymap/runtime'
import {
  editorKeyBindings,
  type EditorKeyBinding,
  type EditorKeymapOptions,
} from '../keymap/presets'
import {
  editorKeyConditionMatches,
  editorCommandMutates,
  type EditorKeymapContext,
} from '../keymap/conditions'
import type { KeymapRuntime } from '../keymap/types'
export * from '../keymap/presets'

export type EditorKeymapControllerOptions = {
  readonly target: HTMLElement
  readonly keymap?: EditorKeymapOptions
  readonly input: HTMLElement
  readonly captureContext: () => EditorKeymapContext
  readonly dispatch: (command: EditorCommandId, context: EditorCommandContext) => boolean
}
export class EditorKeymapController {
  private readonly runtime: KeymapRuntime<EditorKeyBinding>
  private signature = ''
  public constructor(options: EditorKeymapControllerOptions) {
    this.runtime = createKeymapRuntime({
      root: options.target,
      bindings: [],
      captureContext: options.captureContext,
      isAvailable: ({ payload }, context, event) =>
        !isLocalInput(event, options.input) &&
        (!editorCommandMutates(payload.command) || context.writable) &&
        (payload.when ?? []).every((condition) => editorKeyConditionMatches(condition, context)),
      dispatch: ({ payload }, _context, event) => options.dispatch(payload.command, { event }),
    })
    this.setKeymap(options.keymap)
  }
  public setKeymap(options: EditorKeymapOptions | undefined): boolean {
    const platform = detectPlatform()
    const bindings = editorKeyBindings(options)
    const signature = JSON.stringify([
      options?.enabled !== false,
      bindings.map((binding) => [
        binding.chord.map((stroke) => normalizeRegisterableHotkey(stroke, platform)),
        binding.command,
        binding.when,
        binding.preventDefault,
        binding.stopPropagation,
      ]),
    ])
    if (signature === this.signature) return false
    this.signature = signature
    this.runtime.updateBindings(bindings.map((binding) => ({ ...binding, payload: binding })))
    this.runtime.setEnabled(options?.enabled !== false)
    return true
  }
  public dispose(): void {
    this.runtime.dispose()
  }
}

function isLocalInput(event: KeyboardEvent, input: HTMLElement): boolean {
  const target = event.target
  if (!(target instanceof HTMLElement)) return false
  const textEntry = target.closest('input, textarea, [contenteditable="true"]')
  return textEntry !== null && textEntry !== input
}
