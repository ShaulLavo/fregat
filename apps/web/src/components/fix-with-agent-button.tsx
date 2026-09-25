import { SparkleIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'

import type { AgentErrorInput } from '@/lib/agent-error-report'
import { canOpenAgentChat, fixWithAgent } from '@/lib/fix-with-agent'

export function FixWithAgentButton({
  className,
  error,
  onHandOff,
}: {
  readonly className?: string
  readonly error: AgentErrorInput
  /** A modal passes its close: its focus trap would hold the new chat's composer. */
  readonly onHandOff?: () => void
}) {
  function fix() {
    if (canOpenAgentChat()) onHandOff?.()
    void fixWithAgent(error)
  }

  return (
    <Button className={className} onClick={fix} size='xs' variant='ghost'>
      <SparkleIcon data-icon='inline-start' />
      Fix with AI
    </Button>
  )
}
