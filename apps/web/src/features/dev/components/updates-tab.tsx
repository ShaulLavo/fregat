import type { BusySession } from '@workspace/contracts'
import { Button } from '@workspace/ui/components/button'
import { PaneBar } from '@workspace/ui/components/pane-bar'
import { useState } from 'react'

import { Section } from '@/features/dev/components/section'
import { UpdatePopover } from '@/features/server-update/components/update-popover'

const BUSY: readonly BusySession[] = [
  {
    sessionId: '1d09dc9b-3c5d-4dd8-9d54-a81eb103a45a' as BusySession['sessionId'],
    title: 'Fix the parser',
    projectTitle: 'Fregat',
    state: 'running',
  },
  {
    sessionId: '2d09dc9b-3c5d-4dd8-9d54-a81eb103a45a' as BusySession['sessionId'],
    title: 'Review the changes',
    projectTitle: 'Fregat',
    state: 'waiting',
  },
]

export function UpdatesTab() {
  const [open, setOpen] = useState(true)

  return (
    <div className='mx-auto flex max-w-3xl flex-col gap-8 p-(--density-section-padding)'>
      <Section title='Update control' detail='One action updates the server and reloads the page.'>
        <PaneBar>
          <span className='flex-1 text-xs font-medium'>Fregat</span>
          <UpdatePopover
            busy={BUSY}
            dirtyFiles={['src/app.tsx']}
            onOpenChange={setOpen}
            onUpdate={() => setOpen(false)}
            onWait={() => setOpen(false)}
            open={open}
            pending={false}
          >
            <Button size='xs' variant='secondary'>
              Update app
            </Button>
          </UpdatePopover>
        </PaneBar>
      </Section>
      <Section
        title='Restart in progress'
        detail='The update continues while the server reconnects.'
      >
        <PaneBar>
          <span className='flex-1 text-xs font-medium'>Fregat</span>
          <Button aria-busy size='xs' variant='secondary'>
            Updating…
          </Button>
        </PaneBar>
      </Section>
      <Section
        title='Page update'
        detail='Reload app applies a web release after unsaved files are saved.'
      >
        <PaneBar>
          <span className='flex-1 text-xs font-medium'>Fregat</span>
          <Button size='xs' variant='secondary'>
            Reload app
          </Button>
        </PaneBar>
      </Section>
    </div>
  )
}
