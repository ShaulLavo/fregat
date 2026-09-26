import { GearSixIcon, CommandIcon } from '@phosphor-icons/react'
import { RenderErrorBoundary } from '@workspace/ui/patterns/render-error-boundary'

import { SessionRail } from '@/features/chat-mode/components/session-rail'
import { Header } from '@/features/phone/components/header'
import { HeaderButton } from '@/features/phone/components/header-button'
import { useCommandBus } from '@/keymap/hooks/use-command-bus'

/** The phone's first screen: every session, the ones waiting on you first. */
export function SessionsScreen() {
  const bus = useCommandBus()
  const source = { kind: 'programmatic', caller: 'phone-sessions' } as const

  return (
    <section aria-label='Sessions' className='flex h-full min-h-0 flex-col'>
      <Header
        actions={
          <>
            <HeaderButton
              command='workspace.showCommandPalette'
              icon={CommandIcon}
              label='Command palette'
              onClick={() => bus.dispatch('workspace.showCommandPalette', { source })}
            />
            <HeaderButton
              command='workspace.showSettings'
              icon={GearSixIcon}
              label='Settings'
              onClick={() => bus.dispatch('workspace.showSettings', { source })}
            />
          </>
        }
        title='Sessions'
      />
      <div className='min-h-0 flex-1'>
        <RenderErrorBoundary label='Sessions'>
          <SessionRail standalone />
        </RenderErrorBoundary>
      </div>
    </section>
  )
}
