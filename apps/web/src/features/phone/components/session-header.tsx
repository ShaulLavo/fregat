import { GitDiffIcon, TerminalWindowIcon } from '@phosphor-icons/react'

import { SessionActionsButton } from '@/components/session-actions-button'
import { useNavigation } from '@/hooks/use-navigation'
import { SessionAttentionIndicator } from '@/features/chat-mode/components/session-attention-indicator'
import type { StageHeaderProps } from '@/features/chat-mode/components/stage-header'
import {
  sessionStatusLabel,
  sessionStatusTextClass,
} from '@/features/chat-mode/utils/attention-state'
import { cn } from '@workspace/ui/lib/utils'
import { stageTitle } from '@/features/chat-mode/utils/stage-title'
import { Header } from '@/features/phone/components/header'
import { commandItem, section } from '@/keymap/menus/utils/model'
import { HeaderButton } from '@/features/phone/components/header-button'

// The long tail of chat commands has chords and no control; the palette reaches all of them.
const PHONE_MORE = section('phone', [
  commandItem('workspace.showCommandPalette', { takesFocus: true }),
])

/** The session screen's bar: Back, the title over its project and status, then what it pushes. */
export function SessionHeader({ projectTitle, session }: StageHeaderProps) {
  const navigation = useNavigation()
  const status =
    session && session.status !== 'ready' ? (
      <span
        className={cn(
          'flex items-center gap-(--density-gap-tight)',
          sessionStatusTextClass(session.status),
        )}
      >
        <SessionAttentionIndicator status={session.status} />
        {sessionStatusLabel(session.status)}
      </span>
    ) : null

  return (
    <Header
      actions={
        session ? (
          <>
            <HeaderButton
              icon={GitDiffIcon}
              label='Changes'
              onClick={() => void navigation.showPhoneScreen('changes')}
            />
            <HeaderButton
              icon={TerminalWindowIcon}
              label='Terminal'
              onClick={() => void navigation.showPhoneScreen('terminal')}
            />
            <SessionActionsButton more={PHONE_MORE} session={session} surface='header' />
          </>
        ) : null
      }
      detail={status ?? projectTitle}
      fullTitle={stageTitle(projectTitle, session)}
      title={session?.title ?? 'New session'}
    />
  )
}
