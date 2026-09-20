import type { ComponentProps } from 'react'

import { useFocusTarget } from '@/lib/focus/hooks/use-target'
import type { FocusTargetRegistrationUpdate } from '@/lib/focus/state/service'

type FocusablePanelProps = Omit<ComponentProps<'section'>, 'ref'> &
  Pick<FocusTargetRegistrationUpdate, 'area'> & {
    target: FocusTargetRegistrationUpdate['id']
  }

export function FocusablePanel({ area, target, ...props }: FocusablePanelProps) {
  const { ref } = useFocusTarget<HTMLElement>({
    area,
    id: target,
    onIntent: (intent, element) => {
      if (intent !== 'focus') return false
      element.focus()
      return true
    },
  })

  return <section {...props} ref={ref} tabIndex={-1} />
}
