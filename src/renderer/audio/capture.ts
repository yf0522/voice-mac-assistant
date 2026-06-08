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
  node.port.onmessage = (e: MessageEvent<Float32Array>) => {
    const frame = e.data
    const speaking = vad.process(frame)
    if (speaking !== lastVad) { lastVad = speaking; onVad(speaking) }
    const pcm = floatTo16BitPCM(downsample(frame, ctx.sampleRate, 16000))
    onPcm16kBase64(arrayBufferToBase64(pcm))
  }
  src.connect(node)
  return { stop() { node.disconnect(); src.disconnect(); stream.getTracks().forEach(t => t.stop()); ctx.close() }, context: ctx }
}
