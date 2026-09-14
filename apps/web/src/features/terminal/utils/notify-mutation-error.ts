import { createMutationErrorNotifier } from '@/lib/mutations/notify-error'

export const notifyMutationError = createMutationErrorNotifier({
  area: 'terminal',
  title: 'Terminal command failed',
})
