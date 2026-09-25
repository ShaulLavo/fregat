import * as v from 'valibot'
import { approvalRequestIdSchema, type ProviderApprovalOption } from '@workspace/contracts'
import { Approval } from '@/agent-stage/components/approval'
import { CommandProvider } from '@/commands/providers/command-provider'
import { resolveTheme } from '@/theme/utils/theme'
import { expect, test } from '../../../../test/fixtures'
import { renderTui } from '../../../../test/render'

test.for([false, true])(
  'MCP options fit the terminal approval list, persistence=%s',
  async (persistent) => {
    const options: ProviderApprovalOption[] = [
      { decision: 'cancel', label: 'Cancel' },
      { decision: 'decline', label: 'Decline' },
      { decision: 'accept', label: 'Allow once' },
    ]
    if (persistent)
      options.push(
        { decision: 'acceptForSession', label: 'Allow this session' },
        { decision: 'acceptAlways', label: 'Always allow Safari' },
      )
    const frame = await renderTui(
      <CommandProvider
        scope={{ screen: 'chat', environmentId: 'test', projectId: null }}
        handlers={{}}
        overrides={{}}
        onError={(error) => expect.unreachable(String(error))}
      >
        <Approval
          request={{
            args: [],
            createdAt: '2026-09-20T00:00:00Z',
            detail: 'Safari',
            requestId: v.parse(approvalRequestIdSchema, 'mcp-test'),
            requestKind: 'app-access',
            requestType: 'mcp_elicitation_approval',
            turnId: null,
            options,
            defaultToNo: false,
            submittedDecision: null,
          }}
          theme={resolveTheme('dark', 'dark', true)}
          enabled
          busy={false}
          onRespond={() => {}}
        />
      </CommandProvider>,
      { width: 60, height: 14, useThread: false },
    )
    try {
      await frame.renderOnce()
      const text = frame.captureCharFrame()
      expect(text).toContain('3 Allow once')
      if (persistent) expect(text).toContain('5 Always allow Safari')
      if (!persistent) expect(text).not.toContain('Always allow Safari')
    } finally {
      await frame.cleanup()
    }
  },
)
