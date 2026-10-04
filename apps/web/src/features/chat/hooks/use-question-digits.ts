import { useKeymapNode } from '@/keymap/hooks/use-keymap-node'
import type { UserInputQuestion } from '@workspace/contracts'

export function useQuestionDigits(
  question: UserInputQuestion | undefined,
  enabled: boolean,
  select: (value: string) => void,
) {
  return useKeymapNode({
    area: 'chat',
    context: { identifiers: enabled ? ['Question'] : [] },
    commands: Object.fromEntries(
      Array.from({ length: 9 }, (_, index): readonly [string, () => boolean] => [
        `question.select${index + 1}`,
        () => {
          const option = question?.options[index]
          if (!enabled || !option) return false
          select(option.value)
          return true
        },
      ]),
    ),
  })
}
