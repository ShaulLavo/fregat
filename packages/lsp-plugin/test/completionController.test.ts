import { EditorTokenStore } from '@singapore-editor/core/syntax'
import type { DocumentSessionChange, TextEdit } from '@singapore-editor/core/document'
import type {
  EditorCommandHandler,
  EditorEditContributionContext,
  EditorViewContributionContext,
  EditorViewContributionProvider,
  EditorViewSnapshot,
} from '@singapore-editor/core/extensions'
import type { LspManagedTransport, LspTransportHandler } from '@singapore-editor/lsp'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type * as lsp from 'vscode-languageserver-protocol'
import type { EditorAnyCommandId } from '@singapore-editor/core/editor'

import { LANGUAGE_SERVER_COMPLETION_EDIT_FEATURE } from '../src/completion'
import { CompletionController } from '../src/completionController'
import { createLanguageServerAdapterPlugin } from '../src/plugin'
import { completionCommandHandlers } from './completionCommandHandlers'
import { createTestKeymap, type TestKeymap } from '@singapore-editor/core/testing'
import type { ActiveDocument } from '../src/pluginTypes'
import {
  documentSyncSnapshotFields,
  viewSnapshotStructuralFields,
  viewText,
  viewTextFields,
} from './documentSyncSnapshot'
import { textDocument } from './snapshotDocument'
import {
  createTestEditContributionContext,
  createTestPluginContext,
  createTestViewContributionContext,
} from '@singapore-editor/core/testing'

// Each harness's keymap listens on the document too, so it goes with the test that made it.
const keymaps: TestKeymap[] = []
afterEach(() => {
  for (const keymap of keymaps.splice(0)) keymap.dispose()
})

function testKeymap(
  root: HTMLElement,
  commands: ReadonlyMap<EditorAnyCommandId, EditorCommandHandler>,
): TestKeymap {
  const keymap = createTestKeymap(root, commands)
  keymaps.push(keymap)
  return keymap
}

type JsonMessage = Record<string, unknown>

const COMPLETION_ACCEPT_TIMING_NAME = 'testLsp.completion.accept'

class FakeTransport implements LspManagedTransport {
  public readonly sent: string[] = []
  private readonly handlers = new Set<LspTransportHandler>()

  public send(message: string): void {
    this.sent.push(message)
  }

  public subscribe(handler: LspTransportHandler): void {
    this.handlers.add(handler)
  }

  public unsubscribe(handler: LspTransportHandler): void {
    this.handlers.delete(handler)
  }

  public onDidClose(): () => void {
    return () => undefined
  }

  public close(): void {
    this.handlers.clear()
  }

  public receive(message: unknown): void {
    for (const handler of this.handlers) handler(JSON.stringify(message))
  }
}

