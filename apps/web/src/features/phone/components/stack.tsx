import { useShellStore } from '@/lib/shell/state/store'
import { useSessionDiffScope } from '@/features/chat/hooks/use-session-diff-scope'
import { useSessionCheckoutRefresh } from '@/features/chat-mode/hooks/use-session-checkout-refresh'
import { useSessionSelectionStore } from '@/features/chat-mode/state/session-selection-store'
import { Frame } from '@/features/phone/components/frame'
import { Screen } from '@/features/phone/components/screen'
import { useBackAction } from '@/features/phone/hooks/use-back-action'
import { useBackClosesSheet } from '@/features/phone/hooks/use-back-closes-sheet'
import { useLongPressMenus } from '@/features/phone/hooks/use-long-press-menus'
import { useStart } from '@/features/phone/hooks/use-start'
import { BackContext } from '@/features/phone/providers/back-context'
import { phoneLevel } from '@/features/phone/utils/level'

/** One screen at a time, chosen by the address, so the browser's Back gesture walks the stack. */
export function Stack({ rootPath }: { readonly rootPath: string }) {
  const selection = useSessionSelectionStore((state) => state.selection.kind)
  const screen = useShellStore((state) => state.phoneScreen)
  const level = phoneLevel(selection, screen)
  const back = useBackAction(level, selection)
  // Mounted at every level, as the chat tool pane mounts them for every tab: the diff pick must
  // leave a turn a revert deleted even while the changes screen is closed.
  const diffScope = useSessionDiffScope()
  useSessionCheckoutRefresh()
  useBackClosesSheet()
  useStart()
  useLongPressMenus()

  return (
    <BackContext value={back}>
      <Frame>
        <Screen diffScope={diffScope} level={level} rootPath={rootPath} />
      </Frame>
    </BackContext>
  )
}
