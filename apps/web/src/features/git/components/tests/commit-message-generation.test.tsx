import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ProviderModel } from '@workspace/contracts'
import { MockProviderAdapter } from 'server/testing'
import { afterEach } from 'vitest'

import { TestEditorStateProvider as EditorStateProvider } from '../../../../../test/factories/editor-state-provider'
import { CommitControls } from '@/features/git/components/commit-controls'
import { GitStoreProvider } from '@/features/git/providers/store-provider'
import { getClient, setClient, type Client } from '@/lib/client'
import { expect, test } from '../../../../../test/fixtures'
import { createInProcessClient } from '../../../../../test/client'
import { renderWithProviders } from '../../../../../test/render'
import { makeTestServer, type TestServer } from '../../../../../test/server'
import { runGit } from '../../../../../test/factories/git'

const GENERATED_MESSAGE = 'feat: add generated feature'

// The commit draft persists per repository, and every case here shares a root path.
afterEach(() => localStorage.clear())
const LUNA_MODELS: ProviderModel[] = [
  {
    capabilities: {
      optionDescriptors: [
        {
          id: 'reasoningEffort',
          label: 'Reasoning',
          type: 'select',
          options: [{ id: 'low', label: 'Low' }],
        },
      ],
    },
    isCustom: false,
    name: 'GPT-5.6 Luna',
    shortName: 'Luna',
    slug: 'gpt-5.6-luna',
  },
]
const CHEAP_FALLBACK_MODELS: ProviderModel[] = [
  {
    capabilities: {
      optionDescriptors: [
        {
          id: 'reasoningEffort',
          label: 'Reasoning',
          type: 'select',
          options: [{ id: 'low', label: 'Low' }],
        },
      ],
    },
    isCustom: false,
    name: 'GPT-5.5 Mini',
    shortName: 'Mini',
    slug: 'gpt-5.5-mini',
  },
]

test('generates from an untracked working diff, fills the input, and never commits', async () => {
  const adapter = lunaAdapter()

  await withProviderServer(adapter, async (server) => {
    const repo = await initRepo(server.root, 'repo')
    await writeFile(path.join(repo, 'feature.ts'), 'export const feature = true\n')
    const headBefore = runGit(repo, ['rev-parse', 'HEAD'], { cwdMode: 'option' }).stdout.trim()

    renderControls('repo', true)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Generate commit message' })).not.toHaveAttribute(
        'aria-disabled',
        'true',
      ),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Generate commit message' }))

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Commit message' })).toHaveValue(GENERATED_MESSAGE)
    })
    expect(adapter.startedTurns).toHaveLength(1)
    expect(adapter.startedTurns[0]?.messageText).toContain('feature.ts')
    expect(adapter.startedTurns[0]?.messageText).toContain('export const feature = true')
    expect(adapter.startedTurns[0]?.modelSelection).toEqual({
      model: 'gpt-5.6-luna',
      options: { reasoningEffort: 'low' },
      providerInstanceId: 'codex',
    })
    expect(runGit(repo, ['rev-parse', 'HEAD'], { cwdMode: 'option' }).stdout.trim()).toBe(
      headBefore,
    )
    expect(runGit(repo, ['status', '--porcelain'], { cwdMode: 'option' }).stdout.trim()).toContain(
      '?? feature.ts',
    )
  })
})

test('prefers the staged diff instead of mixing in working changes', async () => {
  const adapter = lunaAdapter()

  await withProviderServer(adapter, async (server) => {
    const repo = await initRepo(server.root, 'repo')
    await writeFile(path.join(repo, 'staged.ts'), 'export const staged = true\n')
    runGit(repo, ['add', 'staged.ts'], { cwdMode: 'option' })
    await writeFile(path.join(repo, 'working.ts'), 'export const working = true\n')
    renderControls('repo', true)

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Generate commit message' })).not.toHaveAttribute(
        'aria-disabled',
        'true',
      ),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Generate commit message' }))
    await waitForProviderTurn(adapter)

    expect(adapter.startedTurns[0]?.messageText).toContain('staged.ts')
    expect(adapter.startedTurns[0]?.messageText).toContain('export const staged = true')
    expect(adapter.startedTurns[0]?.messageText).not.toContain('working.ts')
    expect(adapter.startedTurns[0]?.messageText).toContain(
      'The diff comes from the staged changes.',
    )
  })
})

