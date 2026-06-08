import { describe, it, expect } from 'vitest'
import { handleQuery } from '../src/main/actions/handlers/query'
const call = (topic: string) => ({ id: '1', name: 'query_info', args: { topic } })

describe('query handler', () => {
  it('time 返回当前时间字符串', async () => {
    const res: any = await handleQuery(call('time') as any, {} as any)
    expect(typeof res.now).toBe('string')
  })
  it('未知 topic 返回 echo', async () => {
    const res: any = await handleQuery(call('天气') as any, {} as any)
    expect(res.topic).toBe('天气')
  })
})
