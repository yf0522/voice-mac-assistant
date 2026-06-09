import { describe, it, expect } from 'vitest'
import { classify } from '../src/main/security/gateway'

const call = (name: string, args: any = {}) => ({ id: '1', name, args })

describe('gateway classify（放权策略：仅破坏性命令需确认）', () => {
  it('普通动作直接执行、无需确认', () => {
    for (const n of ['open_app', 'quit_app', 'set_volume', 'lock_screen', 'list_directory',
                     'create_folder', 'move_file', 'rename_file', 'launch_dev_tool', 'query_info', 'run_applescript']) {
      const d = classify(call(n))
      expect(d.allowed, n).toBe(true)
      expect(d.needsConfirm, n).toBe(false)
      expect(d.risk, n).toBe('green')
    }
  })

  it('run_shell 普通命令直接执行', () => {
    for (const c of ['ls ~/Downloads', 'echo hi', 'open .', 'mkdir test', 'git status', 'curl example.com']) {
      const d = classify(call('run_shell', { command: c }))
      expect(d.allowed, c).toBe(true)
      expect(d.needsConfirm, c).toBe(false)
    }
  })

  it('破坏性命令需确认（不直接拒）', () => {
    for (const c of ['rm -rf /', 'rm -rf ~/Downloads', 'rm -r foo', 'rm -f bar',
                     'sudo rm -rf /', 'mkfs.ext4 /dev/disk2', 'dd if=/dev/zero of=/dev/disk2',
                     'diskutil erase disk2', 'shutdown -h now', 'reboot']) {
      const d = classify(call('run_shell', { command: c }))
      expect(d.allowed, c).toBe(true)        // 允许但需确认
      expect(d.needsConfirm, c).toBe(true)
      expect(d.risk, c).toBe('yellow')
    }
  })

  it('未知动作拒绝', () => {
    const d = classify(call('format_disk'))
    expect(d.allowed).toBe(false)
    expect(d.risk).toBe('red')
  })
})
