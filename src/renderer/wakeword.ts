import { PorcupineWorker } from '@picovoice/porcupine-web'
import { WebVoiceProcessor } from '@picovoice/web-voice-processor'

/**
 * 启动「贾维斯」唤醒词监听。
 * 检测到唤醒词时调用 onWake。返回 { stop } 用于释放麦克风与 worker。
 *
 * 资源依赖（需用户从 console.picovoice.ai 训练/下载并放到 src/renderer/public/）：
 *  - /jarvis.ppn               中文「贾维斯」唤醒词模型（web 平台）
 *  - /porcupine_params_zh.pv   Porcupine 中文模型参数
 */
export async function startWakeWord(
  accessKey: string,
  onWake: () => void
): Promise<{ stop: () => Promise<void> }> {
  const worker = await PorcupineWorker.create(
    accessKey,
    { label: 'jarvis', publicPath: '/jarvis.ppn' }, // 训练好的「贾维斯」唤醒词
    () => onWake(), // detectionCallback：忽略 PorcupineDetection 参数，命中即唤醒
    { publicPath: '/porcupine_params_zh.pv' } // 中文模型参数
  )
  await WebVoiceProcessor.subscribe(worker)
  return {
    async stop() {
      await WebVoiceProcessor.unsubscribe(worker)
      await worker.release()
    }
  }
}
