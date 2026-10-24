import { describe, expect, test } from 'vitest'
import type { EditorInjectedTextRowProvider, EditorPluginHostEvents } from '../src/plugins'
import type { EditorDisposable } from '../src/editor/disposables'
import { EditorPluginHost } from '../src/plugins'

describe('editor plugin host teardown', () => {
  test('contains a failing plugin dispose and finishes tearing the host down', () => {
    const disposeFailures: string[] = []
    const host = new EditorPluginHost()
    host.setEvents({
      onPluginDisposeFailed: (name, error) => {
        disposeFailures.push(`${name}: ${String(error)}`)
      },
    })
    let secondDisposed = false
    let installationUnwound = false

    host.setPlugins([
      {
        name: 'failing-dispose',
        install: () => ({
          dispose: () => {
            installationUnwound = true
          },
        }),
        activate: () => undefined,
        dispose: () => {
          throw new Error('dispose failed')
        },
      },
      {
        name: 'later-plugin',
        activate: () => undefined,
        dispose: () => {
          secondDisposed = true
        },
      },
    ])

    expect(() => host.dispose()).not.toThrow()

    expect(installationUnwound).toBe(true)
    expect(secondDisposed).toBe(true)
    expect(disposeFailures).toEqual(['failing-dispose: Error: dispose failed'])
  })

  test('keeps the surviving lease of a twice-registered injected text row provider live', () => {
    const host = new EditorPluginHost()
    let changes = 0
    const events: EditorPluginHostEvents = {
      onInjectedTextRowProvidersChanged: () => {
        changes += 1
      },
    }
    host.setEvents(events)
    const provider = createInjectedTextRowEmitter()
    const leases: EditorDisposable[] = []

    host.setPlugins([
      {
        name: 'double-registration',
        activate: (context) => {
          leases.push(context.registerInjectedTextRowProvider(provider))
          leases.push(context.registerInjectedTextRowProvider(provider))
        },
      },
    ])

    leases[0]?.dispose()

    expect(host.getInjectedTextRowProviders()).toHaveLength(1)

    changes = 0
    provider.fireChange()

    expect(changes).toBe(1)

    host.dispose()
  })
})

type InjectedTextRowEmitter = EditorInjectedTextRowProvider & {
  fireChange(): void
}

/** Models a real emitter: an unsubscribed listener stops hearing about changes. */
function createInjectedTextRowEmitter(): InjectedTextRowEmitter {
  const listeners = new Set<() => void>()

  return {
    getInjectedTextRows: () => [],
    onDidChangeInjectedTextRows: (listener) => {
      listeners.add(listener)
      return { dispose: () => listeners.delete(listener) }
    },
    fireChange: () => {
      for (const listener of listeners) listener()
    },
  }
}
