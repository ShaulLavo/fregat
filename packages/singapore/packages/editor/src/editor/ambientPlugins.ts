import {
  ambientEditorPlugins,
  subscribeAmbientEditorPlugins,
  type AmbientEditorPlugin,
  type EditorLanguageFeatureRegistry,
  type EditorPlugin,
} from '../plugins'
import { type EditorDisposable } from './disposables'

type Installed = {
  generation: number
  registration: EditorDisposable | null
}

/** One load per ambient plugin, shared by every editor that comes to need it. */
const loaded = new WeakMap<AmbientEditorPlugin, EditorPlugin | Promise<EditorPlugin>>()

/**
 * Keeps one editor's set of installed ambient plugins equal to the set whose demand it has: a
 * provider for the demanded token registered in this editor's registry. Follows both lists live,
 * so a participant registered later still brings its plugin, and an ambient registered after the
 * editor is still picked up.
 */
export class EditorAmbientPluginController implements EditorDisposable {
  private readonly installed = new Map<AmbientEditorPlugin, Installed>()
  private readonly subscriptions: EditorDisposable[]
  private generation = 0
  private disposed = false

  public constructor(
    private readonly registry: EditorLanguageFeatureRegistry,
    private readonly host: { addPlugin(plugin: EditorPlugin): EditorDisposable },
    private readonly onError: (ambient: AmbientEditorPlugin, error: unknown) => void,
  ) {
    this.subscriptions = [
      registry.subscribe(() => this.sync()),
      subscribeAmbientEditorPlugins(() => this.sync()),
    ]
    this.sync()
  }

  public dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const subscription of this.subscriptions) subscription.dispose()
    for (const ambient of Array.from(this.installed.keys())) this.uninstall(ambient)
  }

  private sync(): void {
    if (this.disposed) return
    const wanted = new Set<AmbientEditorPlugin>()
    for (const ambient of ambientEditorPlugins()) {
      if (this.registry.count(ambient.demand) === 0) continue
      wanted.add(ambient)
      if (!this.installed.has(ambient)) this.install(ambient)
    }
    for (const ambient of Array.from(this.installed.keys())) {
      if (!wanted.has(ambient)) this.uninstall(ambient)
    }
  }

  private install(ambient: AmbientEditorPlugin): void {
    this.generation += 1
    const entry: Installed = { generation: this.generation, registration: null }
    this.installed.set(ambient, entry)
    const plugin = loadOnce(ambient)
    if (!isPromise(plugin)) {
      entry.registration = this.host.addPlugin(plugin)
      return
    }

    void plugin.then(
      (resolved) => {
        // Demand may have gone, or come and gone and come back, while the code was loading.
        if (this.installed.get(ambient) !== entry) return
        entry.registration = this.host.addPlugin(resolved)
      },
      (error: unknown) => {
        if (this.installed.get(ambient) === entry) this.installed.delete(ambient)
        loaded.delete(ambient)
        this.onError(ambient, error)
      },
    )
  }

  private uninstall(ambient: AmbientEditorPlugin): void {
    const entry = this.installed.get(ambient)
    if (!entry) return
    this.installed.delete(ambient)
    entry.registration?.dispose()
  }
}

function loadOnce(ambient: AmbientEditorPlugin): EditorPlugin | Promise<EditorPlugin> {
  const existing = loaded.get(ambient)
  if (existing) return existing
  const plugin = ambient.load()
  loaded.set(ambient, plugin)
  if (!isPromise(plugin)) return plugin
  // Settle to the instance so later editors do not re-await, and forget a load that failed.
  return plugin.then(
    (resolved) => {
      loaded.set(ambient, resolved)
      return resolved
    },
    (error: unknown) => {
      loaded.delete(ambient)
      throw error
    },
  )
}

function isPromise<T>(value: T | Promise<T>): value is Promise<T> {
  return typeof (value as Promise<T>).then === 'function'
}