describe('accepting a completion', () => {
  afterEach(() => {
    vi.useRealTimers()
    document.body.replaceChildren()
  })

  // The request goes out one keystroke behind the caret at the best of times; the widget then stays
  // up while the user keeps typing, so the offset it was answered for is not where the item lands.
  it('replaces the word as it stands when the item is accepted, not as the request left it', async () => {
    vi.useFakeTimers()
    const editor = await connectedEditor('const va', 8)

    editor.type('l')
    await vi.advanceTimersByTimeAsync(90)
    editor.answerCompletion([
      { label: 'value', textEdit: { range: singleLineRange(6, 9), newText: 'value' } },
    ])
    await flushPromises()
    expect(editor.completionElement().hidden).toBe(false)

    editor.type('u')
    editor.pressKey('Enter')

    expect(editor.applyEdits).toHaveBeenCalledWith(
      [{ from: 6, to: 10, text: 'value' }],
      COMPLETION_ACCEPT_TIMING_NAME,
      { anchor: 11, head: 11, affinity: 'after' },
    )
  })

  it('replaces the whole word an insert-or-replace item is accepted inside', async () => {
    vi.useFakeTimers()
    const editor = await connectedEditor('const foobar', 9)

    editor.type('o')
    await vi.advanceTimersByTimeAsync(90)
    editor.answerCompletion([
      {
        label: 'fooobaz',
        textEdit: {
          insert: singleLineRange(6, 10),
          replace: singleLineRange(6, 13),
          newText: 'fooobaz',
        },
      },
    ])
    await flushPromises()
    editor.pressKey('Enter')

    expect(editor.applyEdits).toHaveBeenCalledWith(
      [{ from: 6, to: 13, text: 'fooobaz' }],
      COMPLETION_ACCEPT_TIMING_NAME,
      { anchor: 13, head: 13, affinity: 'after' },
    )
  })

  // The import edit only arrives with the resolve, so this is the path the servers people use take.
  it('keeps a resolved item anchored on the caret the user reached', async () => {
    vi.useFakeTimers()
    const editor = await connectedEditor('const va', 8, {
      completionProvider: { resolveProvider: true },
    })

    editor.type('l')
    await vi.advanceTimersByTimeAsync(90)
    editor.answerCompletion([
      { label: 'value', textEdit: { range: singleLineRange(6, 9), newText: 'value' } },
    ])
    await flushPromises()

    editor.type('u')
    editor.pressKey('Enter')
    editor.answerResolve({
      label: 'value',
      textEdit: { range: singleLineRange(6, 9), newText: 'value' },
      additionalTextEdits: [
        { range: singleLineRange(0, 0), newText: 'import { value } from "m"\n' },
      ],
    })
    await flushPromises()

    expect(editor.applyEdits).toHaveBeenCalledWith(
      [
        { from: 6, to: 10, text: 'value' },
        { from: 0, to: 0, text: 'import { value } from "m"\n' },
      ],
      COMPLETION_ACCEPT_TIMING_NAME,
      { anchor: 37, head: 37, affinity: 'after' },
    )
  })

  // Measurements taken before the round-trip describe text the document no longer holds.
  it('drops a resolved item when the document moved during the round trip', async () => {
    vi.useFakeTimers()
    const editor = await connectedEditor('const va', 8, {
      completionProvider: { resolveProvider: true },
    })

    editor.type('l')
    await vi.advanceTimersByTimeAsync(90)
    editor.answerCompletion([
      { label: 'value', textEdit: { range: singleLineRange(6, 9), newText: 'value' } },
    ])
    await flushPromises()

    editor.pressKey('Enter')
    editor.type('u')
    editor.answerResolve({
      label: 'value',
      textEdit: { range: singleLineRange(6, 9), newText: 'value' },
    })
    await flushPromises()

    expect(editor.applyEdits).not.toHaveBeenCalled()
  })

  // A range spanning lines is a document this client never asked about, and there is no route by
  // which such an item can be applied: on screen it is a row that eats a keystroke and does nothing.
  it('never offers a row for an item whose range it cannot apply', async () => {
    vi.useFakeTimers()
    const editor = await connectedEditor('const va', 8)

    editor.type('l')
    await vi.advanceTimersByTimeAsync(90)
    editor.answerCompletion([
      {
        label: 'value',
        textEdit: {
          range: { start: { line: 0, character: 6 }, end: { line: 1, character: 2 } },
          newText: 'value',
        },
      },
      { label: 'valueOf' },
    ])
    await flushPromises()

    expect(editor.completionLabels()).toEqual(['valueOf'])
  })
})

