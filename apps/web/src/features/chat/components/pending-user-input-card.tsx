import { questionDraftsWithAttachments } from '@/features/chat/utils/question-attachments'
import { useQuestionDigits } from '@/features/chat/hooks/use-question-digits'
import { useQuestionAttachments } from '@/features/chat/hooks/use-question-attachments'
import { ChatInputAttachButton } from '@/features/chat/components/chat-input-attach-button'
import { ChatInputAttachmentList } from '@/features/chat/components/chat-input-attachment-list'
import { RingLoader } from '@workspace/ui/components/ring-loader'
import { CheckIcon, QuestionIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import { Input } from '@workspace/ui/components/input'
import { Spinner } from '@workspace/ui/components/spinner'
import { Textarea } from '@workspace/ui/components/textarea'
import { useId, useState, useRef } from 'react'

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
  const { sessionId, disabledReason, responseState, respondToUserInput, dismissUserInput } =
    usePendingRequests()
  const attachments = useQuestionAttachments(
    sessionId,
    pending.requestId,
    pending.questions.map((question) => question.id),
  )
  const submitting = useRef(false)
  const [drafts, setDrafts] = useState<UserInputAnswerDrafts>({})
  const [stepIndex, setStepIndex] = useState(0)
  const fieldId = useId()
  const questions = pending.questions
  const response = responseState(pending.requestId)
  const responding = response.kind === 'submitting' || response.kind === 'accepted'
  const activeIndex = Math.min(stepIndex, questions.length - 1)
  const question = questions[activeIndex]
  useQuestionDigits(
    question,
    !responding && disabledReason === null && question?.answerKind !== 'text',
    selectOption,
  )
  if (!question) return null

  const answeredDrafts = questionDraftsWithAttachments(
    questions,
    drafts,
    attachments.byQuestion,
    attachments.blocked,
  )
  const draft = drafts[question.id]
  const picked = selectedValues(question, draft)
  const showOptions = question.answerKind !== 'text' && question.options.length > 0
  const showTextField = !showOptions || question.allowOther
  const canAdvance = isUserInputDraftComplete([question], answeredDrafts)

  function selectOption(optionValue: string) {
    const next = {
      ...drafts,
      [question.id]: toggleUserInputOption(question, drafts[question.id], optionValue),
    }

    setDrafts(next)
    // One pick answers a single-select outright, so jump to whatever is still
    // open. A multi-select is still being built — it waits for Next.
    if (question.answerKind === 'multi-select') return

    setStepIndex(
      firstUnansweredUserInputIndex(
        questions,
        questionDraftsWithAttachments(questions, next, attachments.byQuestion, attachments.blocked),
      ),
    )
  }

  function changeCustomAnswer(customAnswer: string) {
    setDrafts({
      ...drafts,
      [question.id]: setUserInputCustomAnswer(drafts[question.id], customAnswer),
    })
  }

  async function submit() {
    if (submitting.current || attachments.isBlocked() || responding) return
    const answers = buildUserInputAnswers(questions, answeredDrafts)
    if (!answers) return
    submitting.current = true
    try {
      const accepted = await respondToUserInput(pending.requestId, answers, attachments.uploads())
      if (accepted) attachments.clearSent()
      submitting.current = false
    } catch (error) {
      // Not `finally`: the compiler refuses the whole component over one.
      submitting.current = false
      throw error
    }
  }

  return (
    <div
      aria-label='Agent question'
      className='shrink-0 px-(--density-control-padding-x) pb-(--density-section-gap)'
      role='region'
    >
      <div className='bg-warning/10 mx-auto flex max-w-3xl flex-col gap-(--density-control-gap) rounded-lg p-(--density-section-padding)'>
        <div className='flex flex-wrap items-center gap-(--density-control-gap)'>
          <QuestionIcon aria-hidden='true' className='text-warning size-(--icon-size)' />
          <span className='text-warning text-2xs font-semibold tracking-widest uppercase'>
            {question.header ?? 'Input needed'}
          </span>
          {questions.length > 1 ? (
            <span className='text-muted-foreground text-3xs tabular-nums'>
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
            <p className='text-muted-foreground text-2xs' id={`${fieldId}-hint`}>
              {selectHint(question.answerKind)}
            </p>
            {question.options.map((option, optionIndex) => (
              <Button
                aria-pressed={picked.includes(option.value)}
                className='h-auto justify-start px-(--density-control-padding-x) py-1.5 text-left'
                disabled={responding}
                key={option.value}
                onClick={() => selectOption(option.value)}
                size='sm'
                type='button'
                variant={picked.includes(option.value) ? 'secondary' : 'outline'}
              >
                <span className='flex min-w-0 flex-1 flex-col gap-0.5'>
                  <span className='font-medium whitespace-normal'>
                    <span aria-hidden='true'>{optionIndex < 9 ? `${optionIndex + 1} ` : ''}</span>
                    {option.label}
                  </span>
                  {option.description ? (
                    <span className='text-muted-foreground text-2xs font-normal whitespace-normal'>
                      {option.description}
                    </span>
                  ) : null}
                </span>
                {picked.includes(option.value) ? (
                  <CheckIcon aria-hidden='true' className='size-(--icon-size-sm)' />
                ) : null}
              </Button>
            ))}
          </div>
        ) : null}
        {showTextField ? (
          <div className='flex flex-col gap-1'>
            <label className='text-muted-foreground text-2xs font-medium' htmlFor={fieldId}>
              {showOptions ? 'Other' : 'Your answer'}
            </label>
            {question.secret ? (
              <Input
                autoCapitalize='off'
                autoComplete='off'
                autoCorrect='off'
                disabled={responding}
                id={fieldId}
                onChange={(event) => changeCustomAnswer(event.target.value)}
                spellCheck={false}
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
        {showTextField ? (
          <>
            <ChatInputAttachmentList
              attachments={attachments.byQuestion[question.id] ?? []}
              disabled={responding}
              onRemove={(id) => attachments.remove(question.id, id)}
              onRetry={(id) => attachments.retry(question.id, id)}
            />
            <ChatInputAttachButton
              disabled={responding || attachments.preparing}
              onSelectFiles={(files) => attachments.prepare(question.id, files)}
            />
            {attachments.preparing ? (
              <RingLoader aria-label='Preparing question attachments' />
            ) : null}
            {attachments.errors[question.id] ? (
              <div role='alert'>
                <span>{attachments.errors[question.id]}</span>
                <Button
                  size='sm'
                  variant='ghost'
                  onClick={() => attachments.clearError(question.id)}
                >
                  Dismiss attachment error
                </Button>
              </div>
            ) : null}
          </>
        ) : null}
        {response.kind !== 'submitting' ? <PendingRequestFeedback response={response} /> : null}
        <div
          aria-busy={responding}
          className='flex flex-wrap items-center justify-end gap-(--density-control-gap)'
        >
          {pending.responseMode === 'message' ? (
            <Button
              disabled={responding || disabledReason !== null}
              onClick={() => void dismissUserInput(pending.requestId)}
              size='sm'
              type='button'
              variant='ghost'
            >
              Dismiss
            </Button>
          ) : null}
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
              responding ||
              disabledReason !== null ||
              !isUserInputDraftComplete(questions, answeredDrafts)
            }
            onClick={() => void submit()}
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
