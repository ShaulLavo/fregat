import { CaretLeftIcon } from '@phosphor-icons/react'

import { HeaderButton } from '@/features/phone/components/header-button'
import { useBack } from '@/features/phone/hooks/use-back'

export function BackButton() {
  const back = useBack()
  if (!back) return null

  return <HeaderButton icon={CaretLeftIcon} label='Back' onClick={back} />
}
