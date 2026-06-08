import { GoogleGenAI, Modality } from '@google/genai'
import { CONFIG } from '../config'
import { functionDeclarations } from '@shared/tools'
import { parseServerMessage } from './messages'
import type { ToolResult } from '@shared/types'

export interface LiveCallbacks {
  onAudio: (base64pcm24k: string) => void
  onText: (text: string) => void
  onUserText?: (text: string) => void   // 用户语音转录（inputTranscription）
  onInterrupted?: () => void            // 模型生成被打断（interrupted）
  onToolCalls: (calls: ReturnType<typeof parseServerMessage>['toolCalls']) => void
  onClose: () => void
}

const SYSTEM_INSTRUCTION =
  '你是 macOS 桌面语音助手「贾维斯」。理解用户的中文语音意图，需要操作电脑时调用相应工具函数；' +
  '收到工具结果后用简短自然的中文口语反馈。无法执行或被安全策略拒绝时，礼貌说明原因。'

export async function connectLive(cb: LiveCallbacks) {
  const ai = new GoogleGenAI({ apiKey: CONFIG.GEMINI_API_KEY })
  const session = await ai.live.connect({
    model: CONFIG.GEMINI_MODEL,
    config: {
      responseModalities: [Modality.AUDIO],
      systemInstruction: SYSTEM_INSTRUCTION,
      // 开启用户语音转录，服务端才会回 serverContent.inputTranscription
      inputAudioTranscription: {},
      tools: [{ functionDeclarations }]
    },
    callbacks: {
      onmessage: (msg) => {
        const p = parseServerMessage(msg)
        if (p.audioChunks.length) p.audioChunks.forEach(cb.onAudio)
        if (p.text) cb.onText(p.text)
        if (p.inputTranscription) cb.onUserText?.(p.inputTranscription)
        if (p.interrupted) cb.onInterrupted?.()
        if (p.toolCalls.length) cb.onToolCalls(p.toolCalls)
      },
      onerror: (e) => console.error('[gemini] error', e),
      onclose: () => cb.onClose()
    }
  })

  return {
    // 16kHz PCM base64 实时上传
    sendAudio(base64pcm16k: string) {
      session.sendRealtimeInput({ audio: { data: base64pcm16k, mimeType: 'audio/pcm;rate=16000' } })
    },
    sendToolResponses(results: ToolResult[]) {
      session.sendToolResponse({
        functionResponses: results.map(r => ({
          id: r.id,
          name: r.name,
          response: r.ok ? { ok: true, ...((r.data as object) ?? {}) } : { ok: false, error: r.error }
        }))
      })
    },
    close() { session.close() }
  }
}
