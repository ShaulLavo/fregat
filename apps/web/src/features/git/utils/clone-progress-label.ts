import type { CloneProgress } from '@/features/git/utils/api'

const STAGE_LABELS: Record<CloneProgress['stage'], string> = {
  connecting: 'Connecting',
  counting: 'Counting objects',
  receiving: 'Receiving objects',
  resolving: 'Resolving deltas',
  checkout: 'Checking out files',
}

export function cloneProgressLabel(progress: CloneProgress | null) {
  if (!progress) return 'Connecting'
  const stage = STAGE_LABELS[progress.stage]
  return progress.percent === null ? stage : `${stage} · ${progress.percent}%`
}
