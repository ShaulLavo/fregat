import { createMutationErrorNotifier } from '@/lib/mutations/notify-error'

export const notifyMutationError = createMutationErrorNotifier({
  area: 'editor',
  title: 'Save failed',
})
