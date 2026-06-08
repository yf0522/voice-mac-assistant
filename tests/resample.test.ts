import { describe, it, expect } from 'vitest'
import { floatTo16BitPCM, downsample } from '../src/renderer/audio/resample'

describe('audio resample', () => {
  it('downsample 48k->16k 长度约为 1/3', () => {
    const input = new Float32Array(48000).fill(0.5)
    const out = downsample(input, 48000, 16000)
    expect(out.length).toBeGreaterThan(15900)
    expect(out.length).toBeLessThan(16100)
  })
  it('floatTo16BitPCM 把 1.0 映射到约 32767', () => {
    const pcm = floatTo16BitPCM(new Float32Array([1.0, -1.0, 0]))
    const view = new DataView(pcm)
    expect(view.getInt16(0, true)).toBe(32767)
    expect(view.getInt16(2, true)).toBe(-32768)
    expect(view.getInt16(4, true)).toBe(0)
  })
})
