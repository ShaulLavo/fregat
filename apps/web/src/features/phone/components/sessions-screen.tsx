import { RenderErrorBoundary } from '@workspace/ui/patterns/render-error-boundary'

import { SessionRail } from '@/features/chat-mode/components/session-rail'
import { Header } from '@/features/phone/components/header'
import { SettingsButton } from '@/features/phone/components/settings-button'
import { preloadSession } from '@/features/phone/utils/preload-session'

/** The phone's first screen: every session, the ones waiting on you first. */
export function SessionsScreen() {
  return (
    <section aria-label='Sessions' className='flex h-full min-h-0 flex-col'>
      <Header actions={<SettingsButton caller='phone-sessions' />} title='Sessions' />
      <div className='min-h-0 flex-1'>
        <RenderErrorBoundary label='Sessions'>
          <SessionRail onReady={preloadSession} standalone />
        </RenderErrorBoundary>
      </div>
    </section>
  )
}
