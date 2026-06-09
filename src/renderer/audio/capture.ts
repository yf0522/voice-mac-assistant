import { downsample, floatTo16BitPCM, arrayBufferToBase64 } from './resample'
import { createVad } from './vad'

export async function startCapture(onPcm16kBase64: (b64: string) => void, onVad: (speaking: boolean) => void) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } })
  const ctx = new AudioContext()
  await ctx.audioWorklet.addModule(new URL('./worklet-processor.js', import.meta.url))
  const src = ctx.createMediaStreamSource(stream)
  const node = new AudioWorkletNode(ctx, 'capture-processor')
  const vad = createVad({ threshold: 0.012 })
  // 攒到 ~100ms(16k 1600 样本) 再发一包；只在「用户真正说话」窗口内上传，并配合手动活动检测：
  //  - onVad(true)  在发送音频【之前】触发 → 主进程发 activityStart；
  //  - onVad(false) 在停发(含尾音兜底)后触发 → 主进程发 activityEnd → 模型立刻断句作答；
  //  - 预卷(PREROLL)：说话前保留 300ms，开口瞬间补回开头，避免切首字；
  //  - 尾音兜底(HANGOVER)：说完后多送 500ms，避免切尾；
  //  - 副作用：模型说话时你不出声就不上传，回声进不去 Gemini，消除自打断。
  const CHUNK_16K = 1600
  const HANGOVER_MS = 500
  const PREROLL = 3
  const MIN_SPEECH_MS = 220 // 需连续说话 ≥220ms 才算"开口"：滤掉咳嗽/咔哒等短促瞬态，不触发打断
  let acc = new Float32Array(0)
  let speakingUntil = 0
  let wasSending = false
  let speechRunMs = 0
  const preroll: string[] = []
  node.port.onmessage = (e: MessageEvent<Float32Array>) => {
    const frame = e.data
    const frameMs = (frame.length / ctx.sampleRate) * 1000
    if (vad.process(frame)) {
      speechRunMs += frameMs
      if (speechRunMs >= MIN_SPEECH_MS) speakingUntil = Date.now() + HANGOVER_MS // 持续够久才判定说话
    } else {
      speechRunMs = 0
    }
    const ds = downsample(frame, ctx.sampleRate, 16000)
    const merged = new Float32Array(acc.length + ds.length)
    merged.set(acc); merged.set(ds, acc.length); acc = merged
    while (acc.length >= CHUNK_16K) {
      const b64 = arrayBufferToBase64(floatTo16BitPCM(acc.subarray(0, CHUNK_16K)))
      acc = acc.slice(CHUNK_16K)
      const sending = Date.now() < speakingUntil
      if (sending && !wasSending) {
        onVad(true)                                              // activityStart（先于音频）
        for (const p of preroll) onPcm16kBase64(p); preroll.length = 0  // 补回开头
      }
      if (sending) {
        onPcm16kBase64(b64)
      } else {
        preroll.push(b64); if (preroll.length > PREROLL) preroll.shift()
      }
      if (!sending && wasSending) onVad(false)                  // activityEnd（停发后）
      wasSending = sending
    }
  }
  src.connect(node)
  return { stop() { node.disconnect(); src.disconnect(); stream.getTracks().forEach(t => t.stop()); ctx.close() }, context: ctx }
}
