import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createEditorLoggingPlugin, Editor, type EditorLogEvent } from '../src/editor'
import { resetEditorInstanceCount } from '../src/public/testing'
import {
  createEditorCapabilityToken,
  createEditorLanguageFeatureToken,
  type EditorCapabilityToken,
  type EditorLanguageFeatureSelector,
  type EditorPlugin,
} from '../src/public/extensions'

type CompletionSource = {
  readonly name: string
}

const COMPLETION_SOURCES =
  createEditorLanguageFeatureToken<CompletionSource>('test.completionSources')

/**
 * A source registers the way a language server or a snippet set will: through a contribution, at
 * the point the editor hands it a context, and with a selector saying which documents it can speak
 * for.
 */
function createSourcePlugin(name: string, selector: EditorLanguageFeatureSelector): EditorPlugin {
  return {
    name,
    activate: (context) =>
      context.registerCapabilityContribution({
        createContribution: (capabilityContext) => {
          const registration = capabilityContext.registerProvider!(COMPLETION_SOURCES, selector, {
            name,
          })
          return { dispose: () => registration.dispose() }
        },
      }),
  }
}

/**
 * The consumer side of a language feature: it asks on every update, for the language of the text it
 * is answering about, and records what came back so the ordering is read from the same array a
 * widget would have merged.
 */
function createConsumerPlugin(seen: (readonly CompletionSource[])[]): EditorPlugin {
  return {
    name: 'consumer',
    activate: (context) =>
      context.registerViewContribution({
        createContribution: (viewContext) => ({
          update: (snapshot) => {
            seen.push(viewContext.getProviders!(COMPLETION_SOURCES, snapshot.languageId))
          },
          dispose: () => undefined,
        }),
      }),
  }
}

function createOwnerPlugin(
  token: EditorCapabilityToken<CompletionSource>,
  name: string,
): EditorPlugin {
  return {
    name: `owner-${name}`,
    activate: (context) =>
      context.registerCapabilityContribution({
        createContribution: (capabilityContext) => {
          const registration = capabilityContext.registerFeature(token, { name })
          return { dispose: () => registration.dispose() }
        },
      }),
  }
}

function latestSourceNames(seen: (readonly CompletionSource[])[]): readonly string[] {
  return (seen.at(-1) ?? []).map((source) => source.name)
}

