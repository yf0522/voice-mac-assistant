import { describe, it, expect, vi } from 'vitest'
import { handleDevtools } from '../src/main/actions/handlers/devtools'
const r = () => ({ osascript: vi.fn(async () => ''), exec: vi.fn(async () => ''), readdir: vi.fn(async()=>[]), mkdir: vi.fn(async()=>{}), rename: vi.fn(async()=>{}), realpath: vi.fn(async (p: string)=>p) })
const call = (args: any) => ({ id: '1', name: 'launch_dev_tool', args })

describe('devtools handler', () => {
  it('claude: 生成 cd 项目并执行 claude 的 AppleScript', async () => {
    const rr = r(); await handleDevtools(call({ tool: 'claude', project_path: '~/workSpace/glyph' }), rr as any)
    const script = (rr.osascript as any).mock.calls[0][0]
    expect(script).toContain('iTerm')
    expect(script).toContain('cd ')
    expect(script).toContain('claude')
  })
  it('code: 用 code . 打开', async () => {
    const rr = r(); await handleDevtools(call({ tool: 'code', project_path: '~/workSpace/glyph' }), rr as any)
    expect((rr.osascript as any).mock.calls[0][0]).toContain('code .')
  })
  it('未知 tool 抛错', async () => {
    await expect(handleDevtools(call({ tool: 'vim' }) as any, r() as any)).rejects.toThrow()
  })
})