describe('a completion session while the user keeps typing', () => {
  afterEach(() => {
    vi.useRealTimers()
    document.body.replaceChildren()
  })

  it('keeps the list up when a character is deleted inside the word', async () => {
    vi.useFakeTimers()
    const editor = await connectedEditor('const va', 8)

    editor.type('l')
    await vi.advanceTimersByTimeAsync(90)
    editor.answerCompletion([{ label: 'value' }, { label: 'valueOf' }])
    await flushPromises()

    editor.backspace()

    expect(editor.completionElement().hidden).toBe(false)
    expect(editor.completionLabels()).toEqual(['value', 'valueOf'])
  })

  it('narrows the list it already has instead of asking again', async () => {
    vi.useFakeTimers()
    const editor = await connectedEditor('const va', 8)

    editor.type('l')
    await vi.advanceTimersByTimeAsync(90)
    editor.answerCompletion([{ label: 'value' }, { label: 'valid' }])
    await flushPromises()
    expect(editor.completionRequests()).toHaveLength(1)

    editor.type('u')
    await vi.advanceTimersByTimeAsync(200)

    expect(editor.completionLabels()).toEqual(['value'])
    expect(editor.completionRequests()).toHaveLength(1)
  })

  // A truncated answer only gets less complete as the word grows, so this is the one case where the
  // server has to be asked again rather than the answer narrowed.
  it('asks again from the caret it reached when the list was marked incomplete', async () => {
    vi.useFakeTimers()
    const editor = await connectedEditor('const va', 8)

    editor.type('l')
    await vi.advanceTimersByTimeAsync(90)
    editor.answerCompletion([{ label: 'value' }], true)
    await flushPromises()

    editor.type('u')
    expect(editor.completionElement().hidden).toBe(false)
    await vi.advanceTimersByTimeAsync(90)

    const requests = editor.completionRequests()
    expect(requests).toHaveLength(2)
    expect(requests[1]?.context?.triggerKind).toBe(3)
    expect(requests[1]?.position.character).toBe(10)
  })

  // Typing at the bottom of the viewport scrolls the view, and the list is anchored to a rect in
  // viewport coordinates — so a scroll has to move it, not end the session.
  it('follows the caret down the viewport instead of closing when the view scrolls', async () => {
    vi.useFakeTimers()
    const editor = await connectedEditor('const va', 8)

    editor.type('l')
    await vi.advanceTimersByTimeAsync(90)
    editor.answerCompletion([{ label: 'value' }])
    await flushPromises()
    expect(editor.completionAnchorElement().style.top).toBe('20px')

    editor.scroll(30)

    expect(editor.completionElement().hidden).toBe(false)
    expect(editor.completionAnchorElement().style.top).toBe('-10px')
  })

  // The keystroke that asks for a list is often the one that scrolls the view, so the scroll and
  // the answer race each other. There is nothing on screen to follow yet, but the request was
  // measured against a caret the scroll never moved.
  it('shows the list a scroll arrived in the middle of asking for', async () => {
    vi.useFakeTimers()
    const editor = await connectedEditor('const va', 8)

    editor.type('l')
    await vi.advanceTimersByTimeAsync(90)
    editor.scroll(30)
    editor.answerCompletion([{ label: 'value' }])
    await flushPromises()

    expect(editor.completionElement().hidden).toBe(false)
    expect(editor.completionLabels()).toEqual(['value'])
  })

  it('still asks when the scroll lands before the request has left', async () => {
    vi.useFakeTimers()
    const editor = await connectedEditor('const va', 8)

    editor.type('l')
    await vi.advanceTimersByTimeAsync(40)
    editor.scroll(30)
    await vi.advanceTimersByTimeAsync(200)

    expect(editor.completionRequests()).toHaveLength(1)
  })

  // Moving the caret is the reader asking about somewhere else, which the queued question is not
  // about — the one update kind that has to take the request with it.
  it('drops the request the caret has moved away from', async () => {
    vi.useFakeTimers()
    const editor = await connectedEditor('const va', 8)

    editor.type('l')
    await vi.advanceTimersByTimeAsync(40)
    editor.moveCaret(3)
    await vi.advanceTimersByTimeAsync(200)

    expect(editor.completionRequests()).toEqual([])
  })

  // The editor closes a quote as it is typed, so the delimiter and its closer reach the document as
  // one edit — and it is the delimiter the module path in it is completed from.
  it('asks on a quote the editor closed as it was typed', async () => {
    vi.useFakeTimers()
    const editor = await connectedEditor('import fs from ', 15)

    editor.typeClosedPair('"', '"')
    await vi.advanceTimersByTimeAsync(90)

    const requests = editor.completionRequests()
    expect(requests).toHaveLength(1)
    expect(requests[0]?.context).toEqual({ triggerKind: 2, triggerCharacter: '"' })
    expect(requests[0]?.position.character).toBe(16)
  })

  // A trigger character is a different question, not a narrower one: the list has to go and the
  // server has to be told which character asked.
  it('replaces the list rather than narrowing it when a trigger character is typed', async () => {
    vi.useFakeTimers()
    const editor = await connectedEditor('const va', 8)

    editor.type('l')
    await vi.advanceTimersByTimeAsync(90)
    editor.answerCompletion([{ label: 'value' }])
    await flushPromises()

    editor.type('.')
    expect(editor.completionElement().hidden).toBe(true)
    await vi.advanceTimersByTimeAsync(90)

    const requests = editor.completionRequests()
    expect(requests).toHaveLength(2)
    expect(requests[1]?.context).toEqual({ triggerKind: 2, triggerCharacter: '.' })
    expect(requests[1]?.position.character).toBe(10)
  })

  it('dismisses once the word being completed has been deleted', async () => {
    vi.useFakeTimers()
    const editor = await connectedEditor('const va', 8)

    editor.type('l')
    await vi.advanceTimersByTimeAsync(90)
    editor.answerCompletion([{ label: 'value' }])
    await flushPromises()

    editor.backspace()
    editor.backspace()
    expect(editor.completionElement().hidden).toBe(false)

    editor.backspace()

    expect(editor.completionElement().hidden).toBe(true)
  })

  it('dismisses when the caret is moved out of the word', async () => {
    vi.useFakeTimers()
    const editor = await connectedEditor('const va', 8)

    editor.type('l')
    await vi.advanceTimersByTimeAsync(90)
    editor.answerCompletion([{ label: 'value' }])
    await flushPromises()

    editor.moveCaret(0)

    expect(editor.completionElement().hidden).toBe(true)
  })

  // The item ranges are offsets into the text the request captured, so an edit the caret did not
  // make leaves the list describing text that has moved out from under it.
  it('dismisses when something other than the typing changes the document', async () => {
    vi.useFakeTimers()
    const editor = await connectedEditor('const va;', 8)

    editor.type('l')
    await vi.advanceTimersByTimeAsync(90)
    editor.answerCompletion([{ label: 'value' }])
    await flushPromises()
    expect(editor.completionElement().hidden).toBe(false)

    editor.editElsewhere({ from: 10, to: 10, text: 'z' })

    expect(editor.completionElement().hidden).toBe(true)
  })

  // A session that outlives four keystrokes is a session whose item was computed for a shorter word
  // than the one on screen, so the span it replaces has to be re-derived from the caret now.
  it('applies an item accepted several keystrokes later against the word as it now stands', async () => {
    vi.useFakeTimers()
    const editor = await connectedEditor('const va', 8)

    editor.type('l')
    await vi.advanceTimersByTimeAsync(90)
    editor.answerCompletion([
      { label: 'valueOf', textEdit: { range: singleLineRange(6, 9), newText: 'valueOf' } },
    ])
    await flushPromises()

    editor.type('u')
    editor.type('e')
    editor.backspace()
    editor.type('e')
    expect(editor.completionElement().hidden).toBe(false)

    editor.pressKey('Enter')

    expect(editor.applyEdits).toHaveBeenCalledWith(
      [{ from: 6, to: 11, text: 'valueOf' }],
      COMPLETION_ACCEPT_TIMING_NAME,
      { anchor: 13, head: 13, affinity: 'after' },
    )
  })
})