test('falls back to an advertised cheap model at low effort without ChatGPT', async () => {
  const adapter = new MockProviderAdapter({
    auth: { status: 'authenticated', type: 'api-key' },
    models: CHEAP_FALLBACK_MODELS,
    responseText: GENERATED_MESSAGE,
  })

  await withProviderServer(adapter, async (server) => {
    const repo = await initRepo(server.root, 'repo')
    await writeFile(path.join(repo, 'feature.ts'), 'export const feature = true\n')
    renderControls('repo', true)

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Generate commit message' })).not.toHaveAttribute(
        'aria-disabled',
        'true',
      ),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Generate commit message' }))
    await waitForProviderTurn(adapter)

    expect(adapter.startedTurns[0]?.modelSelection).toEqual({
      model: 'gpt-5.5-mini',
      options: { reasoningEffort: 'low' },
      providerInstanceId: 'codex',
    })
  })
})

test('shows the empty-diff error without starting a provider turn', async () => {
  const adapter = lunaAdapter()

  await withProviderServer(adapter, async (server) => {
    await initRepo(server.root, 'repo')
    renderControls('repo', false)

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Generate commit message' })).not.toHaveAttribute(
        'aria-disabled',
        'true',
      ),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Generate commit message' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'There are no staged or working changes to describe.',
    )
    expect(adapter.startedTurns).toHaveLength(0)
    expect(screen.getByRole('textbox', { name: 'Commit message' })).toHaveValue('')
  })
})

test('shows provider failure and preserves the existing commit input', async () => {
  const adapter = lunaAdapter({ shouldFail: true })

  await withProviderServer(adapter, async (server) => {
    const repo = await initRepo(server.root, 'repo')
    await writeFile(path.join(repo, 'feature.ts'), 'export const feature = true\n')
    renderControls('repo', true)

    await userEvent.type(
      screen.getByRole('textbox', { name: 'Commit message' }),
      'fix: keep this draft',
    )
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Generate commit message' })).not.toHaveAttribute(
        'aria-disabled',
        'true',
      ),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Generate commit message' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not generate a commit message with codex: Mock provider failed',
    )
    expect(screen.getByRole('textbox', { name: 'Commit message' })).toHaveValue(
      'fix: keep this draft',
    )
    expect(screen.getByRole('button', { name: 'Generate commit message' })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    )
  })
})

test('cancels and ignores a stale result when the repository root changes', async () => {
  const gate = Promise.withResolvers<void>()
  const adapter = lunaAdapter({ beforeComplete: () => gate.promise })

  await withProviderServer(
    adapter,
    async (server) => {
      const firstRepo = await initRepo(server.root, 'repo-a')
      await writeFile(path.join(firstRepo, 'feature.ts'), 'export const feature = true\n')
      await initRepo(server.root, 'repo-b')
      const view = renderControls('repo-a', true)

      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Generate commit message' })).not.toHaveAttribute(
          'aria-disabled',
          'true',
        ),
      )
      await userEvent.click(screen.getByRole('button', { name: 'Generate commit message' }))
      await waitForProviderTurn(adapter)
      expect(screen.getByRole('button', { name: 'Cancel commit message generation' })).toBeEnabled()
      expect(screen.getByRole('status')).toHaveTextContent('Generating commit message…')

      view.rerender(<ControlsTree hasLocalChanges={false} rootPath='repo-b' />)
      await waitFor(() => expect(adapter.interruptedSessions.length).toBeGreaterThanOrEqual(1))
      expect(screen.getByRole('textbox', { name: 'Commit message' })).toHaveValue('')

      gate.resolve()
      await waitFor(() => expect(adapter.interruptedSessions.length).toBeGreaterThanOrEqual(2))
      view.rerender(<ControlsTree hasLocalChanges rootPath='repo-a' />)
      expect(screen.getByRole('textbox', { name: 'Commit message' })).toHaveValue('')
    },
    gate.resolve,
  )
})

