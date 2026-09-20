import { useRef, useState } from 'react'
import { useKeyboard } from '@opentui/react'
import {
  buildUserInputAnswers,
  resolveUserInputAnswer,
  setUserInputCustomAnswer,
  toggleUserInputOption,
  type PendingUserInput,
  type UserInputAnswerDrafts,
  type UserInputAnswers,
} from '@workspace/client-core/chat/pending-user-input'
import { usePaneFocus } from '@/commands/hooks/use-pane-focus'
import { useCommands } from '@/commands/hooks/use-commands'
import { Select } from '@/components/select'
import { Prompt } from '@/components/prompt'
import { OrbitLoader } from '@/components/orbit-loader'
import { SecretPrompt } from '@/agent-stage/components/secret-prompt'
import type { Theme } from '@/theme/utils/theme'

export function Question({
  request,
  theme,
  enabled,
  busy,
  onRespond,
  onDismiss,
}: {
  readonly request: PendingUserInput
  readonly theme: Theme
  readonly enabled: boolean
  readonly busy: boolean
  readonly onDismiss?: () => void
  readonly onRespond: (answers: UserInputAnswers) => void
}) {
  const [drafts, setDrafts] = useState<UserInputAnswerDrafts>({})
  const draftRef = useRef<UserInputAnswerDrafts>({})
  function updateDrafts(update: (current: UserInputAnswerDrafts) => UserInputAnswerDrafts) {
    draftRef.current = update(draftRef.current)
    setDrafts(draftRef.current)
  }
  const [index, setIndex] = useState(0)
  const [other, setOther] = useState(false)
  const commands = useCommands()
  const question = request.questions[index]
  const focused = usePaneFocus({
    id: 'agent-question',
    area: 'chat',
    textEntry: question?.answerKind === 'text' || other,
    enabled: enabled && !busy,
  })
  function next() {
    if (!question || !resolveUserInputAnswer(question, draftRef.current[question.id])) return
    if (index + 1 < request.questions.length) {
      setIndex(index + 1)
      setOther(false)
      return
    }
    const answers = buildUserInputAnswers(request.questions, draftRef.current)
    if (answers) onRespond(answers)
  }
  function choose(optionIndex: number) {
    if (!question) return
    const option = question.options[optionIndex]
    if (!option) {
      if (question.allowOther && optionIndex === question.options.length) setOther(true)
      return
    }
    updateDrafts((current) => ({
      ...current,
      [question.id]: toggleUserInputOption(question, current[question.id], option.value),
    }))
  }
  useKeyboard((event) => {
    if (!focused || event.defaultPrevented) return
    if (event.ctrl && event.name === 'x' && request.responseMode === 'message' && onDismiss) {
      event.preventDefault()
      onDismiss()
      return
    }
    if (event.ctrl && event.name === 'd') {
      event.preventDefault()
      next()
      return
    }
    if (question?.answerKind === 'text' || other || event.ctrl || event.meta) return
    if (!/^[1-9]$/.test(event.name)) return
    event.preventDefault()
    choose(Number(event.name) - 1)
  })
  if (!question) return null
  const draft = drafts[question.id]
  const textEntry = question.answerKind === 'text' || other
  const onChange = (text: string) =>
    updateDrafts((current) => ({
      ...current,
      [question.id]: setUserInputCustomAnswer(current[question.id], text),
    }))
  const options = question.options.map((option, optionIndex) => ({
    name: `${draft?.selectedValues?.includes(option.value) ? '[x]' : '[ ]'} ${optionIndex + 1} ${option.label}`,
    description: option.description ?? '',
    value: option.value,
  }))
  if (question.allowOther) options.push({ name: 'Other answer…', description: '', value: '' })
  return (
    <box flexDirection='column' border borderColor={theme.info} paddingX={1} flexShrink={0}>
      <text fg={theme.info}>
        <strong>{`Question ${index + 1}/${request.questions.length}${question.header ? ` · ${question.header}` : ''}`}</strong>
      </text>
      <text fg={theme.foreground}>{question.prompt}</text>
      {busy && (
        <box>
          <OrbitLoader theme={theme} />
          <text> Sending answers…</text>
        </box>
      )}
      {!busy && textEntry && !question.secret && (
        <Prompt
          key={question.id}
          id='agent-question'
          value={draft?.customAnswer ?? ''}
          onChange={onChange}
          onSubmit={next}
          theme={theme}
          focused={focused}
          placeholder='Type your answer'
        />
      )}
      {!busy && textEntry && question.secret && (
        <SecretPrompt
          key={question.id}
          id='agent-question'
          value={draft?.customAnswer ?? ''}
          onChange={onChange}
          onSubmit={next}
          theme={theme}
          focused={focused}
        />
      )}
      {!busy && !textEntry && (
        <Select
          key={question.id}
          id='agent-question'
          options={options}
          focused={focused}
          height={Math.min(options.length * 2, 8)}
          showDescription
          textColor={theme.foreground}
          selectedTextColor={theme.primaryForeground}
          selectedBackgroundColor={theme.primary}
          onSelect={choose}
        />
      )}
      {request.responseMode === 'message' && onDismiss && !busy && (
        <text
          fg={theme.mutedForeground}
          onMouseDown={() => {
            if (enabled) onDismiss()
          }}
        >
          Ctrl+X dismiss question
        </text>
      )}
      <text
        fg={theme.mutedForeground}
        onMouseDown={() => {
          next()
          commands.focus.request({
            kind: 'match',
            matches: (target) => target.widgetId === 'agent-question',
          })
        }}
      >
        {textEntry
          ? 'Enter to continue · answers stay private'
          : 'Digits or Enter select · Ctrl+D continue'}
      </text>
    </box>
  )
}
