// Glyphs a still-noisy piece shows in place of its text.
const GLYPHS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789{}[]()<>/\\|=+-*&^%$#@!?;:.'

/** Deterministic pseudo-random in [0, 1) from a seed (classic sine hash). */
export function hash01(seed: number): number {
  const x = Math.sin(seed) * 43758.5453
  return x - Math.floor(x)
}

/** `text` with every visible character replaced by a seeded random glyph, so columns stay put. */
export function scramble(text: string, seed: number): string {
  let out = ''
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? ''
    if (char.trim().length === 0) {
      out += char
      continue
    }
    out += GLYPHS[Math.floor(hash01(seed * 1000.7 + index * 12.99) * GLYPHS.length)] ?? '#'
  }
  return out
}

// Two-octave value noise in ~[0, 1): smooth over space, so nearby points get
// similar values and resolve as clusters.
export function spatialNoise(x: number, y: number): number {
  return 0.65 * valueNoise(x, y) + 0.35 * valueNoise(x * 2 + 5.2, y * 2 + 1.3)
}

function valueNoise(x: number, y: number): number {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const tx = smoothstep(x - x0)
  const ty = smoothstep(y - y0)
  const top = lerp(latticeRandom(x0, y0), latticeRandom(x0 + 1, y0), tx)
  const bottom = lerp(latticeRandom(x0, y0 + 1), latticeRandom(x0 + 1, y0 + 1), tx)
  return lerp(top, bottom, ty)
}

function latticeRandom(ix: number, iy: number): number {
  return hash01(ix * 127.1 + iy * 311.7 + 0.7)
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t)
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}
