import path from 'node:path'
import { platformHomePath } from '../../home'
import { afterEach, expect, test } from 'vitest'
import { createAcpFixture } from '../../../test/factories/acp'
import { cursorDriver } from '../drivers/cursor'
import { readCursorCatalog } from '../utils/cursor-catalog'

const fixtures: Awaited<ReturnType<typeof createAcpFixture>>[] = []
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.dispose()))
})

test('reads advertised Cursor models, grouped choices and booleans through the native executable', async () => {
  const fixture = await createAcpFixture(cursorDriver)
  fixtures.push(fixture)
  const models = await readCursorCatalog({
    executable: fixture.binaryPath,
    args: ['acp'],
    cwd: fixture.root,
    env: fixture.env,
    operationTimeoutMs: () => 5000,
  })
  expect(models).toEqual([
    { slug: 'auto', name: 'Automatic', isCustom: false, capabilities: null },
    {
      slug: 'fixture-cursor-small',
      name: 'Fixture small',
      isCustom: false,
      capabilities: {
        optionDescriptors: [
          {
            id: 'reasoning',
            label: 'Reasoning',
            type: 'select',
            currentValue: 'high',
            options: [
              { id: 'low', label: 'Low', isDefault: false },
              { id: 'high', label: 'High', isDefault: true },
            ],
          },
          {
            id: 'context',
            label: 'Context',
            description: 'Native context choice',
            type: 'select',
            currentValue: 'wide',
            options: [
              { id: 'small', label: 'Small', isDefault: false },
              { id: 'wide', label: 'Wide', isDefault: true },
            ],
          },
          { id: 'fast', label: 'Fast', type: 'boolean', currentValue: false },
        ],
      },
    },
  ])
  const records = await fixture.records()
  expect(records.find((entry) => entry.method === 'initialize')?.params.clientCapabilities).toEqual(
    { _meta: { parameterizedModelPicker: true } },
  )
  expect(records.filter((entry) => entry.method).map((entry) => entry.method)).toEqual([
    'initialize',
    'authenticate',
    'cursor/list_available_models',
  ])
  const pid = records.find((entry) => entry.event === 'spawn')?.pid
  expect(typeof pid).toBe('number')
  expect(() => process.kill(pid, 0)).toThrow()
})

test('rejects malformed native option values and reaps the catalogue process', async () => {
  const fixture = await createAcpFixture(cursorDriver)
  fixtures.push(fixture)
  await expect(
    readCursorCatalog({
      executable: fixture.binaryPath,
      args: ['acp', '--catalog-malformed'],
      cwd: fixture.root,
      env: fixture.env,
      operationTimeoutMs: () => 5000,
    }),
  ).rejects.toMatchObject({ code: 'provider-acp.PROTOCOL' })
  const records = await fixture.records()
  expect(records.some((entry) => entry.method === 'cursor/list_available_models')).toBe(true)
  expect(() => process.kill(records.find((entry) => entry.event === 'spawn')?.pid, 0)).toThrow()
})

test('settles a silent native catalogue with the injected operation deadline and reaps its child', async () => {
  const fixture = await createAcpFixture(cursorDriver)
  fixtures.push(fixture)
  const failure = expect(
    readCursorCatalog({
      executable: fixture.binaryPath,
      args: ['acp', '--catalog-hang'],
      cwd: fixture.root,
      env: fixture.env,
      operationTimeoutMs: () => 1000,
    }),
  ).rejects.toMatchObject({ code: 'provider-acp.ABORTED' })
  await expect
    .poll(async () =>
      (await fixture.records()).some((entry) => entry.method === 'cursor/list_available_models'),
    )
    .toBe(true)
  const pid = (await fixture.records()).find((entry) => entry.event === 'spawn')?.pid
  expect(typeof pid).toBe('number')
  expect(() => process.kill(pid, 0)).not.toThrow()
  await failure
  expect(() => process.kill(pid, 0)).toThrow()
})

