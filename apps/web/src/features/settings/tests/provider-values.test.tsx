import { screen } from '@testing-library/react'
import { REDACTED_SETTINGS_VALUE, type ProviderInstanceConfig } from '@workspace/contracts'

import { ProviderValues } from '@/features/settings/components/provider-values'
import { expect, test } from '../../../../test/fixtures'
import { renderWithProviders } from '../../../../test/render'

const instance = {
  providerInstanceId: 'codex-work',
  driverKind: 'codex',
  displayLabel: 'Codex (work)',
  enabled: true,
  binaryPath: '/usr/local/bin/codex',
  environment: [
    { name: 'OPENAI_API_KEY', value: REDACTED_SETTINGS_VALUE },
    { name: 'OPENAI_ORG', value: '' },
  ],
  config: {},
} as ProviderInstanceConfig

test('a secret shows only whether it is set, and never offers its value to copy', () => {
  renderWithProviders(<ProviderValues agentView={false} instance={instance} />)

  expect(screen.getByText('Set')).toBeInTheDocument()
  expect(screen.getByText('Not set')).toBeInTheDocument()
  expect(screen.queryByText(REDACTED_SETTINGS_VALUE)).toBeNull()
  expect(screen.getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual([
    'Copy binary path',
  ])
})

test('the agent view names each variable and copies the reference', () => {
  renderWithProviders(<ProviderValues agentView instance={instance} />)

  expect(screen.getByText('$OPENAI_API_KEY')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Copy $OPENAI_API_KEY' })).toBeInTheDocument()
})
