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
  console.log('[gemini] connectLive: model=', CONFIG.GEMINI_MODEL, 'keyLen=', CONFIG.GEMINI_API_KEY.length)
  const ai = new GoogleGenAI({ apiKey: CONFIG.GEMINI_API_KEY })
  let msgCount = 0
  const session = await ai.live.connect({
    model: CONFIG.GEMINI_MODEL,
    config: {
      responseModalities: [Modality.AUDIO],
      systemInstruction: SYSTEM_INSTRUCTION,
      // 关掉"思考"：native-audio 模型默认会先生成一大段推理才开口，导致回复慢、不像真人对话。
      // thinkingBudget=0 让它立即作答，逼近 speech-to-speech 的低延迟。
      thinkingConfig: { thinkingBudget: 0 },
      // 纯 speech-to-speech：不开转录（用户不需要把语音转成文字旁路）
      tools: [{ functionDeclarations }]
    },
    callbacks: {
      onopen: () => console.log('[gemini] websocket onopen ✓'),
      onmessage: (msg: any) => {
        msgCount++
        // 调试：打印每条消息的结构摘要，看模型到底回了什么
        const sc = msg?.serverContent
        const summary = {
          keys: Object.keys(msg ?? {}),
          sc: sc ? Object.keys(sc) : undefined,
          parts: sc?.modelTurn?.parts?.map((p: any) => p.inlineData ? `audio:${p.inlineData.mimeType}` : p.text ? `text:${p.text}` : Object.keys(p)),
          turnComplete: sc?.turnComplete,
          interrupted: sc?.interrupted,
          generationComplete: sc?.generationComplete,
          toolCall: msg?.toolCall ? msg.toolCall.functionCalls?.map((c: any) => c.name) : undefined
        }
        console.log(`[gemini] msg#${msgCount}:`, JSON.stringify(summary))
        const p = parseServerMessage(msg)
        if (p.audioChunks.length) p.audioChunks.forEach(cb.onAudio)
        if (p.text) cb.onText(p.text)
        if (p.inputTranscription) cb.onUserText?.(p.inputTranscription)
        if (p.interrupted) cb.onInterrupted?.()
        if (p.toolCalls.length) cb.onToolCalls(p.toolCalls)
      },
      onerror: (e: any) => console.error('[gemini] onerror', e?.message ?? e, e?.code ?? '', e?.reason ?? ''),
      onclose: (e: any) => { console.log('[gemini] onclose', e?.code ?? '', e?.reason ?? ''); cb.onClose() }
    }
  })
  console.log('[gemini] ai.live.connect 已返回 session')

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
