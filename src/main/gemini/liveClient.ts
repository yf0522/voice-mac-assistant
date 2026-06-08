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
  '你是 macOS 桌面语音助手「贾维斯」。像真人朋友一样用简短、自然的中文口语对话——' +
  '一般一句话说完，绝不长篇大论，不要复述用户的话。' +
  '理解用户语音意图：需要操作电脑时立即调用相应工具函数，拿到结果后用一句话确认（如"好了，已打开Safari"）。' +
  '普通闲聊就直接简短回答。无法执行或被安全策略拒绝时，一句话礼貌说明原因。'

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
      // 快速断句：配合 capture 的 VAD 门控（只发语音），停顿 ~300ms 即判定说完，尽快开口。
      realtimeInputConfig: {
        automaticActivityDetection: { silenceDurationMs: 300, prefixPaddingMs: 60 }
      },
      // 注：googleSearch 暂时撤掉，先排查它是否拖慢首字延迟；确认快了之后再决定是否加回。
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
