import { useHotkeys } from '@tanstack/react-hotkeys'
import type { UserInputQuestion } from '@workspace/contracts'

export function useQuestionDigits(
  question: UserInputQuestion | undefined,
  enabled: boolean,
  select: (value: string) => void,
) {
  useHotkeys(
    (question?.options ?? []).slice(0, 9).map((option, index) => ({
      hotkey: { key: String(index + 1) },
      callback: () => select(option.value),
      options: { enabled, ignoreInputs: true, stopPropagation: false },
    })),
  )
}
