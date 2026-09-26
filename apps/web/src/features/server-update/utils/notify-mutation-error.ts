import { createMutationErrorNotifier } from '@/lib/mutations/notify-error'

export const notifyMutationError = createMutationErrorNotifier({
  area: 'server-update',
  title: 'Restart failed',
})
