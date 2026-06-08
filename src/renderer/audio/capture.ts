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
  // 攒到 ~100ms(16k 1600 样本) 再发一包(避免小包洪水)，且只在「用户真正说话」时上传：
  //  - 本地 VAD 门控：只发语音段，Gemini 拿到干净的「说话→停」就能快速断句(降首字延迟)；
  //  - 预卷(PREROLL)：说话前保留 300ms，开口瞬间补回开头，避免切掉首字；
  //  - 尾音兜底(HANGOVER)：说完后多送 500ms，避免切尾；
  //  - 副作用：模型说话时你不出声就不上传，回声进不去 Gemini，消除自打断。
  const CHUNK_16K = 1600
  const HANGOVER_MS = 500
  const PREROLL = 3
  let acc = new Float32Array(0)
  let speakingUntil = 0
  let wasSending = false
  const preroll: string[] = []
  node.port.onmessage = (e: MessageEvent<Float32Array>) => {
    const frame = e.data
    const speaking = vad.process(frame)
    if (speaking !== lastVad) { lastVad = speaking; onVad(speaking) }
    if (speaking) speakingUntil = Date.now() + HANGOVER_MS
    const ds = downsample(frame, ctx.sampleRate, 16000)
    const merged = new Float32Array(acc.length + ds.length)
    merged.set(acc); merged.set(ds, acc.length); acc = merged
    while (acc.length >= CHUNK_16K) {
      const b64 = arrayBufferToBase64(floatTo16BitPCM(acc.subarray(0, CHUNK_16K)))
      acc = acc.slice(CHUNK_16K)
      const sending = Date.now() < speakingUntil
      if (sending) {
        if (!wasSending) { for (const p of preroll) onPcm16kBase64(p); preroll.length = 0 } // 补回开头
        onPcm16kBase64(b64)
      } else {
        preroll.push(b64); if (preroll.length > PREROLL) preroll.shift()
      }
      wasSending = sending
    }
  }
  src.connect(node)
  return { stop() { node.disconnect(); src.disconnect(); stream.getTracks().forEach(t => t.stop()); ctx.close() }, context: ctx }
}
