// 线性插值下采样
export function downsample(input: Float32Array, inRate: number, outRate: number): Float32Array {
  if (outRate === inRate) return input
  const ratio = inRate / outRate
  const outLen = Math.round(input.length / ratio)
  const out = new Float32Array(outLen)
  for (let i = 0; i < outLen; i++) {
    const idx = i * ratio
    const lo = Math.floor(idx), hi = Math.min(lo + 1, input.length - 1)
    out[i] = input[lo] + (input[hi] - input[lo]) * (idx - lo)
  }
  return out
}

export function floatTo16BitPCM(input: Float32Array): ArrayBuffer {
  const buf = new ArrayBuffer(input.length * 2)
  const view = new DataView(buf)
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]))
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return buf
}

export function arrayBufferToBase64(buf: ArrayBuffer): string {
  let bin = ''
  const bytes = new Uint8Array(buf)
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}
