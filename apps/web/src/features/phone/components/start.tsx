import type { ReactNode } from 'react'

import { Frame } from '@/features/phone/components/frame'
import { Header } from '@/features/phone/components/header'
import { SettingsButton } from '@/features/phone/components/settings-button'
import { usePrimaryMachineLabel } from '@/hooks/use-primary-machine-label'

/** The phone with no folder open: its own bar over the first-workspace choice. */
export function Start({ children }: { readonly children: ReactNode }) {
  const machine = usePrimaryMachineLabel()

  return (
    <Frame>
      <section aria-label='New chat' className='flex h-full min-h-0 flex-col'>
        <Header
          actions={<SettingsButton caller='phone-start' />}
          detail={machine ? <span>{machine}</span> : null}
          title='Fregat'
        />
        {children}
      </section>
    </Frame>
  )
}
