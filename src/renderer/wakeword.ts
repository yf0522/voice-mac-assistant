import { createModel } from 'vosk-browser'
import { matchesWakePhrase } from './wake-match'

/**
 * 启动「贾维斯」唤醒词监听（完全本地离线，零账号零 key）。
 *
 * 基于 vosk-browser（WASM Kaldi），在渲染进程内持续做中文 STT，
 * 对部分/最终结果文本调用 matchesWakePhrase，命中即 onWake()。
 *
 * 资源依赖：中文小模型打包成 gzipped tar 放在
 *   src/renderer/public/vosk-model-cn.tar.gz  ->  /vosk-model-cn.tar.gz
 * 用 `bash scripts/fetch-model.sh` 生成。
 *
 * 返回 { stop } 用于释放麦克风、AudioContext 与模型 worker。
 */
// 基于当前页面地址解析为绝对 URL：dev 下是 http://localhost:5173/...，
// 构建版是 file://.../out/renderer/...，两者 vosk worker 都能 fetch（绝对 / 在 file:// 下会指向磁盘根，故用 location 基准）。
const MODEL_URL = new URL('vosk-model-cn.tar.gz', location.href).href
const RECOGNIZER_SAMPLE_RATE = 16000
// 命中后去抖窗口：避免一次说话连续触发多次唤醒。
const DEBOUNCE_MS = 2500

export async function startWakeWord(
  onWake: () => void
): Promise<{ stop: () => Promise<void> }> {
  console.log('[wakeword] 开始加载模型:', MODEL_URL)
  const model = await createModel(MODEL_URL)
  const recognizer = new model.KaldiRecognizer(RECOGNIZER_SAMPLE_RATE)

  let lastWake = 0
  console.log('[wakeword] vosk 模型已加载, recognizer sampleRate=', RECOGNIZER_SAMPLE_RATE)
  const fire = (text: string, kind: string) => {
    if (!text) return
    const matched = matchesWakePhrase(text)
    console.log(`[wakeword] ${kind}: "${text}" -> ${matched ? '✅命中' : '未命中'}`)
    if (!matched) return
    const now = Date.now()
    if (now - lastWake < DEBOUNCE_MS) return
    lastWake = now
    onWake()
  }
  // 最终结果：result.result.text；部分结果：result.result.partial
  recognizer.on('result', (m: any) => fire(m?.result?.text ?? '', 'final'))
  recognizer.on('partialresult', (m: any) => fire(m?.result?.partial ?? '', 'partial'))

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }
  })
  const ctx = new AudioContext()
  await ctx.audioWorklet.addModule(new URL('./audio/worklet-processor.js', import.meta.url))
  const src = ctx.createMediaStreamSource(stream)
  const node = new AudioWorkletNode(ctx, 'capture-processor')
  // worklet 以原始采样率推送 Float32 帧；recognizer 用 acceptWaveformFloat
  // 重采样到自身的 16kHz（vosk 内部按传入 sampleRate 处理）。
  let frameCount = 0
  node.port.onmessage = (e: MessageEvent<Float32Array>) => {
    if (frameCount === 0) console.log('[wakeword] 开始收到麦克风音频帧, 长度=', e.data.length, 'ctx.sampleRate=', ctx.sampleRate)
    frameCount++
    try {
      recognizer.acceptWaveformFloat(e.data, ctx.sampleRate)
    } catch (err) {
      console.error('[wakeword] acceptWaveformFloat 失败', err)
    }
  }
  src.connect(node)

  return {
    async stop() {
      node.port.onmessage = null
      node.disconnect()
      src.disconnect()
      stream.getTracks().forEach((t) => t.stop())
      await ctx.close()
      recognizer.remove()
      model.terminate()
    }
  }
}
