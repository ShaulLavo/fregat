import { usageProviderLabel } from '@/lib/provider-usage'

export function usageSourceLabel(sourceKind: string, driverKind: string) {
  if (sourceKind === 'fregat-utility') return 'Fregat utility generations'
  if (sourceKind === 'fregat-session') return 'Fregat sessions'
  return `${usageProviderLabel(driverKind)} transcripts`
}
