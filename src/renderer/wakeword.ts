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
const MODEL_URL = '/vosk-model-cn.tar.gz'
const RECOGNIZER_SAMPLE_RATE = 16000
// 命中后去抖窗口：避免一次说话连续触发多次唤醒。
const DEBOUNCE_MS = 2500

export async function startWakeWord(
  onWake: () => void
): Promise<{ stop: () => Promise<void> }> {
  const model = await createModel(MODEL_URL)
  const recognizer = new model.KaldiRecognizer(RECOGNIZER_SAMPLE_RATE)

  let lastWake = 0
  const fire = (text: string) => {
    if (!text || !matchesWakePhrase(text)) return
    const now = Date.now()
    if (now - lastWake < DEBOUNCE_MS) return
    lastWake = now
    onWake()
  }
  // 最终结果：result.result.text；部分结果：result.result.partial
  recognizer.on('result', (m: any) => fire(m?.result?.text ?? ''))
  recognizer.on('partialresult', (m: any) => fire(m?.result?.partial ?? ''))

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }
  })
  const ctx = new AudioContext()
  await ctx.audioWorklet.addModule(new URL('./audio/worklet-processor.js', import.meta.url))
  const src = ctx.createMediaStreamSource(stream)
  const node = new AudioWorkletNode(ctx, 'capture-processor')
  // worklet 以原始采样率推送 Float32 帧；recognizer 用 acceptWaveformFloat
  // 重采样到自身的 16kHz（vosk 内部按传入 sampleRate 处理）。
  node.port.onmessage = (e: MessageEvent<Float32Array>) => {
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
