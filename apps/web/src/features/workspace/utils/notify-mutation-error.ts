import { createMutationErrorNotifier } from '@/lib/mutations/notify-error'

export const notifyMutationError = createMutationErrorNotifier({
  area: 'workspace',
  title: 'Workspace action failed',
})
