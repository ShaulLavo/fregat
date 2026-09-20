import * as v from 'valibot'
import { approvalRequestIdSchema } from '@workspace/contracts'
import { Question } from '@/agent-stage/components/question'
import { CommandProvider } from '@/commands/providers/command-provider'
import { resolveTheme } from '@/theme/utils/theme'
import { expect, test } from '../../../../test/fixtures'
import { renderTui } from '../../../../test/render'

test.for(['message', 'native'] as const)(
  'only message questions advertise dismissal: %s',
  async (responseMode) => {
    const frame = await renderTui(
      <CommandProvider
        scope={{ screen: 'chat', environmentId: 'test', projectId: null }}
        handlers={{}}
        overrides={{}}
        onError={(error) => expect.unreachable(String(error))}
      >
        <Question
          request={{
            createdAt: '2026-09-20T00:00:00Z',
            requestId: v.parse(approvalRequestIdSchema, 'question-test'),
            turnId: null,
            responseMode,
            questions: [
              {
                id: '0',
                prompt: 'Which language?',
                answerKind: 'single-select',
                allowOther: true,
                secret: false,
                options: [{ label: 'Rust', value: 'Rust' }],
              },
            ],
          }}
          theme={resolveTheme('dark', 'dark', true)}
          enabled
          busy={false}
          onRespond={() => {}}
          onDismiss={() => {}}
        />
      </CommandProvider>,
      { width: 60, height: 14, useThread: false },
    )
    try {
      await frame.renderOnce()
      const text = frame.captureCharFrame()
      expect(text).toContain('Which language?')
      if (responseMode === 'message') expect(text).toContain('Ctrl+X dismiss question')
      if (responseMode === 'native') expect(text).not.toContain('dismiss question')
    } finally {
      await frame.cleanup()
    }
  },
)