describe('reading a filtered list', () => {
  afterEach(() => {
    vi.useRealTimers()
    document.body.replaceChildren()
  })

  // An order the user cannot see the reason for is an order they have to take on trust, so the list
  // marks what the word being typed accounted for in each label it kept.
  it('marks the matched characters of the labels it shows', async () => {
    vi.useFakeTimers()
    const editor = await connectedEditor('const va', 8)

    editor.type('l')
    await vi.advanceTimersByTimeAsync(90)
    editor.answerCompletion([{ label: 'value' }, { label: 'verticalAlign' }])
    await flushPromises()

    expect(editor.completionLabels()).toEqual(['value', 'verticalAlign'])
    expect(completionMatchRuns()).toEqual(['val', 'v', 'Al'])
  })
})

describe('a list the user has moved the focus in', () => {
  afterEach(() => {
    vi.useRealTimers()
    document.body.replaceChildren()
  })

  // The re-request is answered with items of its own, and the answer lands while the list is being
  // read: focusing its first row hands the next Enter an item the user never chose.
  it('keeps the row the arrow keys reached when a truncated list is answered again', async () => {
    vi.useFakeTimers()
    const editor = await connectedEditor('const va', 8)

    editor.type('l')
    await vi.advanceTimersByTimeAsync(90)
    editor.answerCompletion([{ label: 'value' }, { label: 'valueOf' }], true)
    await flushPromises()

    editor.pressKey('ArrowDown')
    expect(editor.focusedCompletionLabel()).toBe('valueOf')

    editor.type('u')
    await vi.advanceTimersByTimeAsync(90)
    editor.answerCompletion([{ label: 'value' }, { label: 'valueOf' }], true)
    await flushPromises()

    expect(editor.focusedCompletionLabel()).toBe('valueOf')
    editor.pressKey('Enter')
    expect(editor.applyEdits).toHaveBeenCalledWith(
      [{ from: 6, to: 10, text: 'valueOf' }],
      COMPLETION_ACCEPT_TIMING_NAME,
      { anchor: 13, head: 13, affinity: 'after' },
    )
  })

  // Every keystroke re-ranks the list and shows it again, so the row that happened to be on top a
  // moment ago is not a choice anyone made — keeping the focus on it hands Enter an item the reader
  // watched the list demote.
  it('follows the ranking while the focus is still where the list put it', async () => {
    vi.useFakeTimers()
    const editor = await connectedEditor('const x = a.t', 13)

    editor.type('o')
    await vi.advanceTimersByTimeAsync(90)
    editor.answerCompletion([{ label: 'toJSON' }, { label: 'toString' }])
    await flushPromises()
    expect(editor.completionLabels()).toEqual(['toJSON', 'toString'])
    expect(editor.focusedCompletionLabel()).toBe('toJSON')

    editor.type('s')

    expect(editor.completionLabels()).toEqual(['toString', 'toJSON'])
    expect(editor.focusedCompletionLabel()).toBe('toString')
    editor.pressKey('Enter')
    expect(editor.applyEdits).toHaveBeenCalledWith(
      [{ from: 12, to: 15, text: 'toString' }],
      COMPLETION_ACCEPT_TIMING_NAME,
      { anchor: 20, head: 20, affinity: 'after' },
    )
  })
})

