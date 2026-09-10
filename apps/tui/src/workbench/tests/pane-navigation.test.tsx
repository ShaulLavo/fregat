import { writeFile } from 'node:fs/promises'
import { act } from 'react'
import { test, expect } from '../../../test/fixtures'
import { createWorkbenchFrame } from '../../../test/factories/workbench-frame'
import { prepareGitWorkbench } from '../../../test/factories/git-workbench'
import { runPaletteCommand } from '../../../test/actions'

test.for([132, 60])(
  'search navigation focuses its query and moves between filter fields at %i columns',
  async (width, { server }) => {
    await writeFile(`${server.root}/sample.txt`, 'changed source')
    const fixture = await createWorkbenchFrame(server, {
      location: { kind: 'workbench', rootPath: '', pane: 'files', path: 'sample.txt' },
      width,
    })
    const { frame } = fixture
    try {
      await expect
        .poll(async () => {
          await act(async () => {
            await frame.renderOnce()
          })
          return frame.renderer.currentFocusedRenderable?.id
        })
        .toBe('workbench-viewer')
      await runPaletteCommand(frame, 'Open Search Editor')
      expect(frame.renderer.currentFocusedRenderable?.id).toBe('search-query')
      await act(async () => {
        await frame.mockInput.typeText('changed')
        frame.mockInput.pressKey('TAB')
      })
      expect(frame.renderer.currentFocusedRenderable?.id).toBe('search-include')
      await act(async () => {
        await frame.mockInput.typeText('*.txt')
        frame.mockInput.pressKey('TAB')
      })
      expect(frame.renderer.currentFocusedRenderable?.id).toBe('search-exclude')
      await act(async () => {
        frame.mockInput.pressKey('TAB', { shift: true })
      })
      expect(frame.renderer.currentFocusedRenderable?.id).toBe('search-include')
    } finally {
      await fixture.cleanup()
    }
  },
)

test.for([132, 60])(
  'Git main list and diff retain separate focus, and Logs focuses its filter at %i columns',
  async (width, { server }) => {
    await prepareGitWorkbench(server.root)
    const fixture = await createWorkbenchFrame(server, {
      location: { kind: 'workbench', rootPath: '', pane: 'git', path: 'sample.txt' },
      width,
    })
    const { frame } = fixture
    try {
      await expect
        .poll(async () => {
          await act(async () => {
            await frame.renderOnce()
          })
          return frame.captureCharFrame()
        })
        .toContain('changed line')
      expect(frame.renderer.currentFocusedRenderable?.id).toBe('git-changes')
      await act(async () => {
        frame.mockInput.pressKey('TAB')
      })
      expect(frame.renderer.currentFocusedRenderable?.id).toBe('workbench-diff')
      await runPaletteCommand(frame, 'Focus Git')
      expect(frame.renderer.currentFocusedRenderable?.id).not.toBe('workbench-diff')
      expect(['workbench-git', 'git-changes']).toContain(
        frame.renderer.currentFocusedRenderable?.id,
      )
      await runPaletteCommand(frame, 'Show logs')
      expect(frame.renderer.currentFocusedRenderable?.id).toBe('logs-filter')
      await act(async () => {
        await frame.mockInput.typeText('source:be')
      })
      expect(frame.renderer.currentFocusedRenderable?.id).toBe('logs-filter')
    } finally {
      await fixture.cleanup()
    }
  },
)

test('narrow layout returns from the viewer to its tree and back', async ({ server }) => {
  await writeFile(`${server.root}/sample.txt`, 'Opened in the narrow viewer')
  const fixture = await createWorkbenchFrame(server, {
    location: { kind: 'workbench', rootPath: '', pane: 'files', path: 'sample.txt' },
    width: 60,
    height: 26,
  })
  const { frame } = fixture
  try {
    await expect
      .poll(async () => {
        await act(async () => {
          await frame.renderOnce()
        })
        return frame.renderer.currentFocusedRenderable?.id
      })
      .toBe('workbench-viewer')
    await runPaletteCommand(frame, 'Focus file tree')
    await expect
      .poll(async () => {
        await act(async () => {
          await frame.renderOnce()
        })
        return frame.renderer.currentFocusedRenderable?.id
      })
      .toBe('workbench-file-tree')
    expect(frame.captureCharFrame()).toContain('sample.txt')
    expect(frame.captureCharFrame()).not.toContain('Opened in the narrow viewer')
    await runPaletteCommand(frame, 'Focus editor')
    await expect
      .poll(async () => {
        await act(async () => {
          await frame.renderOnce()
        })
        return frame.captureCharFrame()
      })
      .toContain('Opened in the narrow viewer')
    expect(frame.renderer.currentFocusedRenderable?.id).toBe('workbench-viewer')
  } finally {
    await fixture.cleanup()
  }
})

