/**
 * 唤醒词模糊匹配：判断一段 STT 转写文本里是否出现唤醒词「贾维斯」(jiǎ wéi sī)。
 *
 * 背景：vosk 中文小模型词典里没有「贾维斯」这个名字，会就近映射成同音常用词，
 * 实测变体有 佳木斯 / 家微丝 / 讲微丝 / 价位微丝 等——按汉字匹配根本覆盖不全。
 * 但它们的「拼音」高度一致：首音节都以 ji 开头、末音节都是 si。
 * 故改为拼音匹配：转写转拼音后，存在一个 2~4 音节滑窗，
 *   首音节 startsWith 'ji'（jiǎ/jiā/jiǎng/jià…）且末音节 === 'si'（sī/丝/思/司…）。
 * 这能命中所有观测变体，同时排除高频混淆词：
 *   加微信 = jia-wei-xin（尾 xin≠si）✗   今天天气 = jin-…（无 si）✗
 * 纯函数、无副作用，便于单测。
 */
import { pinyin } from 'pinyin-pro'

/** 去掉所有非中文字符（标点、空格、字母、数字等），仅保留汉字。 */
function normalize(text: string): string {
  return text.replace(/[^一-龥]/g, '')
}

export function matchesWakePhrase(text: string): boolean {
  if (!text) return false
  const s = normalize(text)
  if (s.length < 2) return false
  const syl = pinyin(s, { toneType: 'none', type: 'array' }) as string[]
  // 滑窗 2~4 音节：首音节以 ji 开头、末音节为 si
  for (let i = 0; i < syl.length; i++) {
    for (let len = 2; len <= 4 && i + len <= syl.length; len++) {
      const first = syl[i]
      const last = syl[i + len - 1]
      if (first.startsWith('ji') && last === 'si') return true
    }
  }
  return false
}
