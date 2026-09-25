import { act, waitFor } from '@testing-library/react'
import { DEFAULT_SETTING_VALUES, type SettingsSnapshot } from '@workspace/contracts'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { useLanguageServerMatches } from '@/features/editor/hooks/use-language-server-matches'
import { useLanguageServerMatchConfiguration } from '@/features/editor/providers/language-server-match-context'
import { languageServerMatchQueryOptions } from '@/features/editor/utils/language-server-match-query'
import { settingsKeys } from '@workspace/client-core/settings/query-keys'
import { expect, test } from '../../../../../test/fixtures'
import { createTestQueryClient, renderHookWithProviders } from '../../../../../test/render'

test('returns every match for a path through the real match route', async ({ client, server }) => {
  void client
  await writeWorkspace(server.root, {
    '.oxlintrc.json': '{}',
    'biome.json': '{}',
    'eslint.config.js': 'export default []\n',
    'package.json': '{}',
    'src/file.ts': 'export const value = 1\n',
  })
  const { result } = renderHookWithProviders(() => useLanguageServerMatches('', 'src/file.ts'))

  await waitFor(() => expect(result.current).not.toBeNull())
  expect(result.current?.map((match) => match.serverId)).toEqual([
    'typescript',
    'eslint',
    'oxlint',
    'biome',
  ])
})

test('does not expose a previous path result after the target changes', async ({
  client,
  server,
}) => {
  void client
  await writeWorkspace(server.root, {
    'package.json': '{}',
    'src/file.ts': 'export const value = 1\n',
    'src/readme.md': '# Notes\n',
  })
  const { result, rerender } = renderHookWithProviders(
    ({ matchPath }) => useLanguageServerMatches('', matchPath),
    { initialProps: { matchPath: 'src/file.ts' } },
  )

  rerender({ matchPath: 'src/readme.md' })
  expect(result.current).toBeNull()
  await waitFor(() => expect(result.current).toEqual([]))
})

test('keeps the disabled result referentially stable', () => {
  const { result, rerender } = renderHookWithProviders(() =>
    useLanguageServerMatches('', 'src/file.ts', false),
  )
  const first = result.current

  rerender()

  expect(result.current).toBe(first)
})

test('invalidates cached matches when matching configuration changes', () => {
  const initialConfiguration = {
    'lsp.experimental.tyForPython': DEFAULT_SETTING_VALUES['lsp.experimental.tyForPython'],
    'lsp.languageServers': DEFAULT_SETTING_VALUES['lsp.languageServers'],
    'lsp.servers': DEFAULT_SETTING_VALUES['lsp.servers'],
  }
  const initial = languageServerMatchQueryOptions('', 'src/file.py', {
    configuration: initialConfiguration,
    generation: 1,
  })
  const changed = languageServerMatchQueryOptions('', 'src/file.py', {
    configuration: {
      ...initialConfiguration,
      'lsp.experimental.tyForPython': true,
    },
    generation: 2,
  })

  expect(initial.queryKey).not.toEqual(changed.queryKey)
})

test('advances configuration generation and synchronously removes prior matches', async ({
  client,
}) => {
  void client
  const rendered = renderHookWithProviders(() => useLanguageServerMatchConfiguration())
  await waitFor(() =>
    expect(rendered.queryClient.getQueryData(settingsKeys.document())).toBeDefined(),
  )
  const first = rendered.result.current
  const firstOptions = languageServerMatchQueryOptions('', 'src/file.py', first)
  rendered.queryClient.setQueryData(firstOptions.queryKey, [])
  const settings = rendered.queryClient.getQueryData<SettingsSnapshot>(settingsKeys.document())
  if (!settings) throw new TypeError('missing settings snapshot')

  await act(async () => {
    rendered.queryClient.setQueryData<SettingsSnapshot>(settingsKeys.document(), {
      ...settings,
      values: {
        ...settings.values,
        'lsp.experimental.tyForPython': !settings.values['lsp.experimental.tyForPython'],
      },
    })
  })

  await waitFor(() => expect(rendered.result.current.generation).toBeGreaterThan(first.generation))
  expect(rendered.queryClient.getQueryState(firstOptions.queryKey)).toBeUndefined()
})

test('keeps an HTTP match failure in the query error state instead of caching an empty success', async ({
  client,
}) => {
  void client
  const queryClient = createTestQueryClient()
  const options = languageServerMatchQueryOptions('', 'x'.repeat(4097), {
    configuration: {
      'lsp.experimental.tyForPython': DEFAULT_SETTING_VALUES['lsp.experimental.tyForPython'],
      'lsp.languageServers': DEFAULT_SETTING_VALUES['lsp.languageServers'],
      'lsp.servers': DEFAULT_SETTING_VALUES['lsp.servers'],
    },
    generation: 1,
  })

  await expect(queryClient.query(options)).rejects.toBeDefined()
  expect(queryClient.getQueryState(options.queryKey)).toMatchObject({
    data: undefined,
    status: 'error',
  })
})

async function writeWorkspace(root: string, files: Readonly<Record<string, string>>) {
  for (const [relativePath, content] of Object.entries(files)) {
    const target = path.join(root, relativePath)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, content)
  }
}
