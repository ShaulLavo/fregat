import { useState, type ReactNode } from 'react'
import { Button } from '@workspace/ui/components/button'

export function RootValidationMount({ children }: { readonly children: ReactNode }) {
  const [mounted, setMounted] = useState(false)
  return (
    <>
      <Button onClick={() => setMounted(true)}>Mount validation</Button>
      {mounted ? children : null}
    </>
  )
}
