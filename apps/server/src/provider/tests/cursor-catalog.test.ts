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
