import {
  testNullableTabContent,
  testTabContents,
} from '../../../../test/factories/document-targets'
import { testWorkspaceAddress } from '../../../../test/factories/workspace-address'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe } from 'vitest'

import { expect, test } from '../../../../test/fixtures'

import {
  STATE_CLASSIFICATIONS,
  classifiedStorageKeys,
  statesClassifiedAs,
} from '@/features/address/utils/classification'
import { applicableTabs, MAX_APPLIED_TABS } from '@workspace/client-core/address/grammar'
import { addressFromSnapshot, emptyAddressSnapshot } from '@/features/address/utils/snapshot'

const SOURCE_ROOT = join(import.meta.dirname, '../../..')
const STORAGE_KEY_PATTERN = /['"`](platform[.:][\w.:-]*)['"`]/g

/**
 * `platform.` also prefixes logger areas, plugin ids and keymap categories, none of
 * which are persisted state. A literal counts as a storage key only where it is used
 * as one: on a line touching `localStorage`, or one naming a storage-key constant.
 */
const STORAGE_CONTEXT_PATTERN =
  /localStorage|sessionStorage|[A-Z0-9_]*_KEY\b|[A-Za-z]+(?:Storage|Cache)Key|storageKey/

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    if (!/\.tsx?$/.test(entry.name)) return []

    return [path]
  })
}

function persistedKeysInSource() {
  const keys = new Map<string, string>()

  for (const file of sourceFiles(SOURCE_ROOT)) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!STORAGE_CONTEXT_PATTERN.test(line)) continue

      for (const [, key] of line.matchAll(STORAGE_KEY_PATTERN)) {
        if (!keys.has(key)) keys.set(key, file)
      }
    }
  }

  return keys
}

describe('the classification table', () => {
  test('classifies every state exactly once, with a reason', () => {
    for (const [name, entry] of Object.entries(STATE_CLASSIFICATIONS)) {
      expect(entry.why, `${name} needs a reason`).toBeTruthy()
      expect(['address', 'preference', 'ephemeral']).toContain(entry.classification)
    }
  })

  // The one drift this design cannot otherwise catch: a new code path that persists
  // something and never tells the address layer it exists.
  test('accounts for every `platform.*` storage key in the source tree', () => {
    const classified = classifiedStorageKeys()
    const unclassified = [...persistedKeysInSource()]
      .filter(([key]) => !classified.has(key))
      // A namespace fragment that a classified key is BUILT FROM is not its own state:
      // the per-root slice and search keys are `${CACHE_KEY_PREFIX}.workspace:` plus a
      // runtime path, so only the prefix literal ever appears in the source.
      .filter(([key]) => ![...classified].some((full) => full.startsWith(key)))
      .map(([key, file]) => `${key} (${file.replace(SOURCE_ROOT, '')})`)

    expect(unclassified, 'classify these in features/address/utils/classification.ts').toEqual([])
  })

  test('keeps the take-once inboxes ephemeral, which is why the deny-list is structural', () => {
    const ephemeral = statesClassifiedAs('ephemeral')

    expect(ephemeral).toContain('terminalCommandInbox')
    expect(ephemeral).toContain('composerInbox')
    expect(ephemeral).toContain('searchReplaceText')
    expect(ephemeral).toContain('sessionMultiSelect')
  })

  test('keeps geometry and appearance out of the address', () => {
    const preference = statesClassifiedAs('preference')

    expect(preference).toContain('workbenchLayout')
    expect(preference).toContain('resizableLayoutChatMode')
    expect(preference).toContain('editorColorTheme')
    expect(preference).toContain('scrollPositions')
  })
})

describe('the encoder cannot emit what it cannot reach', () => {
  test('produces only whitelisted fields, and nothing ephemeral', () => {
    const address = addressFromSnapshot({
      ...emptyAddressSnapshot(),
      activeTabContent: testNullableTabContent('/repo/src/a.ts'),
      editorTabContents: testTabContents(['/repo/src/a.ts']),
      workspaceAddress: testWorkspaceAddress('/repo'),
      mode: 'workbench',
      rootPath: '/repo',
    })

    expect(Object.keys(address).sort()).toEqual([
      'bottom',
      'chat',
      'diff',
      'document',
      'editor',
      'environmentId',
      'focus',
      'logs',
      'mode',
      'passthrough',
      'rail',
      'rejectedEnvironment',
      'search',
      'settings',
      'side',
      'tabs',
      'tool',
      'workspace',
    ])
    expect(JSON.stringify(address)).not.toContain('replace')
    expect(JSON.stringify(address)).not.toContain('queryHistory')
  })

  // Some dev params are read after startup, so view replacements must preserve them.
  test('carries the reserved dev params into every captured address', () => {
    const passthrough = {
      decode: 'diffusion',
      editorPerfLayout: 'transform',
      editorPerfTrace: '1',
    }

    expect(
      addressFromSnapshot({
        ...emptyAddressSnapshot(),
        workspaceAddress: testWorkspaceAddress('/repo'),
        passthrough,
        rootPath: '/repo',
      }).passthrough,
    ).toEqual(passthrough)
    expect(addressFromSnapshot({ ...emptyAddressSnapshot(), passthrough }).passthrough).toEqual(
      passthrough,
    )
  })

  test('emits no workspace document at all when no folder is open', () => {
    const address = addressFromSnapshot(emptyAddressSnapshot())

    expect(address).toMatchObject({ document: null, tabs: [], workspace: '-' })
  })

  test('drops a conflict document from the tab set rather than encoding it', () => {
    const address = addressFromSnapshot({
      ...emptyAddressSnapshot(),
      editorTabContents: testTabContents(['/repo/src/a.ts', 'conflict-diff:abc']),
      workspaceAddress: testWorkspaceAddress('/repo'),
      rootPath: '/repo',
    })

    expect(address.tabs).toEqual(['f/src/a.ts'])
  })
})

