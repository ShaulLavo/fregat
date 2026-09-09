import { screen, waitFor } from '@testing-library/react'
import {
  DEFAULT_PROVIDER_INSTANCE_ID,
  providerDriverKindSchema,
  providerInstanceIdSchema,
} from '@workspace/contracts'
import { Popover } from '@workspace/ui/components/popover'
import { afterEach, beforeEach } from 'vitest'
import * as v from 'valibot'

import { ModelPickerTrigger } from '@/features/chat/components/model-picker-trigger'
import { ChatModelPickerProvider } from '@/features/chat/providers/model-picker-provider'
import { resetChatInputDraftStore } from '@/features/chat/state/chat-input-draft-store'
import {
  readProviderDisplayCache,
  writeProviderDisplayCache,
} from '@/features/chat/state/provider-display-cache'
import { providerListQueryOptions } from '@/features/chat/utils/provider-query'
import { getClient, setClient } from '@/lib/client'
import { environmentScopedStorage } from '@/lib/environments/state/scoped-storage'
import { createObservedInProcessClient } from '../../../../../test/client'
import {
  fixtureEnvironmentId,
  providerModel,
  providerSnapshot,
  TEST_ENVIRONMENT_ID,
} from '../../../../../test/factories/chat'
import { expect, test } from '../../../../../test/fixtures'
import { createTestQueryClient, renderWithProviders } from '../../../../../test/render'

const removedProviderId = v.parse(providerInstanceIdSchema, 'removed-provider')
let previousClient = getClient()

beforeEach(() => {
  previousClient = getClient()
  localStorage.clear()
  resetChatInputDraftStore()
})

afterEach(() => {
  setClient(previousClient)
  localStorage.clear()
})

test.for([
  {
    name: 'Codex',
    driverKind: 'codex',
    environmentId: TEST_ENVIRONMENT_ID,
    firstGlyphClass: 'fill-brand-openai',
    firstModelLabel: 'Cached model label',
    liveGlyphClass: 'fill-brand-openai',
    liveModelLabel: 'GPT-5.5',
    providerInstanceId: DEFAULT_PROVIDER_INSTANCE_ID,
  },
  {
    name: 'Claude',
    driverKind: 'claude',
    environmentId: TEST_ENVIRONMENT_ID,
    firstGlyphClass: 'fill-brand-anthropic',
    firstModelLabel: 'Cached model label',
    liveGlyphClass: 'fill-brand-openai',
    liveModelLabel: 'GPT-5.5',
    providerInstanceId: DEFAULT_PROVIDER_INSTANCE_ID,
  },
  {
    name: 'a removed provider',
    driverKind: 'claude',
    environmentId: TEST_ENVIRONMENT_ID,
    firstGlyphClass: 'fill-brand-anthropic',
    firstModelLabel: 'Cached model label',
    liveGlyphClass: null,
    liveModelLabel: 'gpt-5.5',
    providerInstanceId: removedProviderId,
  },
  {
    name: 'another environment',
    driverKind: 'claude',
    environmentId: fixtureEnvironmentId(2),
    firstGlyphClass: null,
    firstModelLabel: 'gpt-5.5',
    liveGlyphClass: 'fill-brand-openai',
    liveModelLabel: 'GPT-5.5',
    providerInstanceId: DEFAULT_PROVIDER_INSTANCE_ID,
  },
])(
  '$name displays only its own cached identity while the provider read is pending',
  async (
    {
      driverKind,
      environmentId,
      firstGlyphClass,
      firstModelLabel,
      liveGlyphClass,
      liveModelLabel,
      providerInstanceId,
    },
    { server },
  ) => {
    const storage = environmentScopedStorage(environmentId)
    writeProviderDisplayCache(storage, [
      providerSnapshot({
        auth: { status: 'unauthenticated' },
        displayLabel: 'Cached provider',
        driverKind: v.parse(providerDriverKindSchema, driverKind),
        models: [providerModel({ shortName: 'Cached model label' })],
        providerInstanceId,
      }),
    ])
    const release = Promise.withResolvers<void>()
    const client = createObservedInProcessClient(server, (request) => {
      if (new URL(request.url).pathname === '/providers') return release.promise
    })
    setClient(client)
    const queryClient = createTestQueryClient()
    const queryKey = providerListQueryOptions().queryKey
    const view = renderWithProviders(
      <ChatModelPickerProvider
        draftTarget={{
          draftKey: 'provider-display-test',
          environmentId: TEST_ENVIRONMENT_ID,
          rootPath: server.root,
        }}
        modelSelection={{ model: 'gpt-5.5', providerInstanceId }}
        persistModelSelection={() => {}}
        sessionProviderInstanceId={providerInstanceId}
      >
        <Popover>
          <ModelPickerTrigger busy={false} disabled={false} />
        </Popover>
      </ChatModelPickerProvider>,
      { queryClient },
    )

    try {
      const trigger = screen.getByRole('button', { name: 'Provider and model' })
      const firstGlyph = trigger.querySelector('svg[class*="fill-brand-"]')
      if (firstGlyphClass) expect(firstGlyph).toHaveClass(firstGlyphClass)
      if (!firstGlyphClass) expect(firstGlyph).toBeNull()
      expect(trigger).toHaveTextContent(firstModelLabel)
      expect(trigger.querySelector('[aria-label="Cached provider ready"]')).toBeNull()
      expect(trigger.querySelector('[aria-label="Cached provider sign-in required"]')).toBeNull()
      expect(trigger.querySelector('.bg-success, .bg-destructive')).toBeNull()
      expect(queryClient.getQueryState(queryKey)?.status).toBe('pending')
      expect(queryClient.getQueryData(queryKey)).toBeUndefined()

      release.resolve()

      await waitFor(() => {
        expect(queryClient.getQueryState(queryKey)?.status).toBe('success')
        const liveGlyph = trigger.querySelector('svg[class*="fill-brand-"]')
        if (liveGlyphClass) expect(liveGlyph).toHaveClass(liveGlyphClass)
        if (!liveGlyphClass) expect(liveGlyph).toBeNull()
        expect(trigger).toHaveTextContent(liveModelLabel)
      })
      const liveDisplay = readProviderDisplayCache(environmentScopedStorage(TEST_ENVIRONMENT_ID))
      expect(liveDisplay).toHaveLength(1)
      expect(liveDisplay[0]?.providerInstanceId).toBe(DEFAULT_PROVIDER_INSTANCE_ID)
      expect(liveDisplay[0]).not.toHaveProperty('auth')
      expect(liveDisplay[0]).not.toHaveProperty('status')
      expect(liveDisplay[0]?.models[0]).not.toHaveProperty('isCustom')
    } finally {
      release.resolve()
      view.unmount()
      await queryClient.cancelQueries()
      queryClient.clear()
    }
  },
)
