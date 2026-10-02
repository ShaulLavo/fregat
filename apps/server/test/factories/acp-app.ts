import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { closeApp, orchestrationForApp } from '../../src/app'
import type { AnyProviderDriver } from '../../src/provider/driver'
import { ProviderAdapterRegistry } from '../../src/provider/provider-adapter-registry'
import { runGit } from '../../src/testing/git'
import { createTestApp } from '../server'
import { createAcpFixture } from './acp'

export async function createAcpAppFixture(driver: AnyProviderDriver) {
  const native = await createAcpFixture(driver)
  await runGit(native.root, ['init', '-b', 'main'], { cwdMode: 'option' })
  await writeFile(path.join(native.root, 'tracked.txt'), 'fixture\n')
  await runGit(native.root, ['add', 'tracked.txt'], { cwdMode: 'option' })
  await runGit(native.root, ['commit', '-m', 'fixture'], { cwdMode: 'option' })
  const app = createTestApp({
    workspaceRoot: native.root,
    settings: { userFilePath: path.join(native.root, '.git', 'settings.json') },
    orchestration: {
      providerRuntime: true,
      attachmentsDir: path.join(native.root, '.git', 'attachments'),
      providerAdapterRegistry: new ProviderAdapterRegistry({
        adapters: [native.handle.adapter],
        services: { cwd: native.root },
      }),
    },
  })
  const engine = orchestrationForApp(app)
  const registered = await engine.dispatchClientCommand({
    type: 'project.create',
    commandId: `${driver.driverKind}-app-project`,
    title: `${driver.displayName} app fixture`,
    workspaceRoot: native.root,
    defaultModelSelection: native.input.modelSelection,
  })
  if (!registered.result) throw new TypeError('Missing fixture registration')
  return {
    ...native,
    app,
    engine,
    registration: registered.result,
    command: (command: unknown) =>
      app.handle(
        new Request('http://localhost/orchestration/commands', {
          method: 'POST',
          headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
          body: JSON.stringify(command),
        }),
      ),
    dispose: async () => {
      await closeApp(app)
      await native.dispose()
    },
  }
}
