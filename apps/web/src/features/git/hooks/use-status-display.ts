import { useStatus } from '@/features/git/hooks/use-status'

export function useStatusDisplay(root: string) {
  return useStatus(root)
}
