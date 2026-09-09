import type { CommandContext } from '@/commands/state/bus'

export function railKeyTarget(context: CommandContext) {
  if (context.source !== 'keybinding' || context.target?.widgetId === 'agent-rail') return null
  return 'Focus the session rail before using this shortcut.'
}
