import { expect, test } from 'vitest'
import { fileURLToPath } from 'node:url'

test('host benchmark seeds import in a command-line process and encode file and inert subjects', async () => {
  const directory = fileURLToPath(new URL('../../apps/web/', import.meta.url))
  const source = `
    import { workspaceCacheEntries } from './scripts/bench-workspace.mjs';
    import { WORKSPACE_CACHE_STORAGE_KEYS } from './src/lib/workspace-cache-keys.ts';
    import { workspaceSliceStorageKey } from './src/features/workspace/utils/cache-keys.ts';
    import { decodeTabContent } from './src/lib/documents/utils/storage-codec.ts';
    import { workspaceRoot } from './src/lib/documents/utils/identity.ts';
    import { environmentStorageKey } from './src/lib/environments/state/scoped-storage.ts';
    const workspace = {
      environmentId: '7cd3c757-df04-4b96-8e6f-98f4bc36d835',
      filePath: 'repo/src/a.ts',
      rootFolder: { birthtimeMs: 0, mtimeMs: 0, name: 'repo', path: 'repo', size: 0, type: 'directory', version: '', workspaceAddress: { id: 'Fixture_00000001', name: 'repo', path: 'repo' } },
    };
    const output = [false, true].map((inert) => {
      const entries = workspaceCacheEntries(workspace, { inert });
      const scopedKey = (key) => environmentStorageKey(workspace.environmentId, key);
      const slice = entries[scopedKey(workspaceSliceStorageKey('repo'))];
      const group = slice.workbenchPanels.editorGroups.root;
      return {
        root: entries[scopedKey(WORKSPACE_CACHE_STORAGE_KEYS.rootFolder)],
        index: entries[scopedKey(WORKSPACE_CACHE_STORAGE_KEYS.workspaceIndex)],
        history: slice.editorHistory.map((content) => decodeTabContent(content, workspaceRoot('repo'))),
        selected: group.tabs.filter((tab) => tab.id === group.selectedTabId).map((tab) => decodeTabContent(tab.content, workspaceRoot('repo'))),
        oldFields: 'activeEditorTabId' in slice.workbenchPanels || 'editorTabs' in slice.workbenchPanels,
      };
    });
    console.log(JSON.stringify({ browserGlobal: typeof window, output }));
  `
  const child = Bun.spawn([process.execPath, '-e', source], {
    cwd: directory,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  expect({ code, stderr }).toEqual({ code: 0, stderr: '' })
  expect(JSON.parse(stdout)).toEqual({
    browserGlobal: 'undefined',
    output: ['file', 'search'].map((kind) => {
      const document =
        kind === 'file' ? { kind, resource: { path: 'repo/src/a.ts' } } : { kind, root: 'repo' }
      const content = { kind: 'document', document }
      return {
        root: {
          folder: {
            birthtimeMs: 0,
            mtimeMs: 0,
            name: 'repo',
            path: 'repo',
            size: 0,
            type: 'directory',
            version: '',
            workspaceAddress: { id: 'Fixture_00000001', name: 'repo', path: 'repo' },
          },
          location: { kind: 'folder', rootPath: 'repo' },
        },
        index: [{ kind: 'folder', rootPath: 'repo' }],
        history: [content],
        selected: [content],
        oldFields: false,
      }
    }),
  })
})
