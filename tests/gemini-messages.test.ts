import { describe, it, expect } from 'vitest'
import { parseServerMessage } from '../src/main/gemini/messages'

describe('parseServerMessage', () => {
  it('提取音频 inlineData', () => {
    const msg = { serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm', data: 'AAAA' } }] } } }
    const out = parseServerMessage(msg)
    expect(out.audioChunks).toEqual(['AAAA'])
  })
  it('提取文本转录', () => {
    const msg = { serverContent: { modelTurn: { parts: [{ text: '你好' }] } } }
    expect(parseServerMessage(msg).text).toBe('你好')
  })
  it('提取 toolCall functionCalls', () => {
    const msg = { toolCall: { functionCalls: [{ id: 'x1', name: 'open_app', args: { app_name: 'Safari' } }] } }
    const out = parseServerMessage(msg)
    expect(out.toolCalls).toHaveLength(1)
    expect(out.toolCalls[0]).toMatchObject({ id: 'x1', name: 'open_app', args: { app_name: 'Safari' } })
  })
  it('空消息返回空结构', () => {
    const out = parseServerMessage({})
    expect(out.audioChunks).toEqual([]); expect(out.text).toBe(''); expect(out.toolCalls).toEqual([])
  })
})
