import { describe, it, expect } from 'vitest'
import { matchesWakePhrase } from '../src/renderer/wake-match'

describe('matchesWakePhrase', () => {
  it('命中标准唤醒词「贾维斯」', () => {
    expect(matchesWakePhrase('贾维斯')).toBe(true)
  })

  it('命中嵌在句子中的「你好贾维斯」', () => {
    expect(matchesWakePhrase('你好贾维斯')).toBe(true)
  })

  it('命中常见同音误识', () => {
    for (const t of ['家维斯', '贾维司', '加维斯', '贾伟斯', '贾维师', '嘉维斯', '家伟斯']) {
      expect(matchesWakePhrase(t), `应命中: ${t}`).toBe(true)
    }
  })

  it('容忍标点与空格', () => {
    expect(matchesWakePhrase('  贾，维 斯！')).toBe(true)
    expect(matchesWakePhrase('嗯…… 你好 贾维斯。')).toBe(true)
  })

  it('不命中无关短语', () => {
    expect(matchesWakePhrase('微信')).toBe(false)
    expect(matchesWakePhrase('随便一句话')).toBe(false)
    expect(matchesWakePhrase('')).toBe(false)
    expect(matchesWakePhrase('维斯')).toBe(false) // 缺首字不命中
    expect(matchesWakePhrase('今天天气不错')).toBe(false)
  })
})
