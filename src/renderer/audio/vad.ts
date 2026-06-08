export function createVad(opts: { threshold: number }) {
  return {
    // 返回该帧是否包含语音（RMS 能量阈值）
    process(frame: Float32Array): boolean {
      let sum = 0
      for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i]
      const rms = Math.sqrt(sum / frame.length)
      return rms >= opts.threshold
    }
  }
}
