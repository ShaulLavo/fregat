import type { EditorLogEvent, EditorLogLevel, EditorLogger, EditorPlugin } from '../plugins'

export type EditorLoggingPluginOptions = {
  readonly name?: string
}

export type EditorConsoleLoggingPluginOptions = EditorLoggingPluginOptions & {
  readonly console?: Pick<Console, 'debug' | 'error' | 'log' | 'warn'>
  readonly minLevel?: EditorLogLevel
}

export function createEditorLoggingPlugin(
  logger: EditorLogger,
  options: EditorLoggingPluginOptions = {},
): EditorPlugin {
  return {
    name: options.name ?? 'editor.logging',
    activate(context) {
      return context.registerLogger(logger)
    },
  }
}

export function createEditorConsoleLoggingPlugin(
  options: EditorConsoleLoggingPluginOptions = {},
): EditorPlugin {
  return createEditorLoggingPlugin(createEditorConsoleLogger(options), {
    name: options.name ?? 'editor.console-logging',
  })
}

export function createEditorConsoleLogger(
  options: EditorConsoleLoggingPluginOptions = {},
): EditorLogger {
  const target = options.console ?? console
  const minLevel = options.minLevel ?? 'info'

  return (event) => {
    if (!levelEnabled(event.level, minLevel)) return

    writeConsoleEvent(target, event)
  }
}

function writeConsoleEvent(
  target: Pick<Console, 'debug' | 'error' | 'log' | 'warn'>,
  event: EditorLogEvent,
): void {
  const method = consoleMethod(event.level)
  target[method]('[editor]', event.action, event)
}

function consoleMethod(level: EditorLogLevel): 'debug' | 'error' | 'log' | 'warn' {
  if (level === 'debug') return 'debug'
  if (level === 'error') return 'error'
  if (level === 'warn') return 'warn'
  return 'log'
}

function levelEnabled(level: EditorLogLevel, minLevel: EditorLogLevel): boolean {
  return levelPriority(level) >= levelPriority(minLevel)
}

function levelPriority(level: EditorLogLevel): number {
  if (level === 'debug') return 10
  if (level === 'info') return 20
  if (level === 'warn') return 30
  return 40
}

export type {
  EditorLogEditorContext,
  EditorLogError,
  EditorLogEvent,
  EditorLogInput,
  EditorLogger,
  EditorLogLevel,
} from '../plugins'