describe('asking for a list without typing', () => {
  afterEach(() => {
    vi.useRealTimers()
    document.body.replaceChildren()
  })

  it('asks at the caret the moment the shortcut is pressed', async () => {
    vi.useFakeTimers()
    const editor = await connectedEditor('const val', 9)

    const event = editor.pressKey(' ', { ctrlKey: true })
    await flushPromises()

    const requests = editor.completionRequests()
    expect(requests).toHaveLength(1)
    expect(requests[0]?.context).toEqual({ triggerKind: 1 })
    expect(requests[0]?.position.character).toBe(9)
    // The shortcut asks for a list; the space it is spelled with must not reach the document.
    expect(event.defaultPrevented).toBe(true)

    editor.answerCompletion([{ label: 'value' }])
    await flushPromises()
    expect(editor.completionLabels()).toEqual(['value'])
  })

  // The queued request is for the word one keystroke ago, and both answers would be rendered.
  it('takes over the request the typing had queued', async () => {
    vi.useFakeTimers()
    const editor = await connectedEditor('const va', 8)

    editor.type('l')
    editor.pressKey(' ', { ctrlKey: true })
    await vi.advanceTimersByTimeAsync(200)

    expect(editor.completionRequests()).toHaveLength(1)
  })

  it('stays quiet while a range is selected, having no caret to complete at', async () => {
    vi.useFakeTimers()
    const editor = await connectedEditor('const val', 9)

    editor.selectRange(6, 9)
    editor.pressKey(' ', { ctrlKey: true })
    await flushPromises()

    expect(editor.completionRequests()).toEqual([])
  })
})

describe('the commit characters a server declares', () => {
  afterEach(() => {
    vi.useRealTimers()
    document.body.replaceChildren()
  })

  // A server whose sets are wrong turns ordinary typing into unwanted completions, which is worse
  // than no shortcut at all — so it is the host that turns them on, never the server.
  it('are inert until the host asks for them', async () => {
    vi.useFakeTimers()
    const editor = await connectedEditor('const va', 8)

    editor.type('l')
    await vi.advanceTimersByTimeAsync(90)
    editor.answerCompletion([{ label: 'value', commitCharacters: ['.'] }])
    await flushPromises()

    const event = editor.pressKey('.')

    expect(editor.applyEdits).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
    expect(editor.completionElement().hidden).toBe(false)
  })
})

describe('a list whose document is no longer the open one', () => {
  afterEach(() => {
    vi.useRealTimers()
    document.body.replaceChildren()
  })

  it('applies the item while the open document is still the one asked about', async () => {
    vi.useFakeTimers()
    const completion = await standaloneCompletion([{ label: 'value' }])

    completion.pressEnter()

    expect(completion.applyCompletion).toHaveBeenCalledTimes(1)
    completion.dispose()
  })

  // The item's ranges are offsets into the text the request captured. Another file is another text,
  // and the same offsets land in the middle of whatever happens to be sitting at them.
  it('drops the item once another document has taken its place', async () => {
    vi.useFakeTimers()
    const completion = await standaloneCompletion([{ label: 'value' }])

    completion.openAnotherDocument()
    completion.pressEnter()

    expect(completion.applyCompletion).not.toHaveBeenCalled()
    completion.dispose()
  })

  // Swallowing the key on the way out costs the reader the newline they pressed it for, and nothing
  // was accepted in its place — the same bargain the commit characters already keep.
  it('leaves Enter to the editor when there is no item it can apply', async () => {
    vi.useFakeTimers()
    const completion = await standaloneCompletion([{ label: 'value' }])

    completion.openAnotherDocument()
    const event = completion.pressEnter()

    expect(event.defaultPrevented).toBe(false)
    completion.dispose()
  })
})

