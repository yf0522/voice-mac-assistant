import { describe, it, expect } from 'vitest'
import { matchesWakePhrase } from '../src/renderer/wake-match'

describe('matchesWakePhrase（拼音 ji…si 匹配）', () => {
  it('命中标准唤醒词「贾维斯」', () => {
    expect(matchesWakePhrase('贾维斯')).toBe(true)
  })

  it('命中嵌在句子中的「你好贾维斯」', () => {
    expect(matchesWakePhrase('你好贾维斯')).toBe(true)
  })

  it('命中 vosk 小模型实测的同音变体', () => {
    // 这些是真机日志里 vosk 把「贾维斯」听成的实际文本
    for (const t of ['佳木斯', '家微丝', '讲微丝', '价位微丝', '家维斯', '贾维司', '加维斯']) {
      expect(matchesWakePhrase(t), `应命中: ${t}`).toBe(true)
    }
  })

  it('容忍标点与空格', () => {
    expect(matchesWakePhrase('  贾，维 斯！')).toBe(true)
    expect(matchesWakePhrase('家 微丝')).toBe(true) // vosk 常输出带空格
    expect(matchesWakePhrase('嗯…… 你好 贾维斯。')).toBe(true)
  })

  it('不命中高频混淆词与无关短语', () => {
    expect(matchesWakePhrase('加微信'), '加微信 尾音 xin≠si').toBe(false)
    expect(matchesWakePhrase('今天天气怎么样'), '首音节非 ji 开头').toBe(false)
    expect(matchesWakePhrase('较为'), '尾非 si').toBe(false)
    expect(matchesWakePhrase('价位'), '尾非 si').toBe(false)
    expect(matchesWakePhrase('微信')).toBe(false)
    expect(matchesWakePhrase('随便一句话')).toBe(false)
    expect(matchesWakePhrase('')).toBe(false)
  })
})
