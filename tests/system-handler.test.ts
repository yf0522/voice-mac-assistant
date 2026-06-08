import { describe, it, expect, vi } from 'vitest'
import { handleSystem } from '../src/main/actions/handlers/system'
const r = () => ({ osascript: vi.fn(async () => ''), exec: vi.fn(async () => ''), readdir: vi.fn(async()=>[]), mkdir: vi.fn(async()=>{}), rename: vi.fn(async()=>{}), realpath: vi.fn(async (p: string)=>p) })
const call = (name: string, args: any = {}) => ({ id: '1', name, args })

describe('system handler', () => {
  it('set_volume 绝对值生成 set volume 脚本', async () => {
    const rr = r(); await handleSystem(call('set_volume', { level: 50 }), rr as any)
    expect((rr.osascript as any).mock.calls[0][0]).toContain('set volume output volume 50')
  })
  it('lock_screen 调 pmset', async () => {
    const rr = r(); await handleSystem(call('lock_screen'), rr as any)
    expect(rr.exec).toHaveBeenCalledWith('pmset', ['displaysleepnow'])
  })
  it('set_dnd on 调 shortcuts', async () => {
    const rr = r(); await handleSystem(call('set_dnd', { on: true }), rr as any)
    expect(rr.exec).toHaveBeenCalled()
  })
})
