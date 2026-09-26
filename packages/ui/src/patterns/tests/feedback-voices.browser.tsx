import { expect, test } from 'vitest'
import { scheduleFeedbackVoice } from '../feedback-layer'

test.each(['tap', 'tick', 'tick-off', 'open', 'success', 'error', 'bell'] as const)(
  '%s produces a short band-limited voice in Chromium',
  async (voice) => {
    const context = new OfflineAudioContext(1, 12_000, 48_000)
    scheduleFeedbackVoice(context, context.destination, voice)
    const rendered = await context.startRendering()
    const samples = rendered.getChannelData(0)
    expect(samples.length).toBe(12_000)
    expect(samples.some((value) => Math.abs(value) > 0.0001)).toBe(true)
    expect(samples.slice(9600).every((value) => Math.abs(value) < 0.00001)).toBe(true)
    const peak = spectralPeak(samples.subarray(0, 2048), 48_000)
    expect(peak).toBeGreaterThan(700)
    expect(peak).toBeLessThan(5500)
  },
)

function spectralPeak(samples: Float32Array, rate: number) {
  let largest = 0
  let peak = 0
  for (let frequency = 200; frequency <= 10_000; frequency += 100) {
    const energy = spectralEnergy(samples, frequency, rate)
    if (energy <= largest) continue
    largest = energy
    peak = frequency
  }
  return peak
}

function spectralEnergy(samples: Float32Array, frequency: number, rate: number) {
  let real = 0
  let imaginary = 0
  for (let index = 0; index < samples.length; index += 1) {
    const angle = (2 * Math.PI * frequency * index) / rate
    real += samples[index]! * Math.cos(angle)
    imaginary += samples[index]! * Math.sin(angle)
  }
  return real * real + imaginary * imaginary
}
