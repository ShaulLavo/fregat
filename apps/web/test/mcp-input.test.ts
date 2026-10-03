import { writeFile } from 'node:fs/promises'
import path from 'node:path'

import { withGrantedMcpClient } from '../../server/src/testing/mcp-client'
import { test, expect } from './fixtures'

test('read_file advertises the nonempty path and positive integer lines it enforces', async ({
  server,
}) => {
  await writeFile(path.join(server.root, 'lines.txt'), 'first\nsecond\nthird')
  await withGrantedMcpClient(server.root, async (client) => {
    const { tools } = await client.listTools()
    const tool = tools.find(({ name }) => name === 'read_file')
    const valid = await client.callTool({
      name: 'read_file',
      arguments: { path: 'lines.txt', startLine: 2, endLine: 2 },
    })
    expect(valid.isError).not.toBe(true)
    expect(valid.content).toEqual([{ type: 'text', text: 'second' }])
    for (const args of [
      {},
      { path: '' },
      { path: null },
      { path: 'lines.txt', startLine: 0 },
      { path: 'lines.txt', startLine: 1.5 },
      { path: 'lines.txt', startLine: '1' },
      { path: 'lines.txt', endLine: 0 },
      { path: 'lines.txt', endLine: 1.5 },
      { path: 'lines.txt', endLine: '1' },
    ]) {
      const result = await client.callTool({ name: 'read_file', arguments: args })
      expect(result.isError, JSON.stringify(args)).toBe(true)
      expect(JSON.stringify(result.content)).toContain('Input validation error')
    }
    expect(tool?.inputSchema).toMatchObject({
      type: 'object',
      required: ['path'],
      properties: {
        path: {
          type: 'string',
          minLength: 1,
          description: 'Relative to the checkout, or absolute inside it.',
        },
        startLine: { type: 'integer', minimum: 1 },
        endLine: { type: 'integer', minimum: 1 },
      },
    })
  })
})

test('read_file advertises the unknown properties its validator accepts', async ({ server }) => {
  await writeFile(path.join(server.root, 'file.txt'), 'allowed')
  await withGrantedMcpClient(server.root, async (client) => {
    const { tools } = await client.listTools()
    const tool = tools.find(({ name }) => name === 'read_file')
    const result = await client.callTool({
      name: 'read_file',
      arguments: { path: 'file.txt', extra: 123 },
    })
    expect(result.isError).not.toBe(true)
    expect(result.content).toEqual([{ type: 'text', text: 'allowed' }])
    expect(tool).toBeDefined()
    expect(tool?.inputSchema.additionalProperties).not.toBe(false)
  })
})