type StandaloneCompletion = {
  readonly applyCompletion: ReturnType<typeof vi.fn>
  openAnotherDocument(): void
  pressEnter(): KeyboardEvent
  dispose(): void
}

/**
 * The controller on its own, with the open document under its feet rather than the editor's.
 *
 * The plugin hides the list whenever it swaps documents, so this is the one seam through which the
 * controller can be asked what it does when it is handed a document its list was never about.
 */
async function standaloneCompletion(
  items: readonly lsp.CompletionItem[],
): Promise<StandaloneCompletion> {
  const element = document.createElement('div')
  const applyCompletion = vi.fn(() => true)
  const snapshot = editorSnapshot('const val', 9, 2)
  let active = openDocument('file:///src/index.ts', 'const val')
  const commands = new Map<EditorAnyCommandId, EditorCommandHandler>()
  const keymap = testKeymap(element, commands)

  const controller = new CompletionController({
    context: viewContributionContext({
      element,
      registerKeymapContextKey: keymap.registerKeymapContextKey,
      getSnapshot: () => snapshot,
      getRangeClientRect: () => new DOMRect(10, 20, 40, 18),
      getFeature: (token) =>
        token === LANGUAGE_SERVER_COMPLETION_EDIT_FEATURE ? { applyCompletion } : null,
    }),
    completionSources: {
      forLanguage: () => [{ provideCompletionItems: () => items }],
    },
    completionWidgetClassNamespace: 'test-standalone',
    getActiveDocument: () => active,
    ignorePointerTarget: () => false,
    onBeforeShow: () => undefined,
    onRequestError: () => undefined,
  })

  for (const [id, handler] of completionCommandHandlers(controller)) commands.set(id, handler)
  controller.update(snapshot, 'content', documentChange([{ from: 8, to: 8, text: 'l' }]))
  await vi.advanceTimersByTimeAsync(90)

  return {
    applyCompletion,
    openAnotherDocument: () => {
      active = openDocument('file:///src/other.ts', 'const val')
    },
    pressEnter: () => {
      const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
      element.dispatchEvent(event)
      return event
    },
    dispose: () => controller.dispose(),
  }
}

function openDocument(uri: string, fullText: string): ActiveDocument {
  return {
    uri,
    languageId: 'typescript',
    ...textDocument(fullText),
    textVersion: 2,
    lspVersion: 1,
  }
}

function completionMatchRuns(): readonly string[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>('.editor-test-lsp-completion-match'),
    (element) => element.textContent ?? '',
  )
}

type ConnectedEditor = {
  readonly applyEdits: ReturnType<typeof vi.fn<EditorEditContributionContext['applyEdits']>>
  type(character: string): void
  /** A delimiter the editor closed as it was typed: both halves in one edit, caret between them. */
  typeClosedPair(open: string, close: string): void
  backspace(): void
  moveCaret(offset: number): void
  selectRange(start: number, end: number): void
  scroll(by: number): void
  editElsewhere(edit: TextEdit): void
  pressKey(key: string, modifiers?: KeyboardEventInit): KeyboardEvent
  answerCompletion(items: readonly lsp.CompletionItem[], isIncomplete?: boolean): void
  answerResolve(item: lsp.CompletionItem): void
  completionElement(): HTMLElement
  completionAnchorElement(): HTMLElement
  completionLabels(): readonly string[]
  focusedCompletionLabel(): string | null
  completionRequests(): readonly lsp.CompletionParams[]
}

/**
 * The plugin driven the way the editor drives it: one coalesced content update per keystroke, a
 * live view snapshot, and the completion edit feature the edit contribution registers.
 */
