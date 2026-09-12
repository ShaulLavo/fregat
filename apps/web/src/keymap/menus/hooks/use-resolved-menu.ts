import { useCommand } from '@/keymap/hooks/use-command'
import type { CommandInvocation } from '@/keymap/state/command-bus'
import type { MenuSurfaceId } from '@/keymap/types'
import type { FocusTargetToken } from '@/lib/focus/state/service'
import type { Menu } from '@/keymap/menus/utils/model'
import { resolveMenu, type ResolvedMenu } from '@/keymap/menus/utils/resolve'

/**
 * Binds a menu definition to the live command table. Availability is read from
 * the same source the command palette uses, so an item cannot be enabled in
 * one surface and disabled in the other.
 */
export function useResolvedMenu(
  menu: Menu,
  surface: MenuSurfaceId,
  origin: FocusTargetToken | null,
): ResolvedMenu {
  const { bindings, bus } = useCommand()
  const invocation = {
    origin,
    source: { kind: 'menu', surface },
  } satisfies CommandInvocation

  return resolveMenu(menu, {
    bindings,
    dispatch: (command) => bus.dispatch(command, invocation),
    inspect: (command) => bus.inspect(command, invocation),
  })
}