test('finishes cancellation before allowing a fresh generation request', async () => {
  const gate = Promise.withResolvers<void>()
  const adapter = lunaAdapter({ beforeComplete: () => gate.promise })

  await withProviderServer(
    adapter,
    async (server) => {
      const repo = await initRepo(server.root, 'repo')
      await writeFile(path.join(repo, 'feature.ts'), 'export const feature = true\n')
      renderControls('repo', true)

      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Generate commit message' })).not.toHaveAttribute(
          'aria-disabled',
          'true',
        ),
      )
      await userEvent.click(screen.getByRole('button', { name: 'Generate commit message' }))
      await waitForProviderTurn(adapter)
      await userEvent.click(
        screen.getByRole('button', { name: 'Cancel commit message generation' }),
      )

      expect(screen.getByRole('button', { name: 'Cancelling commit message…' })).toHaveAttribute(
        'aria-disabled',
        'true',
      )
      await waitFor(() => expect(adapter.interruptedSessions.length).toBeGreaterThanOrEqual(1))

      gate.resolve()
      const generate = await screen.findByRole('button', { name: 'Generate commit message' })
      expect(generate).toBeEnabled()
      expect(screen.getByRole('textbox', { name: 'Commit message' })).toHaveValue('')

      await userEvent.click(generate)
      await waitFor(() => expect(adapter.startedTurns).toHaveLength(2))
      await waitFor(() => {
        expect(screen.getByRole('textbox', { name: 'Commit message' })).toHaveValue(
          GENERATED_MESSAGE,
        )
      })
    },
    gate.resolve,
  )
})

test('does not overwrite commit text edited while generation is pending', async () => {
  const gate = Promise.withResolvers<void>()
  const adapter = lunaAdapter({ beforeComplete: () => gate.promise })

  await withProviderServer(
    adapter,
    async (server) => {
      const repo = await initRepo(server.root, 'repo')
      await writeFile(path.join(repo, 'feature.ts'), 'export const feature = true\n')
      renderControls('repo', true)

      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Generate commit message' })).not.toHaveAttribute(
          'aria-disabled',
          'true',
        ),
      )
      await userEvent.click(screen.getByRole('button', { name: 'Generate commit message' }))
      await waitForProviderTurn(adapter)
      expect(screen.getByRole('button', { name: 'Cancel commit message generation' })).toBeEnabled()

      const input = screen.getByRole('textbox', { name: 'Commit message' })
      await userEvent.type(input, 'docs: keep my wording')
      gate.resolve()

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Generate commit message' })).not.toHaveAttribute(
          'aria-disabled',
          'true',
        )
      })
      expect(input).toHaveValue('docs: keep my wording')
    },
    gate.resolve,
  )
})

function ControlsTree({
  hasLocalChanges,
  rootPath,
}: {
  hasLocalChanges: boolean
  rootPath: string
}) {
  const repository = {
    ahead: 0,
    behind: 0,
    branch: 'main',
    commit: 'test-head',
    path: rootPath,
  }

  return (
    <EditorStateProvider>
      <GitStoreProvider rootPath={rootPath}>
        <CommitControls
          hasLocalChanges={hasLocalChanges}
          repository={repository}
          rootPath={rootPath}
        />
      </GitStoreProvider>
    </EditorStateProvider>
  )
}

function renderControls(rootPath: string, hasLocalChanges: boolean) {
  return renderWithProviders(<ControlsTree hasLocalChanges={hasLocalChanges} rootPath={rootPath} />)
}

function lunaAdapter(options: ConstructorParameters<typeof MockProviderAdapter>[0] = {}) {
  return new MockProviderAdapter({
    auth: { status: 'authenticated', type: 'chatgpt' },
    models: LUNA_MODELS,
    responseText: GENERATED_MESSAGE,
    ...options,
  })
}

async function withProviderServer(
  providerAdapter: MockProviderAdapter,
  run: (server: TestServer) => Promise<void>,
  releasePending?: () => void,
) {
  const server = await makeTestServer({ providerAdapter })
  const previousClient: Client = getClient()
  setClient(createInProcessClient(server))

  try {
    await run(server)
  } finally {
    releasePending?.()
    cleanup()
    setClient(previousClient)
    await server.cleanup()
  }
}

async function initRepo(root: string, name: string) {
  const repo = path.join(root, name)
  await mkdir(repo, { recursive: true })
  runGit(repo, ['init', '-b', 'main'], { cwdMode: 'option' })
  await writeFile(path.join(repo, 'readme.md'), 'initial\n')
  runGit(repo, ['add', 'readme.md'], { cwdMode: 'option' })
  runGit(repo, ['commit', '-m', 'init'], { cwdMode: 'option' })
  return repo
}

async function waitForProviderTurn(adapter: MockProviderAdapter) {
  await waitFor(() => expect(adapter.startedTurns).toHaveLength(1))
}
