/**
 * Renders the Fregat icon set from `apps/web/public/icons/fregat.svg`, the hand-checked master.
 * The manifest icons and `fregat.icns` keep its squircle on Apple's 1024 grid; the touch and maskable
 * icons fill the square with the squircle's colour, because iOS and Android apply their own mask.
 * The browser favicon is the bare mark, recoloured for light tabs where the master's gold fades.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import sharp from 'sharp'

import { createScriptError } from '../structured-errors'

const root = path.resolve(import.meta.dirname, '../..')
const dir = path.join(root, 'apps/web/public/icons')
const master = readFileSync(path.join(dir, 'fregat.svg'), 'utf8')

// Apple's grid draws the squircle 824 wide on a 1024 canvas.
const GRID_BODY = 824 / 1024

// Rosé Pine Dawn's rose and gold: the master's pale rose drops to 1.7:1 on a white tab strip.
const LIGHT_TAB = { body: '#d7827e', flame: '#ea9d34' }

// PNG-backed icns entries macOS reads; the @2x types reuse the next size up.
const ICNS_ENTRIES = [
  ['icp4', 16],
  ['icp5', 32],
  ['icp6', 64],
  ['ic07', 128],
  ['ic08', 256],
  ['ic09', 512],
  ['ic10', 1024],
  ['ic11', 32],
  ['ic12', 64],
  ['ic13', 256],
  ['ic14', 512],
] as const

function fullBleed(svg: string, markScale: number) {
  const shape = /<path id="shape" fill="(#[0-9a-f]{6})" d="[^"]*"\/>/.exec(svg)
  if (!shape) throw createScriptError('fregat.svg has no <path id="shape" fill="#rrggbb">')
  const mark = markOnly(svg)
  return svg
    .replace(shape[0], `<rect width="1024" height="1024" fill="${shape[1]}"/>`)
    .replace(
      mark,
      `<g transform="translate(512 512) scale(${markScale}) translate(-512 -512)">${mark}</g>`,
    )
}

function markOnly(svg: string) {
  const mark = /<g id="mark"[\s\S]*?<\/g>/.exec(svg)
  if (!mark) throw createScriptError('fregat.svg has no <g id="mark">')
  return mark[0]
}

// The mark's square bounds in master units, so the favicon spends its 16px on the rocket.
async function markBounds(mark: string) {
  const size = 1024
  const { data, info } = await sharp(
    Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">${mark}</svg>`),
  )
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  let [left, top, right, bottom] = [size, size, 0, 0]
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (!data[(y * info.width + x) * info.channels + 3]) continue
      left = Math.min(left, x)
      top = Math.min(top, y)
      right = Math.max(right, x + 1)
      bottom = Math.max(bottom, y + 1)
    }
  }
  if (right <= left) throw createScriptError('fregat.svg mark renders no pixels')
  const side = Math.max(right - left, bottom - top) * 1.04
  const cx = (left + right) / 2
  const cy = (top + bottom) / 2
  return [cx - side / 2, cy - side / 2, side, side].map((value) => Math.round(value)).join(' ')
}

async function favicon(svg: string) {
  const mark = markOnly(svg)
  const bodyFill = /id="body" fill="(#[0-9a-f]{6})"/.exec(mark)?.[1]
  const flameFill = /id="flame" fill="(#[0-9a-f]{6})"/.exec(mark)?.[1]
  if (!bodyFill || !flameFill)
    throw createScriptError('fregat.svg mark needs <path id="body"> and <path id="flame"> fills')
  const style =
    `#body{fill:${LIGHT_TAB.body}}#flame{fill:${LIGHT_TAB.flame}}` +
    `@media (prefers-color-scheme:dark){#body{fill:${bodyFill}}#flame{fill:${flameFill}}}`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${await markBounds(mark)}"><style>${style}</style>${mark}</svg>\n`
}

function render(svg: string, size: number) {
  return sharp(Buffer.from(svg), { density: (72 * size) / 1024 })
    .resize(size, size)
    .png()
    .toBuffer()
}

function icns(pngs: ReadonlyMap<number, Buffer>) {
  const chunks = ICNS_ENTRIES.map(([type, size]) => {
    const png = pngs.get(size)
    if (!png) throw createScriptError(`No ${size}px render for icns entry ${type}`)
    const header = Buffer.alloc(8)
    header.write(type, 0, 'ascii')
    header.writeUInt32BE(png.length + 8, 4)
    return Buffer.concat([header, png])
  })
  const header = Buffer.alloc(8)
  header.write('icns', 0, 'ascii')
  header.writeUInt32BE(8 + chunks.reduce((total, chunk) => total + chunk.length, 0), 4)
  return Buffer.concat([header, ...chunks])
}

function write(file: string, data: Buffer) {
  writeFileSync(file, data)
  console.log(`${path.relative(root, file)} ${data.length} bytes`)
}

async function main() {
  const sizes = [...new Set(ICNS_ENTRIES.map(([, size]) => size))]
  const pngs = new Map(
    await Promise.all(sizes.map(async (size) => [size, await render(master, size)] as const)),
  )
  const outputs: ReadonlyArray<readonly [string, Buffer]> = [
    ['icon-192.png', await render(master, 192)],
    ['icon-512.png', pngs.get(512)!],
    // The maskable safe zone is the centre 80% circle, which already holds the mark at grid scale.
    ['icon-maskable-512.png', await render(fullBleed(master, 1), 512)],
    ['apple-touch-icon.png', await render(fullBleed(master, 1 / GRID_BODY), 180)],
    ['fregat.icns', icns(pngs)],
  ]
  for (const [name, data] of outputs) write(path.join(dir, name), data)
  const tabIcon = Buffer.from(await favicon(master))
  write(path.join(dir, 'fregat-favicon.svg'), tabIcon)
  write(path.join(root, 'apps/site/public/favicon.svg'), tabIcon)
}

await main()
