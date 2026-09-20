type PlanStepStatus = 'completed' | 'inProgress' | 'pending'
export function planStepStatus(value: unknown): PlanStepStatus {
  if (value === 'completed') return 'completed'
  if (value === 'inProgress') return 'inProgress'

  return 'pending'
}
