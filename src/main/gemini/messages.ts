import type { ToolCall } from '@shared/types'

export interface ParsedMessage {
  audioChunks: string[]   // base64 PCM 24k
  text: string            // 助手文本（modelTurn.parts[].text + outputTranscription）
  inputTranscription?: string  // 用户语音转录（Gemini Live serverContent.inputTranscription.text）
  interrupted?: boolean        // serverContent.interrupted：模型生成被打断
  toolCalls: ToolCall[]
}

export function parseServerMessage(msg: any): ParsedMessage {
  const out: ParsedMessage = { audioChunks: [], text: '', toolCalls: [] }
  const sc = msg?.serverContent
  const parts = sc?.modelTurn?.parts ?? []
  for (const p of parts) {
    if (p?.inlineData?.data) out.audioChunks.push(p.inlineData.data)
    if (typeof p?.text === 'string') out.text += p.text
  }
  // 助手转录（若开启 outputAudioTranscription）并入 text
  const outText = sc?.outputTranscription?.text
  if (typeof outText === 'string') out.text += outText
  // 用户转录（若开启 inputAudioTranscription）
  const inText = sc?.inputTranscription?.text
  if (typeof inText === 'string' && inText.length) out.inputTranscription = inText
  // 打断标志
  if (sc?.interrupted === true) out.interrupted = true
  const calls = msg?.toolCall?.functionCalls ?? []
  for (const c of calls) {
    out.toolCalls.push({ id: c.id ?? c.name, name: c.name, args: c.args ?? {} })
  }
  return out
}
