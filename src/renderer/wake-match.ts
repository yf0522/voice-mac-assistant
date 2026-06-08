/**
 * 唤醒词模糊匹配：判断一段 STT 转写文本里是否出现唤醒词「贾维斯」。
 *
 * vosk 中文小模型对短词容易同音误识，故采用启发式：
 *   归一化（去标点/空格）后，文本中存在「<首字><中字><尾字>」三字相邻片段，
 *   其中首字 ∈ 贾家加嘉，中字 ∈ 维伟为위唯,尾字 ∈ 斯司师思丝。
 * 纯字符串处理、无副作用，便于单测。
 */

// 候选近音字集合（贾/维/斯 各自的常见误识同音字）
const HEAD = new Set(['贾', '家', '加', '嘉'])
const MID = new Set(['维', '伟', '为', '唯', '惟'])
const TAIL = new Set(['斯', '司', '师', '思', '丝'])

/** 去掉所有非中文字符（标点、空格、字母、数字等），仅保留汉字。 */
function normalize(text: string): string {
  return text.replace(/[^一-鿿]/g, '')
}

export function matchesWakePhrase(text: string): boolean {
  if (!text) return false
  const s = normalize(text)
  // 需要连续三字「首-中-尾」均落在各自候选集合内
  for (let i = 0; i + 2 < s.length; i++) {
    if (HEAD.has(s[i]) && MID.has(s[i + 1]) && TAIL.has(s[i + 2])) return true
  }
  return false
}
