import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { collectKeptWeights, pruneWeights } from './phosphor-weight-plugin'

const DEFINITION = `import * as e from "react";
const a = /* @__PURE__ */ new Map([
  [
    "bold",
    /* @__PURE__ */ e.createElement("path", { d: "M1,1[]" })
  ],
  [
    "light",
    /* @__PURE__ */ e.createElement("path", { d: "M2,2" })
  ],
  [
    "regular",
    /* @__PURE__ */ e.createElement("path", { d: "M3,3" })
  ]
]);
export {
  a as default
};
`

test('prunes the weights nothing draws and leaves the rest byte for byte', () => {
  const pruned = pruneWeights(DEFINITION, new Set(['regular', 'bold']))
  expect(pruned).toBe(`import * as e from "react";
const a = /* @__PURE__ */ new Map([[
    "bold",
    /* @__PURE__ */ e.createElement("path", { d: "M1,1[]" })
  ],[
    "regular",
    /* @__PURE__ */ e.createElement("path", { d: "M3,3" })
  ]]);
export {
  a as default
};
`)
})

test('leaves a definition alone when every weight survives', () => {
  expect(pruneWeights(DEFINITION, new Set(['regular', 'bold', 'light']))).toBe(DEFINITION)
})

test('fails on a definition it cannot read', () => {
  expect(() => pruneWeights('export default new Map()', new Set(['regular']))).toThrow(
    'no `new Map([`',
  )
})

test('collects literal weights and keeps regular for the unset default', async () => {
  const kept = await withSources({
    'a.tsx': "<GearIcon weight='duotone' />",
    'b.tsx': '<PlusIcon weight="bold" />\n<StopIcon weight={\'fill\'} />',
    'c.ts': 'const weight = 400',
  })
  expect([...kept].sort()).toEqual(['bold', 'duotone', 'fill', 'regular'])
})

test('fails on a weight that is not a string literal', async () => {
  await expect(withSources({ 'a.tsx': '<GearIcon weight={w} />' })).rejects.toThrow(
    /a\.tsx:1 weight= is not a string literal/,
  )
})

test('fails on an IconContext provider', async () => {
  await expect(
    withSources({ 'a.tsx': "import { IconContext } from '@phosphor-icons/react'" }),
  ).rejects.toThrow(/a\.tsx:1 IconContext hides the weight/)
})

test('fails on a misspelled weight', async () => {
  await expect(withSources({ 'a.tsx': "<GearIcon weight='duetone' />" })).rejects.toThrow(
    /unknown weight 'duetone'/,
  )
})

async function withSources(files: Readonly<Record<string, string>>) {
  const root = await mkdtemp(join(tmpdir(), 'phosphor-weights-'))
  try {
    for (const [name, source] of Object.entries(files)) {
      await writeFile(join(root, name), source)
    }
    return collectKeptWeights([root])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}
