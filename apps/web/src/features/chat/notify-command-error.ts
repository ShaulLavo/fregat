import { createMutationErrorNotifier } from '@/lib/mutations/notify-error'

export function notifyChatCommandError(error: unknown, title: string) {
  createMutationErrorNotifier({ area: 'chat', title })(error)
}
