import { openFixtureWorkspace, releaseFixture } from '../fixture-workspace'
import { mkdir, mkdtemp, readFile, rename, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Page } from 'playwright'

import { createScriptError } from '../../structured-errors'
import { focusEditor, openFileFromTree, selectors } from '../selectors'
import type { Scenario } from './index'

const filename = 'linked-edit-probe.txt'
const before = 'keep this line\nREMOVE_THIS_LINE\nkeep this too\n'
const after = 'keep this line\nkeep this too\n'
const otherFile = 'watch-tab-probe.txt'
const inspections = new WeakMap<
  Page,
  { disk: string; phases: string[]; subscriptions: { before: number; after: number } }
>()

export const editorExternalEdit: Scenario = {
  name: 'editor-external-edit',
  description:
    'Delete a line through a linked folder, replace the file atomically, and protect an unsaved edit from an external write.',
  async run(page, { step }) {
    const fixture = await mkdtemp('/work/tmp/fregat-external-edit-')
    const project = path.join(fixture, 'project')
    const target = path.join(fixture, 'target')
    let disk = path.join(target, filename)
    const inspection = {
      disk: before,
      phases: new Array<string>(),
      subscriptions: { before: 0, after: 0 },
    }
    inspections.set(page, inspection)
    let projectSubscriptions = 0
    page.on('request', (request) => {
      const url = new URL(request.url())
      if (!url.pathname.endsWith('/fs/events')) return
      if (url.searchParams.get('scope') === 'files') return
      if (!url.searchParams.get('path')?.endsWith(project.slice(1))) return
      projectSubscriptions += 1
    })
    try {
      await mkdir(project)
      const git = Bun.spawn(['git', 'init', '--quiet', project], {
        stdout: 'ignore',
        stderr: 'pipe',
      })
      if (await git.exited) throw createScriptError('Could not initialize the probe repository')
      const commit = Bun.spawn(
        [
          'git',
          '-C',
          project,
          '-c',
          'user.name=Watch probe',
          '-c',
          'user.email=watch-probe@example.invalid',
          'commit',
          '--quiet',
          '--allow-empty',
          '-m',
          path.basename(fixture),
        ],
        { stdout: 'ignore', stderr: 'pipe' },
      )
      if (await commit.exited)
        throw createScriptError('Could not create the probe repository identity')
      await mkdir(target)
      await symlink('../target', path.join(project, 'linked'))
      await writeFile(disk, before)
      await writeFile(path.join(project, otherFile), 'ANOTHER_OPEN_TAB\n')
      await openFixtureWorkspace(page, project)
      await selectors.treeItem(page, 'linked').click()
      await openFileFromTree(page, filename)
      await selectors.editorRows(page).filter({ hasText: 'REMOVE_THIS_LINE' }).waitFor()
      await step('before-external-edit')

      await writeFile(disk, after)
      inspection.disk = await readFile(disk, 'utf8')
      await selectors
        .editorRows(page)
        .filter({ hasText: 'REMOVE_THIS_LINE' })
        .waitFor({ state: 'hidden', timeout: 5000 })
      inspection.phases.push('line-removed')
      await step('line-removed')

      await writeFile(`${disk}.tmp`, 'ATOMIC_REPLACEMENT\n')
      await rename(`${disk}.tmp`, disk)
      inspection.disk = await readFile(disk, 'utf8')
      await selectors
        .editorRows(page)
        .filter({ hasText: 'ATOMIC_REPLACEMENT' })
        .waitFor({ timeout: 5000 })
      inspection.phases.push('atomic-replacement')
      await step('atomic-replacement')

      const nextTarget = path.join(fixture, 'next-target')
      await mkdir(nextTarget)
      disk = path.join(nextTarget, filename)
      await writeFile(disk, 'RETARGETED_FILE\n')
      await symlink('../next-target', path.join(project, 'next-link'))
      await rename(path.join(project, 'next-link'), path.join(project, 'linked'))
      await selectors
        .editorRows(page)
        .filter({ hasText: 'RETARGETED_FILE' })
        .waitFor({ timeout: 5000 })
      await writeFile(disk, 'EDIT_AFTER_RETARGET\n')
      await selectors
        .editorRows(page)
        .filter({ hasText: 'EDIT_AFTER_RETARGET' })
        .waitFor({ timeout: 5000 })
      inspection.phases.push('symlink-retargeted')
      await step('symlink-retargeted')

      await rename(nextTarget, path.join(fixture, 'old-target'))
      await mkdir(nextTarget)
      await writeFile(disk, 'REPLACED_DIRECTORY\n')
      await selectors
        .editorRows(page)
        .filter({ hasText: 'REPLACED_DIRECTORY' })
        .waitFor({ timeout: 5000 })
      await writeFile(disk, 'EDIT_AFTER_DIRECTORY_REPLACEMENT\n')
      await selectors
        .editorRows(page)
        .filter({ hasText: 'EDIT_AFTER_DIRECTORY_REPLACEMENT' })
        .waitFor({ timeout: 5000 })
      inspection.phases.push('directory-replaced')
      await step('directory-replaced')

      await focusEditor(page)
      await page.keyboard.press('Control+End')
      await page.keyboard.type('UNSAVED_LOCAL_EDIT')
      const subscriptionsBeforeTabChange = projectSubscriptions
      await Promise.all([writeFile(disk, 'EXTERNAL_CONFLICT\n'), openFileFromTree(page, otherFile)])
      await selectors.editorRows(page).filter({ hasText: 'ANOTHER_OPEN_TAB' }).waitFor()
      if (projectSubscriptions !== subscriptionsBeforeTabChange)
        throw createScriptError('Opening a tab restarted the project filesystem subscription')
      await selectors.editorTabNamed(page, /watch-tab-probe\.txt/).click({ button: 'right' })
      await selectors.menuItem(page, 'Close').click()
      await selectors.editorRows(page).filter({ hasText: 'UNSAVED_LOCAL_EDIT' }).waitFor()
      if (projectSubscriptions !== subscriptionsBeforeTabChange)
        throw createScriptError('Closing a tab restarted the project filesystem subscription')
      inspection.subscriptions = {
        before: subscriptionsBeforeTabChange,
        after: projectSubscriptions,
      }
      inspection.phases.push('project-watch-preserved')
      inspection.disk = await readFile(disk, 'utf8')
      await selectors.fileConflict(page, filename).waitFor({ timeout: 5000 })
      await selectors.editorRows(page).filter({ hasText: 'UNSAVED_LOCAL_EDIT' }).waitFor()
      inspection.phases.push('unsaved-edit-protected')
      await step('unsaved-edit-protected')
      await selectors
        .fileConflict(page, filename)
        .getByRole('button', { name: 'Revert', exact: true })
        .click()
      await selectors.editorRows(page).filter({ hasText: 'EXTERNAL_CONFLICT' }).waitFor()
      await step('reverted-to-disk')
    } finally {
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')))
      await releaseFixture(fixture)
    }
  },
  async inspect(page) {
    return inspections.get(page)
  },
}
