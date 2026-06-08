import { downsample, floatTo16BitPCM, arrayBufferToBase64 } from './resample'
import { createVad } from './vad'

export async function startCapture(onPcm16kBase64: (b64: string) => void, onVad: (speaking: boolean) => void) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } })
  const ctx = new AudioContext()
  await ctx.audioWorklet.addModule(new URL('./worklet-processor.js', import.meta.url))
  const src = ctx.createMediaStreamSource(stream)
  const node = new AudioWorkletNode(ctx, 'capture-processor')
  const vad = createVad({ threshold: 0.012 })
  let lastVad = false
  // 关键：worklet 每 128 样本(~2.7ms)给一帧，若每帧都发一条 WS 消息 = 每秒 ~370 条小包，
  // 经代理会严重积压导致十几秒延迟。改为攒到 ~100ms(16k 下 1600 样本) 再发一包，约 10 条/秒。
  const CHUNK_16K = 1600
  let acc = new Float32Array(0)
  node.port.onmessage = (e: MessageEvent<Float32Array>) => {
    const frame = e.data
    const speaking = vad.process(frame)
    if (speaking !== lastVad) { lastVad = speaking; onVad(speaking) }
    const ds = downsample(frame, ctx.sampleRate, 16000)
    const merged = new Float32Array(acc.length + ds.length)
    merged.set(acc); merged.set(ds, acc.length); acc = merged
    while (acc.length >= CHUNK_16K) {
      const chunk = acc.subarray(0, CHUNK_16K)
      onPcm16kBase64(arrayBufferToBase64(floatTo16BitPCM(chunk)))
      acc = acc.slice(CHUNK_16K)
    }
  }
  src.connect(node)
  return { stop() { node.disconnect(); src.disconnect(); stream.getTracks().forEach(t => t.stop()); ctx.close() }, context: ctx }
}
