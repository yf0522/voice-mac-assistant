import { describe, it, expect, vi } from 'vitest'
import { createExecutor } from '../src/main/actions/executor'
import type { Runner } from '../src/main/actions/runner'

function mockRunner(): Runner {
  return {
    osascript: vi.fn(async () => ''),
    exec: vi.fn(async () => ''),
    readdir: vi.fn(async () => ['a.txt', 'b.png']),
    mkdir: vi.fn(async () => {}),
    rename: vi.fn(async () => {}),
    // 默认透传：把传入路径当作其真实路径（沙箱内 ~ 展开后即落在 HOME）
    realpath: vi.fn(async (p: string) => p)
  }
}
const call = (name: string, args: any = {}) => ({ id: '1', name, args })

describe('executor', () => {
  it('open_app 调 osascript', async () => {
    const r = mockRunner(); const exec = createExecutor(r)
    const res = await exec(call('open_app', { app_name: 'Safari' }))
    expect(res.ok).toBe(true)
    expect(r.osascript).toHaveBeenCalledOnce()
  })

  it('list_directory 返回文件列表', async () => {
    const r = mockRunner(); const exec = createExecutor(r)
    const res = await exec(call('list_directory', { path: '~/Downloads' }))
    expect(res.ok).toBe(true)
    expect((res.data as any).items).toEqual(['a.txt', 'b.png'])
  })

  it('handler 抛错 -> ok:false 且带 error', async () => {
    const r = mockRunner(); (r.readdir as any).mockRejectedValueOnce(new Error('ENOENT'))
    const exec = createExecutor(r)
    const res = await exec(call('list_directory', { path: '~/none' }))
    expect(res.ok).toBe(false); expect(res.error).toContain('ENOENT')
  })

  it('未知动作 -> ok:false', async () => {
    const exec = createExecutor(mockRunner())
    const res = await exec(call('nope'))
    expect(res.ok).toBe(false)
  })
})
