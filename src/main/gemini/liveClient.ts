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
  onTurnComplete?: () => void           // 模型本轮说完（turnComplete）
  onToolCalls: (calls: ReturnType<typeof parseServerMessage>['toolCalls']) => void
  onClose: () => void
}

const SYSTEM_INSTRUCTION =
  '你是 macOS 桌面语音助手「贾维斯」，拥有对这台电脑的最高操作权限。' +
  '像真人朋友一样用简短、自然的中文口语对话——一般一句话说完，绝不长篇大论，不要复述用户的话。' +
  '理解用户语音意图后立即行动：能用专用函数(open_app/set_volume/list_directory 等)就用；' +
  '要操控任意应用的菜单/窗口/自动化，用 run_applescript 写 AppleScript；要执行命令行操作，用 run_shell。' +
  '需要实时/事实信息时用 Google 搜索。大胆去做，不要反复请示；拿到结果后用一句话确认（如"好了，已打开Safari"）。' +
  '普通闲聊就直接简短回答。只有破坏性删除会弹确认，其余直接执行。失败时一句话说明原因。'

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
      // 手动活动检测：关掉 Gemini 自动 VAD。改由本地 VAD 明确发 activityStart/activityEnd，
      // 这样我们一停说话就立刻发 activityEnd，模型瞬间断句作答（延迟最低），
      // 也解决了「只发语音段时自动 VAD 收不到静音、永远判断不了说完」的干等问题。
      realtimeInputConfig: {
        automaticActivityDetection: { disabled: true }
      },
      // 工具：Google 搜索联网（实时/事实类问题）+ 本地动作函数
      tools: [{ googleSearch: {} }, { functionDeclarations }]
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
        if (msg?.serverContent?.turnComplete) cb.onTurnComplete?.()
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
    // 手动活动检测：本地 VAD 检测到用户开始/结束说话时调用
    startActivity() { session.sendRealtimeInput({ activityStart: {} }) },
    endActivity() { session.sendRealtimeInput({ activityEnd: {} }) },
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
