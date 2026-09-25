import type { ChatActivityPlanStep } from '@/features/chat/utils/activity-presentation'

export type ChatPlanStep = {
  /** `dropped`: an earlier snapshot listed it and a later one did not. */
  status: ChatActivityPlanStep['status'] | 'dropped'
  step: string
}

type KeyedStep = { key: string | null; step: ChatPlanStep }

/**
 * The next snapshot in order, with every step it no longer lists kept as dropped where it
 * stood. Steps match by text and occurrence, because an agent reorders and inserts.
 */
export function mergePlanSteps(
  previous: readonly ChatPlanStep[],
  next: readonly ChatActivityPlanStep[],
): ChatPlanStep[] {
  const merged: KeyedStep[] = keyedSteps(next)
  let anchor = -1

  for (const { key, step } of keyedSteps(previous)) {
    const index = key === null ? -1 : merged.findIndex((candidate) => candidate.key === key)
    if (index >= 0) {
      anchor = index
      continue
    }

    anchor += 1
    merged.splice(anchor, 0, { key: null, step: { ...step, status: 'dropped' } })
  }

  return merged.map(({ step }) => step)
}

/** Dropped steps never match again, so they carry no key. */
function keyedSteps(steps: readonly ChatPlanStep[]): KeyedStep[] {
  const seen = new Map<string, number>()

  return steps.map((step) => {
    if (step.status === 'dropped') return { key: null, step }

    const occurrence = seen.get(step.step) ?? 0
    seen.set(step.step, occurrence + 1)
    return { key: `${occurrence}\u001f${step.step}`, step }
  })
}

export function planStepLabel(status: ChatPlanStep['status']) {
  if (status === 'completed') return 'Completed'
  if (status === 'inProgress') return 'In progress'
  if (status === 'dropped') return 'Dropped'

  return 'Pending'
}

export function planTriggerLabel(plan: { currentStep: string | null }, complete: boolean) {
  if (plan.currentStep) return plan.currentStep

  return complete ? 'Plan complete' : 'Plan'
}

/** React keys by text and occurrence, so an inserted or dropped step moves nothing else. */
export function planStepKeys(steps: readonly ChatPlanStep[]) {
  const seen = new Map<string, number>()

  return steps.map((step) => {
    const occurrence = seen.get(step.step) ?? 0
    seen.set(step.step, occurrence + 1)
    return `${occurrence}:${step.step}`
  })
}