test('driver discovers native models before a session and applies advertised choices on the wire', async () => {
  const fixture = await createAcpFixture(cursorDriver)
  fixtures.push(fixture)
  const snapshot = await fixture.handle.adapter.snapshot()
  expect(snapshot.status).toBe('ready')
  expect(snapshot.auth.status).toBe('unknown')
  expect((await fixture.records()).find((entry) => entry.event === 'spawn')?.cwd).toBe(fixture.root)
  const model = snapshot.models.find((entry) => entry.slug === 'fixture-cursor-small')
  expect(model?.capabilities?.optionDescriptors).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: 'context', type: 'select', currentValue: 'wide' }),
      expect.objectContaining({ id: 'fast', type: 'boolean', currentValue: false }),
    ]),
  )
  expect((await fixture.records()).some((entry) => entry.method === 'session/new')).toBe(false)
  await fixture.handle.adapter.startRuntime({
    ...fixture.input,
    modelSelection: {
      ...fixture.input.modelSelection,
      model: 'fixture-cursor-small',
      options: { reasoning: 'low', context: 'small', fast: true },
    },
  })
  expect(
    (await fixture.records())
      .filter(
        (entry) =>
          entry.method === 'session/set_model' || entry.method === 'session/set_config_option',
      )
      .map((entry) => ({ method: entry.method, params: entry.params })),
  ).toEqual([
    {
      method: 'session/set_model',
      params: { sessionId: expect.any(String), modelId: 'fixture-cursor-small' },
    },
    {
      method: 'session/set_config_option',
      params: { sessionId: expect.any(String), configId: 'reasoning', value: 'low' },
    },
    {
      method: 'session/set_config_option',
      params: { sessionId: expect.any(String), configId: 'context', value: 'small' },
    },
    {
      method: 'session/set_config_option',
      params: { sessionId: expect.any(String), configId: 'fast', value: true },
    },
  ])
})

for (const profileCase of ['default', 'config', 'override'] as const) {
  test(`Cursor ${profileCase} profile is shared by catalogue, runtime and credential watcher`, async () => {
    const configured = path.resolve('/fixture-cursor-config')
    const overridden = path.resolve('/fixture-cursor-override')
    const fixture = await createAcpFixture(cursorDriver, {
      config: profileCase === 'default' ? {} : { configHome: configured },
      environment: profileCase === 'override' ? { XDG_CONFIG_HOME: overridden } : {},
    })
    fixtures.push(fixture)
    const expected = {
      default: platformHomePath('providers', 'cursor', fixture.input.providerInstanceId),
      config: configured,
      override: overridden,
    }[profileCase]
    await fixture.handle.adapter.snapshot()
    await fixture.handle.adapter.startRuntime(fixture.input)
    const spawns = (await fixture.records()).filter((entry) => entry.event === 'spawn')
    expect(spawns).toHaveLength(2)
    expect(spawns.map((entry) => entry.profile)).toEqual([expected, expected])
    expect(cursorDriver.credentialPaths({ config: fixture.config, env: fixture.env })).toEqual([
      path.join(expected, 'cursor', 'cli-config.json'),
    ])
    await fixture.handle.adapter.stopAll()
    for (const spawn of spawns) expect(() => process.kill(spawn.pid, 0)).toThrow()
  })
}

for (const profile of [undefined, 'relative-profile']) {
  test(`Cursor refuses a ${profile === undefined ? 'missing' : 'relative'} resolved profile before spawning`, async () => {
    const fixture = await createAcpFixture(cursorDriver)
    fixtures.push(fixture)
    const env = { ...fixture.env, XDG_CONFIG_HOME: profile }
    expect(() => cursorDriver.credentialPaths({ config: fixture.config, env })).toThrow(
      'The agent profile is unavailable.',
    )
    await expect(
      cursorDriver.create({
        binaryPath: fixture.binaryPath,
        config: fixture.config,
        displayLabel: 'Cursor fixture',
        enabled: true,
        env,
        providerInstanceId: fixture.input.providerInstanceId,
        services: { cwd: fixture.root, acpOperationTimeoutMs: () => 5000 },
      }),
    ).rejects.toMatchObject({ code: 'provider-acp.PROFILE_UNAVAILABLE' })
    expect(await fixture.records()).toEqual([])
  })
}
