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

  it('含特殊字符的 dir 被单引号安全包裹，脚本里不出现裸 $(', async () => {
    const rr = r()
    await handleDevtools(call({ tool: 'claude', project_path: "~/odd$(touch x)'dir" }), rr as any)
    const script = (rr.osascript as any).mock.calls[0][0]
    // cd 后整段路径被单引号包裹，$( 被关在单引号内（前面是 '，不是裸暴露）
    expect(script).toContain("cd '")
    // 不存在「未被单引号包裹」的命令替换：脚本里 $( 之前必有单引号
    expect(script).not.toMatch(/cd [^']*\$\(/)
  })

  it('project_path 经 realpath 越界 -> 抛错（沙箱）', async () => {
    const rr = r()
    rr.realpath = vi.fn(async () => '/etc/passwd') as any
    await expect(
      handleDevtools(call({ tool: 'claude', project_path: '~/link' }) as any, rr as any)
    ).rejects.toThrow(/沙箱/)
  })
})
