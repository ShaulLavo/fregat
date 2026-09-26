import { use } from 'react'

import { BackContext } from '@/features/phone/providers/back-context'

export function useBack() {
  return use(BackContext)
}