async function connectedEditor(
  text: string,
  caretOffset: number,
  capabilities: lsp.ServerCapabilities = {},
): Promise<ConnectedEditor> {
  const transport = new FakeTransport()
  const applyEdits = vi.fn<EditorEditContributionContext['applyEdits']>()
  const features = new Map<unknown, unknown>()
  const element = document.createElement('div')
  let snapshot = editorSnapshot(text, caretOffset, 1)
  let anchorRect = new DOMRect(10, 20, 40, 18)

  const commands = new Map<EditorAnyCommandId, EditorCommandHandler>()
  const provider = activateProvider(transport, features, applyEdits, commands)
  const keymap = testKeymap(element, commands)
  const contribution = provider.createContribution(
    viewContributionContext({
      element,
      registerKeymapContextKey: keymap.registerKeymapContextKey,
      getSnapshot: () => snapshot,
      getRangeClientRect: () => anchorRect,
      getFeature: (token) => features.get(token) ?? null,
    }),
  )
  if (!contribution) throw new Error('missing contribution')

  transport.receive({
    jsonrpc: '2.0',
    id: jsonMessage(transport.sent[0]).id,
    result: {
      capabilities: {
        completionProvider: {},
        textDocumentSync: { openClose: true, change: 2 },
        ...capabilities,
      },
    },
  })
  await flushPromises()

  const answer = (method: string, result: unknown): void => {
    const request = transport.sent.map(jsonMessage).findLast((sent) => sent.method === method)
    if (!request) throw new Error(`missing request ${method}`)
    transport.receive({ jsonrpc: '2.0', id: request.id, result })
  }

  const applyChange = (edit: TextEdit, caretOffset: number): void => {
    const next = `${viewText(snapshot).slice(0, edit.from)}${edit.text}${viewText(snapshot).slice(edit.to)}`
    snapshot = editorSnapshot(next, caretOffset, snapshot.textVersion + 1)
    contribution.update(snapshot, 'content', documentChange([edit]))
  }

  return {
    applyEdits,
    type: (character) => {
      const at = caretOffsetOf(snapshot)
      applyChange({ from: at, to: at, text: character }, at + character.length)
    },
    typeClosedPair: (open, close) => {
      const at = caretOffsetOf(snapshot)
      applyChange({ from: at, to: at, text: open + close }, at + open.length)
    },
    backspace: () => {
      const at = caretOffsetOf(snapshot)
      applyChange({ from: at - 1, to: at, text: '' }, at - 1)
    },
    editElsewhere: (edit) => applyChange(edit, caretOffsetOf(snapshot)),
    moveCaret: (offset) => {
      snapshot = editorSnapshot(viewText(snapshot), offset, snapshot.textVersion)
      contribution.update(snapshot, 'selection', null)
    },
    selectRange: (start, end) => {
      snapshot = editorSnapshot(viewText(snapshot), end, snapshot.textVersion, start)
      contribution.update(snapshot, 'selection', null)
    },
    scroll: (by) => {
      anchorRect = new DOMRect(anchorRect.x, anchorRect.y - by, anchorRect.width, anchorRect.height)
      contribution.update(snapshot, 'viewport', null)
    },
    pressKey: (key, modifiers = {}) => {
      const event = new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
        ...modifiers,
      })
      element.dispatchEvent(event)
      return event
    },
    answerCompletion: (items, isIncomplete = false) =>
      answer('textDocument/completion', { isIncomplete, items }),
    answerResolve: (item) => answer('completionItem/resolve', item),
    completionElement: () => {
      const widget = document.querySelector<HTMLElement>('.editor-test-lsp-completion')
      if (!widget) throw new Error('missing completion widget')
      return widget
    },
    completionAnchorElement: () => {
      const anchor = document.querySelector<HTMLElement>('.editor-test-lsp-completion-anchor')
      if (!anchor) throw new Error('missing completion anchor')
      return anchor
    },
    completionLabels: () =>
      Array.from(
        document.querySelectorAll<HTMLElement>('.editor-test-lsp-completion [role="option"]'),
        (row) => row.children[1]?.textContent ?? '',
      ),
    focusedCompletionLabel: () =>
      document.querySelector<HTMLElement>('.editor-test-lsp-completion [aria-selected="true"]')
        ?.children[1]?.textContent ?? null,
    completionRequests: () =>
      transport.sent
        .map(jsonMessage)
        .filter((sent) => sent.method === 'textDocument/completion')
        .map((sent) => sent.params as lsp.CompletionParams),
  }
}