describe('the tab set budget', () => {
  // A partial tab set would DELETE tabs on apply, so over budget it is dropped whole.
  test('drops `tabs` entirely rather than truncating it', () => {
    const many = Array.from({ length: 400 }, (_, index) => `/repo/src/a-very-long-name-${index}.ts`)
    const address = addressFromSnapshot({
      ...emptyAddressSnapshot(),
      activeTabContent: testNullableTabContent(many[0]),
      editorTabContents: testTabContents(many),
      workspaceAddress: testWorkspaceAddress('/repo'),
      rootPath: '/repo',
    })

    expect(address.tabs).toBeNull()
    // The path still names the active document, so the link degrades to something useful.
    expect(address.document).toBe('f/src/a-very-long-name-0.ts')
  })

  /**
   * The count ceiling, which the byte ceiling does not imply: sixty-five short tokens sit
   * far under 1500 bytes, and `applicableTabs` on the reading side discards any set past
   * `MAX_APPLIED_TABS` whole — so emitting one handed the recipient a link that restored
   * no tabs at all.
   */
  test('drops a tab set larger than the reader will apply, however short the tokens', () => {
    const many = Array.from({ length: MAX_APPLIED_TABS + 1 }, (_, index) => `/repo/${index}.ts`)
    const address = addressFromSnapshot({
      ...emptyAddressSnapshot(),
      editorTabContents: testTabContents(many),
      workspaceAddress: testWorkspaceAddress('/repo'),
      rootPath: '/repo',
    })

    expect(many.join('~').length).toBeLessThan(1500)
    expect(address.tabs).toBeNull()
  })

  test('keeps a tab set exactly at the reader\u2019s ceiling', () => {
    const many = Array.from({ length: MAX_APPLIED_TABS }, (_, index) => `/repo/${index}.ts`)
    const address = addressFromSnapshot({
      ...emptyAddressSnapshot(),
      editorTabContents: testTabContents(many),
      workspaceAddress: testWorkspaceAddress('/repo'),
      rootPath: '/repo',
    })

    expect(address.tabs).toHaveLength(MAX_APPLIED_TABS)
    expect(applicableTabs(address.tabs)).not.toBeNull()
  })

  test('keeps a tab set that fits', () => {
    const address = addressFromSnapshot({
      ...emptyAddressSnapshot(),
      editorTabContents: testTabContents(['/repo/src/a.ts', '/repo/src/b.ts']),
      workspaceAddress: testWorkspaceAddress('/repo'),
      rootPath: '/repo',
    })

    expect(address.tabs).toEqual(['f/src/a.ts', 'f/src/b.ts'])
  })
})

describe('the settings category belongs to an open settings document', () => {
  // The category store keeps its pick after the tab closes. Reading it directly left
  // `?settings=` in the URL forever and reopened the page on every reload.
  test('emits nothing when no settings tab is open, even with a remembered category', () => {
    expect(
      addressFromSnapshot({
        ...emptyAddressSnapshot(),
        editorTabContents: testTabContents(['/repo/src/a.ts']),
        workspaceAddress: testWorkspaceAddress('/repo'),
        rootPath: '/repo',
        settingsCategory: 'providers',
      }).settings,
    ).toBeNull()
  })

  test('emits the category when a settings tab is open', () => {
    expect(
      addressFromSnapshot({
        ...emptyAddressSnapshot(),
        editorTabContents: testTabContents(['settings:']),
        workspaceAddress: testWorkspaceAddress('/repo'),
        rootPath: '/repo',
        settingsCategory: 'providers',
      }).settings,
    ).toBe('providers')
  })

  test('omits the category when no category is selected', () => {
    expect(
      addressFromSnapshot({
        ...emptyAddressSnapshot(),
        activeTabContent: testNullableTabContent('/repo/src/a.ts'),
        editorTabContents: testTabContents(['/repo/src/a.ts', 'settings:']),
        workspaceAddress: testWorkspaceAddress('/repo'),
        rootPath: '/repo',
      }).settings,
    ).toBeNull()
  })
})