describe('language feature providers', () => {
  let container: HTMLElement
  let editor: Editor
  let seen: (readonly CompletionSource[])[]

  beforeEach(() => {
    resetEditorInstanceCount()
    seen = []
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    editor.dispose()
    container.remove()
  })

  it('keeps every source registered for one feature, most specific first', () => {
    editor = new Editor(container, {
      plugins: [
        createSourcePlugin('ambient', { language: '*' }),
        createSourcePlugin('server', { language: 'typescript' }),
        createSourcePlugin('snippets', { language: '*' }),
        createConsumerPlugin(seen),
      ],
    })

    editor.setText('const value = 1', { languageId: 'typescript' })

    // The one that named the language is asked before the two that took any document.
    expect(latestSourceNames(seen)).toEqual(['server', 'ambient', 'snippets'])
  })

  it('leaves out a source registered for a language the document is not written in', () => {
    editor = new Editor(container, {
      plugins: [
        createSourcePlugin('python', { language: 'python' }),
        createSourcePlugin('ambient', { language: '*' }),
        createConsumerPlugin(seen),
      ],
    })

    editor.setText('const value = 1', { languageId: 'typescript' })
    expect(latestSourceNames(seen)).toEqual(['ambient'])

    editor.setText('value = 1', { languageId: 'python' })
    expect(latestSourceNames(seen)).toEqual(['python', 'ambient'])
  })

  it('answers a document of unknown language from the sources that took any document', () => {
    editor = new Editor(container, {
      plugins: [
        createSourcePlugin('typescript', { language: 'typescript' }),
        createSourcePlugin('ambient', { language: '*' }),
        createConsumerPlugin(seen),
      ],
    })

    editor.setText('const value = 1')

    expect(latestSourceNames(seen)).toEqual(['ambient'])
  })

  it('meets a source that declared the token itself on the same feature', () => {
    // Two packages that cannot import each other's token — a language server and an editor
    // extension that only knows the id — still have to land in one widget.
    const restated = createEditorLanguageFeatureToken<CompletionSource>('test.completionSources')
    const stranger: EditorPlugin = {
      name: 'stranger',
      activate: (context) =>
        context.registerCapabilityContribution({
          createContribution: (capabilityContext) => {
            const registration = capabilityContext.registerProvider!(
              restated,
              { language: 'typescript' },
              { name: 'stranger' },
            )
            return { dispose: () => registration.dispose() }
          },
        }),
    }

    editor = new Editor(container, {
      plugins: [
        createSourcePlugin('ambient', { language: '*' }),
        stranger,
        createConsumerPlugin(seen),
      ],
    })

    editor.setText('const value = 1', { languageId: 'typescript' })

    expect(latestSourceNames(seen)).toEqual(['stranger', 'ambient'])
  })

  it('orders by priority only among sources that fit the document equally well', () => {
    editor = new Editor(container, {
      plugins: [
        // Registered behind the source it has to overtake, so nothing but the priority can put it
        // in front: registration order alone would leave it last.
        createSourcePlugin('fallback', { language: '*' }),
        createSourcePlugin('boost', { language: '*', priority: 100 }),
        createSourcePlugin('server', { language: 'typescript' }),
        createConsumerPlugin(seen),
      ],
    })

    editor.setText('const value = 1', { languageId: 'typescript' })

    // The priority moves 'boost' ahead of the other any-document source without moving it ahead of
    // the language's own, which was registered last of the three: a general source that claims a
    // large number would otherwise shadow the server for every language at once.
    expect(latestSourceNames(seen)).toEqual(['server', 'boost', 'fallback'])
  })

  it('keeps a source registered by the contribution that owns what answers for it', () => {
    // A source backed by a connection registers from the view contribution that opened it, and has
    // to stop being asked when that contribution goes away rather than when its plugin does.
    const connected: EditorPlugin = {
      name: 'connected',
      activate: (context) =>
        context.registerViewContribution({
          createContribution: (viewContext) => {
            const registration = viewContext.registerProvider!(
              COMPLETION_SOURCES,
              { language: 'typescript' },
              { name: 'connected' },
            )
            return { update: () => undefined, dispose: () => registration.dispose() }
          },
        }),
    }

    editor = new Editor(container, {
      plugins: [createSourcePlugin('ambient', { language: '*' }), connected],
    })
    editor.addPlugin(createConsumerPlugin(seen))
    editor.setText('const value = 1', { languageId: 'typescript' })

    expect(latestSourceNames(seen)).toEqual(['connected', 'ambient'])

    editor.removePlugin(connected)
    editor.edit({ from: 0, to: 0, text: 'x' })

    expect(latestSourceNames(seen)).toEqual(['ambient'])
  })

  it('takes every source for a feature where a capability takes only the first owner', () => {
    // The two channels are told apart by what a second registration under one id does, and that is
    // the whole difference: a capability has one owner for the editor, a feature has as many
    // sources as answer it.
    const capability = createEditorCapabilityToken<{ readonly name: string }>('test.oneOwner')
    const events: EditorLogEvent[] = []

    editor = new Editor(container, {
      plugins: [
        createEditorLoggingPlugin((event) => events.push(event)),
        createOwnerPlugin(capability, 'first'),
        createOwnerPlugin(capability, 'second'),
        createSourcePlugin('first', { language: '*' }),
        createSourcePlugin('second', { language: '*' }),
        createConsumerPlugin(seen),
      ],
    })

    editor.setText('const value = 1', { languageId: 'typescript' })

    expect(latestSourceNames(seen)).toEqual(['first', 'second'])
    expect(events.some((event) => event.action === 'editor.contribution.factory_failed')).toBe(true)
  })

  it('takes back a source registered by a contribution that never finished being built', () => {
    // Nothing else can drop it afterwards: the factory threw before it could return the object
    // whose disposal is what a source is unregistered by, so the editor either unwinds the
    // registration here or keeps asking a source no plugin admits to owning.
    const abandoned: EditorPlugin = {
      name: 'abandoned',
      activate: (context) =>
        context.registerCapabilityContribution({
          createContribution: (capabilityContext) => {
            capabilityContext.registerProvider!(
              COMPLETION_SOURCES,
              { language: '*' },
              { name: 'orphan' },
            )
            throw new Error('missing dependency')
          },
        }),
    }

    editor = new Editor(container, {
      plugins: [abandoned, createSourcePlugin('ambient', { language: '*' })],
    })
    editor.addPlugin(createConsumerPlugin(seen))
    editor.setText('const value = 1', { languageId: 'typescript' })

    expect(latestSourceNames(seen)).toEqual(['ambient'])
  })

  it('drops a source when the plugin that registered it goes away', () => {
    const snippets = createSourcePlugin('snippets', { language: '*' })
    editor = new Editor(container, {
      plugins: [createSourcePlugin('server', { language: 'typescript' }), snippets],
    })
    editor.addPlugin(createConsumerPlugin(seen))

    editor.setText('const value = 1', { languageId: 'typescript' })
    expect(latestSourceNames(seen)).toEqual(['server', 'snippets'])

    editor.removePlugin(snippets)
    editor.edit({ from: 0, to: 0, text: 'x' })

    expect(latestSourceNames(seen)).toEqual(['server'])
  })

  it('hands back the same ordering until a registration moves', () => {
    editor = new Editor(container, {
      plugins: [
        createSourcePlugin('server', { language: 'typescript' }),
        createConsumerPlugin(seen),
      ],
    })

    editor.setText('const value = 1', { languageId: 'typescript' })
    const first = seen.at(-1)
    expect(latestSourceNames(seen)).toEqual(['server'])

    // Every keystroke asks again, and a consumer that compares what it got against what it held
    // should find nothing to redo while the registrations stand still.
    editor.edit({ from: 0, to: 0, text: 'x' })
    expect(seen.at(-1)).toBe(first)

    editor.addPlugin(createSourcePlugin('snippets', { language: '*' }))
    editor.edit({ from: 0, to: 0, text: 'y' })

    expect(seen.at(-1)).not.toBe(first)
    expect(latestSourceNames(seen)).toEqual(['server', 'snippets'])
  })
})
