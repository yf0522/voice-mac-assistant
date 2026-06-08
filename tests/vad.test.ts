import { describe, it, expect } from 'vitest'
import { createVad } from '../src/renderer/audio/vad'

describe('energy VAD', () => {
  it('静音帧判定为非语音', () => {
    const vad = createVad({ threshold: 0.01 })
    expect(vad.process(new Float32Array(512).fill(0))).toBe(false)
  })
  it('高能量帧判定为语音', () => {
    const vad = createVad({ threshold: 0.01 })
    expect(vad.process(new Float32Array(512).fill(0.3))).toBe(true)
  })
})
