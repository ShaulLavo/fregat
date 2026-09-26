import { readFile, writeFile } from 'node:fs/promises'

type Spring = readonly [stiffness: number, damping: number, mass: number]

// seamui's four personalities (MIT); CSS samples the same damped oscillator.
export const personalities = {
  seam: {
    press: [600, 40, 0.5],
    snappy: [420, 30, 0.7],
    surface: [320, 28, 0.9],
    bouncy: [380, 18, 0.9],
  },
  brisk: {
    press: [800, 50, 0.4],
    snappy: [560, 40, 0.55],
    surface: [440, 38, 0.7],
    bouncy: [500, 26, 0.7],
  },
  relaxed: {
    press: [420, 36, 0.7],
    snappy: [280, 28, 0.9],
    surface: [220, 26, 1.1],
    bouncy: [260, 18, 1],
  },
  playful: {
    press: [620, 30, 0.5],
    snappy: [420, 20, 0.8],
    surface: [340, 18, 0.9],
    bouncy: [400, 12, 1],
  },
} satisfies Record<string, Record<string, Spring>>

export function springPosition([stiffness, damping, mass]: Spring, seconds: number): number {
  const decay = damping / (2 * mass)
  const frequencySquared = stiffness / mass
  const discriminant = frequencySquared - decay * decay
  if (Math.abs(discriminant) < 1e-8) return 1 - (1 + decay * seconds) * Math.exp(-decay * seconds)
  if (discriminant > 0) {
    const frequency = Math.sqrt(discriminant)
    return (
      1 -
      Math.exp(-decay * seconds) *
        (Math.cos(frequency * seconds) + (decay / frequency) * Math.sin(frequency * seconds))
    )
  }
  const root = Math.sqrt(-discriminant)
  const slow = -decay + root
  const fast = -decay - root
  return 1 + (fast * Math.exp(slow * seconds) - slow * Math.exp(fast * seconds)) / (slow - fast)
}

export function springCurve(spring: Spring) {
  // Scan past all extrema, then use the last excursion outside the settling tolerance.
  let duration = 0
  for (let ms = 0; ms <= 10_000; ms += 1) {
    if (Math.abs(1 - springPosition(spring, ms / 1000)) > 0.001) duration = ms + 1
  }
  const count = Math.ceil(duration / 8)
  const samples = Array.from({ length: count + 1 }, (_, index) =>
    Number(springPosition(spring, (duration * index) / count / 1000).toFixed(5)),
  )
  samples[0] = 0
  samples[count] = 1
  return { duration, samples, easing: `linear(${samples.join(', ')})` }
}

function generatedSprings() {
  return Object.entries(personalities)
    .map(([name, springs]) => {
      const tokens = Object.entries(springs).flatMap(([role, spring]) => {
        const curve = springCurve(spring)
        return [
          `  --spring-${role}: linear(\n${curve.samples.map((sample) => `    ${sample}`).join(',\n')}\n  );`,
          `  --spring-${role}-duration: ${curve.duration}ms;`,
        ]
      })
      return `:root[data-feel='${name}'] {\n${tokens.join('\n')}\n}`
    })
    .join('\n\n')
}

export async function updateSpringTokens(check = false) {
  const path = new URL('../packages/ui/src/styles/globals.css', import.meta.url)
  const source = await readFile(path, 'utf8')
  const start = '/* BEGIN GENERATED SPRINGS */'
  const end = '/* END GENERATED SPRINGS */'
  const generated = `${start}\n${generatedSprings()}\n${end}`
  const next = source.replace(
    new RegExp(`${start.replaceAll('*', '\\*')}[\\s\\S]*?${end.replaceAll('*', '\\*')}`),
    generated,
  )
  if (check) return next === source && source.includes(start)
  await writeFile(path, next)
  return true
}

if (import.meta.main) {
  const valid = await updateSpringTokens(process.argv.includes('--check'))
  if (!valid) process.exitCode = 1
}