test('hidden and offline viewers cannot launch the editor', async ({ server }) => {
  await writeFile(`${server.root}/sample.txt`, 'unchanged')
  let edits = 0
  const fixture = await createWorkbenchFrame(server, {
    location: { kind: 'workbench', rootPath: '', pane: 'files', path: 'sample.txt' },
    onEditText: async () => {
      edits += 1
      return 'unexpected edit'
    },
  })
  const { frame } = fixture
  try {
    await expect
      .poll(async () => {
        await act(async () => {
          await frame.renderOnce()
        })
        return frame.renderer.currentFocusedRenderable?.id
      })
      .toBe('workbench-viewer')
    await runPaletteCommand(frame, 'Open Search Editor')
    await runPaletteCommand(frame, 'Edit file')
    expect(edits).toBe(0)
    await act(async () => {
      frame.mockInput.pressKey('ESCAPE')
    })
    await runPaletteCommand(frame, 'Focus editor')
    await act(async () => {
      fixture.transport.sockets[0]?.serverClose({ code: 1006, wasClean: false })
    })
    expect(fixture.session.getSnapshot()).toMatchObject({
      kind: 'ready',
      connection: { kind: 'offline' },
    })
    await act(async () => {
      frame.mockInput.pressKey('k', { ctrl: true })
    })
    await act(async () => {
      frame.mockInput.pressKey('x')
    })
    await runPaletteCommand(frame, 'Edit file')
    expect(edits).toBe(0)
    expect(
      (await fixture.session.client.fs.read.get({ query: { path: 'sample.txt' } })).data,
    ).toMatchObject({ content: 'unchanged' })
  } finally {
    await fixture.cleanup()
  }
})

test('wide layout honors Focus file tree from Search with an open file', async ({ server }) => {
  await writeFile(`${server.root}/sample.txt`, 'Viewer remains open')
  const fixture = await createWorkbenchFrame(server, {
    location: { kind: 'workbench', rootPath: '', pane: 'search', path: 'sample.txt' },
    width: 132,
  })
  const { frame } = fixture
  try {
    await expect.poll(() => frame.renderer.currentFocusedRenderable?.id).toBe('search-query')
    await runPaletteCommand(frame, 'Focus file tree')
    await expect
      .poll(async () => {
        await act(async () => {
          await frame.renderOnce()
        })
        return frame.renderer.currentFocusedRenderable?.id
      })
      .toBe('workbench-file-tree')
    await expect
      .poll(async () => {
        await act(async () => {
          await frame.renderOnce()
        })
        return frame.captureCharFrame()
      })
      .toContain('Viewer remains open')
    await runPaletteCommand(frame, 'Focus editor')
    expect(frame.renderer.currentFocusedRenderable?.id).toBe('workbench-viewer')
  } finally {
    await fixture.cleanup()
  }
})

test('a pane dialog opened through the palette retains focus across layout changes', async ({
  server,
}) => {
  await writeFile(`${server.root}/sample.txt`, 'Viewer remains open')
  const fixture = await createWorkbenchFrame(server, {
    location: { kind: 'workbench', rootPath: '', pane: 'files', path: 'sample.txt' },
    width: 132,
    height: 40,
  })
  const { frame } = fixture
  try {
    await expect
      .poll(async () => {
        await act(async () => {
          await frame.renderOnce()
        })
        return frame.renderer.currentFocusedRenderable?.id
      })
      .toBe('workbench-viewer')
    await runPaletteCommand(frame, 'Go to line')
    expect(frame.renderer.currentFocusedRenderable?.id).toBe('viewer-prompt')
    await act(async () => {
      frame.resize(60, 26)
      await frame.renderOnce()
    })
    expect(frame.renderer.currentFocusedRenderable?.id).toBe('viewer-prompt')
    await act(async () => {
      await frame.mockInput.typeText('2')
      frame.mockInput.pressKey('ESCAPE')
    })
    expect(frame.renderer.currentFocusedRenderable?.id).toBe('workbench-viewer')
    await runPaletteCommand(frame, 'Focus file tree')
    await expect
      .poll(async () => {
        await act(async () => {
          await frame.renderOnce()
        })
        return frame.renderer.currentFocusedRenderable?.id
      })
      .toBe('workbench-file-tree')
  } finally {
    await fixture.cleanup()
  }
})
