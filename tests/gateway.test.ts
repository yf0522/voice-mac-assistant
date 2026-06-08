import { describe, it, expect } from 'vitest'
import { homedir } from 'os'
import { classify } from '../src/main/security/gateway'

const call = (name: string, args: any = {}) => ({ id: '1', name, args })
const HOME = homedir()

describe('gateway classify', () => {
  it('绿色动作直接放行', () => {
    const d = classify(call('open_app', { app_name: 'Safari' }))
    expect(d.risk).toBe('green'); expect(d.allowed).toBe(true); expect(d.needsConfirm).toBe(false)
  })

  it('黄色动作需要确认', () => {
    const d = classify(call('move_file', { src: '~/Downloads/a', dst: '~/Documents/a' }))
    expect(d.risk).toBe('yellow'); expect(d.allowed).toBe(true); expect(d.needsConfirm).toBe(true)
  })

  it('run_shell 白名单内 -> 黄色需确认', () => {
    const d = classify(call('run_shell', { command: 'ls ~/Downloads' }))
    expect(d.risk).toBe('yellow'); expect(d.needsConfirm).toBe(true)
  })

  it('run_shell 危险命令 -> 红色拒绝', () => {
    const d = classify(call('run_shell', { command: 'rm -rf /' }))
    expect(d.risk).toBe('red'); expect(d.allowed).toBe(false)
  })

  it('run_shell sudo -> 红色拒绝', () => {
    expect(classify(call('run_shell', { command: 'sudo reboot' })).allowed).toBe(false)
  })

  it('文件动作路径越界 -> 红色拒绝', () => {
    const d = classify(call('list_directory', { path: '/etc' }))
    expect(d.risk).toBe('red'); expect(d.allowed).toBe(false)
  })

  it('文件动作含 .. 逃逸 -> 红色拒绝', () => {
    const d = classify(call('move_file', { src: '~/Downloads/../../etc/passwd', dst: '~/x' }))
    expect(d.allowed).toBe(false)
  })

  it('未知动作 -> 红色拒绝', () => {
    expect(classify(call('format_disk')).allowed).toBe(false)
  })

  // --- 边界加固（安全语义）---

  it('run_shell 命令替换 $(...) -> 红色拒绝', () => {
    const d = classify(call('run_shell', { command: 'echo $(whoami)' }))
    expect(d.risk).toBe('red'); expect(d.allowed).toBe(false)
  })

  it('run_shell 反引号命令替换 -> 红色拒绝', () => {
    const d = classify(call('run_shell', { command: 'echo `whoami`' }))
    expect(d.risk).toBe('red'); expect(d.allowed).toBe(false)
  })

  it('run_shell 重定向到系统路径 -> 红色拒绝', () => {
    const d = classify(call('run_shell', { command: 'echo x > /etc/hosts' }))
    expect(d.risk).toBe('red'); expect(d.allowed).toBe(false)
  })

  it('文件动作用绝对 HOME 子目录路径 -> 允许', () => {
    const d = classify(call('list_directory', { path: `${HOME}/Downloads` }))
    expect(d.risk).toBe('green'); expect(d.allowed).toBe(true)
  })

  it('黄色文件动作用绝对 HOME 子目录路径 -> 允许并需确认', () => {
    const d = classify(call('move_file', { src: `${HOME}/Downloads/a`, dst: `${HOME}/Documents/a` }))
    expect(d.risk).toBe('yellow'); expect(d.allowed).toBe(true); expect(d.needsConfirm).toBe(true)
  })

  it('launch_dev_tool 的 project_path 越界 -> 红色拒绝', () => {
    const d = classify(call('launch_dev_tool', { tool: 'claude', project_path: '/tmp/x' }))
    expect(d.risk).toBe('red'); expect(d.allowed).toBe(false)
  })
})
