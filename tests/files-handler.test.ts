import { describe, it, expect, vi, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import { homedir, tmpdir } from 'os'
import { join } from 'path'
import { handleFiles } from '../src/main/actions/handlers/files'
import { realRunner, type Runner } from '../src/main/actions/runner'

// 用真实 fs.realpath（沙箱校验是真实副作用），但把 readdir/mkdir/rename mock 掉，
// 避免测试真的改动文件系统。
function fsGuardRunner(): Runner {
  return {
    osascript: vi.fn(async () => ''),
    exec: vi.fn(async () => ''),
    readdir: vi.fn(async () => ['real-item']),
    mkdir: vi.fn(async () => {}),
    rename: vi.fn(async () => {}),
    realpath: realRunner.realpath // 真实解析，跟随 symlink
  }
}

const call = (name: string, args: any = {}) => ({ id: '1', name, args })

const cleanup: string[] = []
afterEach(async () => {
  while (cleanup.length) {
    const p = cleanup.pop()!
    await fs.rm(p, { force: true, recursive: false }).catch(() => {})
  }
})

describe('files handler · 真实 realpath 沙箱校验', () => {
  it('沙箱内的已存在目录（HOME 本身）→ 通过', async () => {
    const r = fsGuardRunner()
    const res = await handleFiles(call('list_directory', { path: homedir() }), r)
    expect((res as any).items).toEqual(['real-item'])
    expect(r.readdir).toHaveBeenCalledOnce()
  })

  it('指向沙箱外（/etc）的 symlink → 被拒，含「路径越出沙箱」', async () => {
    // 在 HOME 下临时建一个指向 /etc 的软链接
    const link = join(homedir(), `.voxmac-test-escape-${process.pid}-${Date.now()}`)
    await fs.symlink('/etc', link)
    cleanup.push(link)

    const r = fsGuardRunner()
    await expect(
      handleFiles(call('list_directory', { path: link }), r)
    ).rejects.toThrow('路径越出沙箱')
    // 越界时绝不应触达真实读取
    expect(r.readdir).not.toHaveBeenCalled()
  })

  it('create_folder：父目录是指向沙箱外的 symlink → 被拒', async () => {
    // 建一个指向 tmpdir（沙箱外）的软链接作为「父目录」
    const escapeParent = await fs.mkdtemp(join(tmpdir(), 'voxmac-out-'))
    cleanup.push(escapeParent)
    const link = join(homedir(), `.voxmac-test-parent-${process.pid}-${Date.now()}`)
    await fs.symlink(escapeParent, link)
    cleanup.push(link)

    const r = fsGuardRunner()
    await expect(
      handleFiles(call('create_folder', { path: link, name: 'evil' }), r)
    ).rejects.toThrow('路径越出沙箱')
    expect(r.mkdir).not.toHaveBeenCalled()
  })

  it('create_folder：父目录在沙箱内（HOME）→ 通过', async () => {
    const r = fsGuardRunner()
    const res = await handleFiles(
      call('create_folder', { path: homedir(), name: `.voxmac-mocked-${Date.now()}` }),
      r
    )
    expect((res as any).created).toContain(homedir())
    expect(r.mkdir).toHaveBeenCalledOnce()
  })
})