function activateProvider(
  transport: LspManagedTransport,
  features: Map<unknown, unknown>,
  applyEdits: EditorEditContributionContext['applyEdits'],
  commands: Map<EditorAnyCommandId, EditorCommandHandler>,
): EditorViewContributionProvider {
  let provider: EditorViewContributionProvider | null = null
  const disposable = { dispose: () => undefined }
  createLanguageServerAdapterPlugin({
    name: 'editor.test-lsp',
    createTransport: () => transport,
    completion: {
      acceptTimingName: COMPLETION_ACCEPT_TIMING_NAME,
      widgetClassNamespace: 'test-lsp',
    },
  }).activate(
    createTestPluginContext({
      registerViewContribution: (value) => {
        provider = value
        return disposable
      },
      registerCommandContribution: (value) => {
        value.createContribution({
          registerCommand: (commandId, handler) => {
            commands.set(commandId, handler)
            return { dispose: () => commands.delete(commandId) }
          },
        })
        return disposable
      },
      registerEditContribution: (value) => {
        value.createContribution(
          createTestEditContributionContext({
            materializeFullText: () => '',
            applyEdits,
            registerFeature: (id, feature) => {
              features.set(id, feature)
              return { dispose: () => features.delete(id) }
            },
          }),
        )
        return disposable
      },
    }),
  )

  if (!provider) throw new Error('missing provider')
  return provider
}

function viewContributionContext(options: {
  element: HTMLDivElement
  getSnapshot(): EditorViewSnapshot
  getRangeClientRect(): DOMRect
  getFeature(token: unknown): unknown
  registerKeymapContextKey: EditorViewContributionContext['registerKeymapContextKey']
}): EditorViewContributionContext {
  return createTestViewContributionContext({
    registerKeymapContextKey: options.registerKeymapContextKey,
    container: options.element,
    scrollElement: options.element,
    contentElement: options.element,
    highlightPrefix: 'editor-test',
    getSnapshot: options.getSnapshot,
    getFeature: options.getFeature as EditorViewContributionContext['getFeature'],
    textOffsetFromPoint: vi.fn(() => 0),
    getRangeClientRect: () => options.getRangeClientRect(),
  })
}

function editorSnapshot(
  fullText: string,
  caretOffset: number,
  textVersion: number,
  anchorOffset = caretOffset,
): EditorViewSnapshot {
  return {
    ...documentSyncSnapshotFields(textVersion),
    ...viewSnapshotStructuralFields(),
    documentId: 'src/index.ts',
    languageId: 'typescript',
    ...viewTextFields(fullText),
    textVersion,
    tokens: EditorTokenStore.empty(),
    brackets: [],
    selections: [
      {
        anchorOffset,
        headOffset: caretOffset,
        startOffset: Math.min(anchorOffset, caretOffset),
        endOffset: Math.max(anchorOffset, caretOffset),
        affinity: 'after',
      },
    ],
    metrics: {} as EditorViewSnapshot['metrics'],
    lineCount: 1,
    contentWidth: 0,
    totalHeight: 0,
    tabSize: 4,
    foldMarkers: [],
    visibleRows: [],
    viewport: {
      scrollRow: 0,
      scrollTop: 0,
      scrollLeft: 0,
      scrollHeight: 0,
      scrollWidth: 0,
      clientHeight: 0,
      clientWidth: 0,
      visibleRange: { start: 0, end: 1 } as EditorViewSnapshot['viewport']['visibleRange'],
    },
  }
}

function caretOffsetOf(snapshot: EditorViewSnapshot): number {
  const selection = snapshot.selections[0]
  if (!selection) throw new Error('missing selection')
  return selection.headOffset
}

function singleLineRange(start: number, end: number): lsp.Range {
  return { start: { line: 0, character: start }, end: { line: 0, character: end } }
}

function documentChange(edits: readonly TextEdit[]): DocumentSessionChange {
  return { kind: 'edit', edits } as unknown as DocumentSessionChange
}

function jsonMessage(item: unknown): JsonMessage {
  if (typeof item !== 'string') throw new Error('missing JSON message')
  return JSON.parse(item) as JsonMessage
}

/**
 * Microtasks, until the widget has caught up with the answer.
 *
 * An answer is handed along by several awaits before a row is on screen, and each of them costs a
 * turn of the queue; stopping after a fixed pair of turns leaves the assertions reading the list as
 * it stood before the server replied.
 */
async function flushPromises(): Promise<void> {
  for (let tick = 0; tick < 6; tick += 1) await Promise.resolve()
}
