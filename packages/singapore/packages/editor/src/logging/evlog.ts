import { initLog, log as evlog } from 'evlog/client'
import type { EditorLogEvent, EditorLogLevel, EditorLogger, EditorPlugin } from '../plugins'

export * from './errors'

type EvlogClient = {
  debug(event: Record<string, unknown>): void
  error(event: Record<string, unknown>): void
  info(event: Record<string, unknown>): void
  warn(event: Record<string, unknown>): void
}

type EvlogInitOptions = Parameters<typeof initLog>[0]

let evlogInitialized = false

export type EditorEvlogLoggingPluginOptions = {
  readonly init?: false | EvlogInitOptions
  readonly log?: EvlogClient
  readonly mapEvent?: (event: EditorLogEvent) => Record<string, unknown>
  readonly name?: string
}

export function createEditorEvlogLoggingPlugin(
  options: EditorEvlogLoggingPluginOptions = {},
): EditorPlugin {
  return {
    name: options.name ?? 'editor.evlog-logging',
    activate(context) {
      initializeEvlog(options.init)
      return context.registerLogger(createEditorEvlogLogger(options))
    },
  }
}

export function createEditorEvlogLogger(
  options: EditorEvlogLoggingPluginOptions = {},
): EditorLogger {
  const target = options.log ?? evlog
  const mapEvent = options.mapEvent ?? editorLogEventToEvlogEvent

  return (event) => {
    target[event.level](mapEvent(event))
  }
}

export function createEditorEvlogPlugin(
  options: EditorEvlogLoggingPluginOptions = {},
): EditorPlugin {
  return createEditorEvlogLoggingPlugin(options)
}

function initializeEvlog(options: false | EvlogInitOptions | undefined): void {
  if (options === false) return
  if (evlogInitialized) return

  initLog({
    console: true,
    pretty: true,
    service: 'editor',
    ...options,
  })
  evlogInitialized = true
}

function editorLogEventToEvlogEvent(event: EditorLogEvent): Record<string, unknown> {
  return {
    ...event,
    action: event.action,
    source: event.source,
    timestamp: event.timestamp,
  }
}

export type { EditorLogEvent, EditorLogger, EditorLogLevel }
