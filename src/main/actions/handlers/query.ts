import type { ToolCall } from '@shared/types'
import type { Runner } from '../runner'

export async function handleQuery(call: ToolCall, _r: Runner) {
  const topic = String(call.args.topic ?? '')
  if (/time|时间|几点/.test(topic)) return { now: new Date().toLocaleTimeString('zh-CN') }
  if (/date|日期|几号/.test(topic)) return { today: new Date().toLocaleDateString('zh-CN') }
  // 其他主题交给模型自身知识回答，这里只回传 topic 让模型继续
  return { topic, note: '无本地数据，请用模型知识回答' }
}
