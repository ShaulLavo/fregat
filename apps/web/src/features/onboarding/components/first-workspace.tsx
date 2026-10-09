import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { useConnectedMachines } from '@/hooks/use-connected-machines'
import { usePrimaryMachineLabel } from '@/hooks/use-primary-machine-label'
import { clientErrorDescription, toClientError } from '@/lib/client-error-taxonomy'
import type { ConfirmedMachine } from '@/lib/environments/utils/machines'
import { basename } from '@/lib/path-formatters'
import { recentFoldersQueryOptions } from '@/lib/recent-folders-query'
import { ChooseDialog } from '@/features/onboarding/components/choose-dialog'
import { EmptyChat } from '@/features/onboarding/components/empty-chat'
import { LocalFolder } from '@/features/onboarding/components/local-folder'
import { MachineFolder } from '@/features/onboarding/components/machine-folder'
import { ProgressDialog } from '@/features/onboarding/components/progress-dialog'
import { RemoteDialog } from '@/features/onboarding/components/remote-dialog'
import { useOpenProject } from '@/features/onboarding/hooks/use-open-project'
import { CHOOSE, CLOSED, LOCAL, REMOTE, leaving, type Step } from '@/features/onboarding/utils/step'

/**
 * No folder open: the empty chat, and the choice of where its project lives. A fresh install
 * (no recent folders) opens the choice on arrival; later the same two actions wait in the chat.
 */
export function FirstWorkspace() {
  const label = usePrimaryMachineLabel()
  const primary = useConnectedMachines().find((machine) => machine.kind === 'primary')
  const recents = useQuery(recentFoldersQueryOptions({ enabled: true }))
  const [chosen, setStep] = useState<Step | null>(null)
  const open = useOpenProject()
  const step = chosen ?? (recents.data?.length === 0 ? CHOOSE : CLOSED)
  const pick = (machine: ConfirmedMachine, path: string) => {
    setStep(CLOSED)
    open.mutate({ machine, path }, { onError: () => setStep(CHOOSE) })
  }
  const error = open.error ? clientErrorDescription(toClientError(open.error)) : null
  const request = open.variables
  const retry = request ? () => open.mutate(request) : undefined

  return (
    <>
      <EmptyChat
        machine={label}
        onChooseLocal={() => setStep(primary ? LOCAL : CHOOSE)}
        onChooseRemote={() => setStep(REMOTE)}
      />
      {open.isPending && request ? (
        <ProgressDialog
          detail={`The chat opens once ${request.machine.label ?? request.machine.name} has the project ready.`}
          title={`Opening ${basename(request.path)}`}
        />
      ) : null}
      <ChooseDialog
        error={error}
        machine={label}
        open={step.kind === 'choose' && !open.isPending}
        onLocal={() => setStep(LOCAL)}
        onOpenChange={(next) => setStep(next ? CHOOSE : CLOSED)}
        onRemote={() => setStep(REMOTE)}
        onRetry={retry}
      />
      {step.kind === 'local' && primary ? (
        <LocalFolder
          machine={primary}
          onCancel={() => setStep(leaving('local', CHOOSE))}
          onPick={pick}
        />
      ) : null}
      {step.kind === 'remote' ? (
        <RemoteDialog
          onBack={() => setStep(CHOOSE)}
          onMachine={(name) => setStep({ kind: 'machine', name })}
        />
      ) : null}
      {step.kind === 'machine' ? (
        <MachineFolder
          name={step.name}
          onBack={() => setStep(leaving('machine', REMOTE))}
          onPick={pick}
        />
      ) : null}
    </>
  )
}
