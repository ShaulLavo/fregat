import type { RouterHistory } from '@tanstack/react-router'
import type { ShellBackdrop } from '@/lib/platform/backdrop'

interface ApplicationHost {
  apiOrigin: string
  initialAddress: string
  history: RouterHistory
  backdrop: ShellBackdrop
}

let host: ApplicationHost | undefined

export function configureApplicationHost(value: ApplicationHost): void {
  host = value
}

export function applicationHost(): ApplicationHost | undefined {
  return host
}
