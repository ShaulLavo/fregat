import { createMutationErrorNotifier } from '@/lib/mutations/notify-error'

export const notifyHistoryError = createMutationErrorNotifier({
  area: 'editor',
  title: 'History command failed',
})
