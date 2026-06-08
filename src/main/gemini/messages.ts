import type { ToolCall } from '@shared/types'

export interface ParsedMessage {
  audioChunks: string[]   // base64 PCM 24k
  text: string
  toolCalls: ToolCall[]
}

export function parseServerMessage(msg: any): ParsedMessage {
  const out: ParsedMessage = { audioChunks: [], text: '', toolCalls: [] }
  const parts = msg?.serverContent?.modelTurn?.parts ?? []
  for (const p of parts) {
    if (p?.inlineData?.data) out.audioChunks.push(p.inlineData.data)
    if (typeof p?.text === 'string') out.text += p.text
  }
  const calls = msg?.toolCall?.functionCalls ?? []
  for (const c of calls) {
    out.toolCalls.push({ id: c.id ?? c.name, name: c.name, args: c.args ?? {} })
  }
  return out
}
