import { CheckIcon, QuestionIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import { Input } from '@workspace/ui/components/input'
import { Spinner } from '@workspace/ui/components/spinner'
import { Textarea } from '@workspace/ui/components/textarea'
import { useId, useState } from 'react'

import { PendingRequestFeedback } from '@/features/chat/components/pending-request-feedback'
import { usePendingRequests } from '@/features/chat/hooks/use-pending-requests'
import { selectedValues, selectHint } from '@/features/chat/utils/user-input-display'
import {
  buildUserInputAnswers,
  firstUnansweredUserInputIndex,
  isUserInputDraftComplete,
  setUserInputCustomAnswer,
  toggleUserInputOption,
  type PendingUserInput,
  type UserInputAnswerDrafts,
} from '@workspace/client-core/chat/pending-user-input'

export function PendingUserInputCard({ pending }: { readonly pending: PendingUserInput }) {
  const { disabledReason, responseState, respondToUserInput } = usePendingRequests()
  const [drafts, setDrafts] = useState<UserInputAnswerDrafts>({})
  const [stepIndex, setStepIndex] = useState(0)
  const fieldId = useId()
  const questions = pending.questions
  const response = responseState(pending.requestId)
  const responding = response.kind === 'submitting' || response.kind === 'accepted'
  const activeIndex = Math.min(stepIndex, questions.length - 1)
  const question = questions[activeIndex]
  if (!question) return null

  const draft = drafts[question.id]
  const picked = selectedValues(question, draft)
  const showOptions = question.answerKind !== 'text' && question.options.length > 0
  const showTextField = !showOptions || question.allowOther
  const canAdvance = isUserInputDraftComplete([question], drafts)

  function selectOption(optionValue: string) {
    const next = {
      ...drafts,
      [question.id]: toggleUserInputOption(question, drafts[question.id], optionValue),
    }

    setDrafts(next)
    // One pick answers a single-select outright, so jump to whatever is still
    // open. A multi-select is still being built — it waits for Next.
    if (question.answerKind === 'multi-select') return

    setStepIndex(firstUnansweredUserInputIndex(questions, next))
  }

  function changeCustomAnswer(customAnswer: string) {
    setDrafts({
      ...drafts,
      [question.id]: setUserInputCustomAnswer(drafts[question.id], customAnswer),
    })
  }

  function submit() {
    const answers = buildUserInputAnswers(questions, drafts)
    if (!answers) return

    void respondToUserInput(pending.requestId, answers)
  }

  return (
    <div
      aria-label='Agent question'
      className='compact:px-2 compact:pb-1.5 shrink-0 px-3 pb-2'
      role='region'
    >
      <div className='border-warning/30 bg-warning/10 compact:gap-1.5 compact:p-2 mx-auto flex max-w-3xl flex-col gap-2 border p-3'>
        <div className='compact:gap-1.5 flex flex-wrap items-center gap-2'>
          <QuestionIcon aria-hidden='true' className='text-warning size-4' />
          <span className='text-warning text-[11px] font-semibold tracking-widest uppercase'>
            {question.header ?? 'Input needed'}
          </span>
          {questions.length > 1 ? (
            <span className='text-muted-foreground text-[10px] tabular-nums'>
              {activeIndex + 1}/{questions.length}
            </span>
          ) : null}
        </div>
        <p aria-atomic='true' className='text-foreground text-xs' role='status'>
          {question.prompt}
        </p>
        {showOptions ? (
          <div
            aria-describedby={`${fieldId}-hint`}
            aria-label={question.prompt}
            className='flex flex-col gap-1'
            role='group'
          >
            <p className='text-muted-foreground text-[11px]' id={`${fieldId}-hint`}>
              {selectHint(question.answerKind)}
            </p>
            {question.options.map((option) => (
              <Button
                aria-pressed={picked.includes(option.value)}
                className='compact:px-2 compact:py-1 h-auto justify-start px-2.5 py-1.5 text-left'
                disabled={responding}
                key={option.value}
                onClick={() => selectOption(option.value)}
                size='sm'
                type='button'
                variant={picked.includes(option.value) ? 'secondary' : 'outline'}
              >
                <span className='flex min-w-0 flex-1 flex-col gap-0.5'>
                  <span className='font-medium whitespace-normal'>{option.label}</span>
                  {option.description ? (
                    <span className='text-muted-foreground text-[11px] font-normal whitespace-normal'>
                      {option.description}
                    </span>
                  ) : null}
                </span>
                {picked.includes(option.value) ? (
                  <CheckIcon aria-hidden='true' className='size-3.5' />
                ) : null}
              </Button>
            ))}
          </div>
        ) : null}
        {showTextField ? (
          <div className='flex flex-col gap-1'>
            <label className='text-muted-foreground text-[11px] font-medium' htmlFor={fieldId}>
              {showOptions ? 'Other' : 'Your answer'}
            </label>
            {question.secret ? (
              <Input
                autoComplete='off'
                disabled={responding}
                id={fieldId}
                onChange={(event) => changeCustomAnswer(event.target.value)}
                type='password'
                value={draft?.customAnswer ?? ''}
              />
            ) : (
              <Textarea
                disabled={responding}
                id={fieldId}
                onChange={(event) => changeCustomAnswer(event.target.value)}
                rows={2}
                value={draft?.customAnswer ?? ''}
              />
            )}
          </div>
        ) : null}
        {response.kind !== 'submitting' ? <PendingRequestFeedback response={response} /> : null}
        <div
          aria-busy={responding}
          className='compact:gap-1 flex flex-wrap items-center justify-end gap-1.5'
        >
          {activeIndex > 0 ? (
            <Button
              disabled={responding}
              onClick={() => setStepIndex(activeIndex - 1)}
              size='sm'
              type='button'
              variant='ghost'
            >
              Back
            </Button>
          ) : null}
          {activeIndex < questions.length - 1 ? (
            <Button
              disabled={responding || !canAdvance}
              onClick={() => setStepIndex(activeIndex + 1)}
              size='sm'
              type='button'
              variant='outline'
            >
              Next
            </Button>
          ) : null}
          <Button
            disabled={
              responding || disabledReason !== null || !isUserInputDraftComplete(questions, drafts)
            }
            onClick={submit}
            size='sm'
            type='button'
          >
            {response.kind === 'submitting' ? (
              <Spinner aria-hidden='true' className='size-3.5' />
            ) : null}
            {response.kind === 'submitting' ? 'Submitting…' : 'Submit'}
          </Button>
        </div>
      </div>
    </div>
  )
}
