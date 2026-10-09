import { RenderErrorBoundary } from '@workspace/ui/patterns/render-error-boundary'

import { SessionRail } from '@/features/chat-mode/components/session-rail'
import { Header } from '@/features/phone/components/header'
import { SettingsButton } from '@/features/phone/components/settings-button'
import { preloadSession } from '@/features/phone/utils/preload-session'
import { warmDeferredOverlays } from '@/components/utils/overlay-modules'

/** The phone's first screen: every session, the ones waiting on you first. */
export function SessionsScreen() {
  return (
    <section aria-label='Sessions' className='flex h-full min-h-0 flex-col'>
      <Header actions={<SettingsButton caller='phone-sessions' />} title='Sessions' />
      <div className='min-h-0 flex-1'>
        <RenderErrorBoundary label='Sessions'>
          <SessionRail onReady={warmAfterList} standalone />
        </RenderErrorBoundary>
      </div>
    </section>
  )
}

// After the list paints: the likely next screen first, then the closed dialogs its menus open.
function warmAfterList() {
  preloadSession()
  warmDeferredOverlays()
}
