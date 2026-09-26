import { expect, test } from 'vitest'

test('importing push services leaves the optional transport unloaded', async () => {
  const service = new URL('../service.ts', import.meta.url).pathname
  const child = Bun.spawn(
    [
      process.execPath,
      '-e',
      `
    await import(${JSON.stringify(service)});
    console.log(JSON.stringify(Object.keys(require.cache).filter(file => file.includes('/web-push/'))));
  `,
    ],
    { stdout: 'pipe', stderr: 'pipe' },
  )
  const output = await new Response(child.stdout).text()
  expect(await child.exited).toBe(0)
  expect(JSON.parse(output)).toEqual([])
})
