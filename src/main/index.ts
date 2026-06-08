import { app, BrowserWindow, systemPreferences, session } from 'electron'
import { join } from 'path'
import { appendFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { createOrchestrator } from './orchestrator'
import { on } from './ipc'
import { IPC } from '@shared/types'

const MIC_PERMS = new Set(['media', 'audioCapture', 'microphone'])

// 调试：把渲染进程 console 落盘到 ~/voxmac-debug.log，方便排查（构建版无 DevTools）
const DEBUG_LOG = join(homedir(), 'voxmac-debug.log')

// 把主进程 console 也 tee 到日志文件（open 启动时主进程 stdout 脱离终端，否则看不到）
function teeMainConsole(): void {
  const tee = (orig: (...a: any[]) => void, tag: string) => (...args: any[]) => {
    orig(...args)
    try {
      const line = args.map(a => (a instanceof Error ? (a.stack ?? a.message) : typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')
      appendFileSync(DEBUG_LOG, `[main:${tag}] ${line}\n`)
    } catch { /* ignore */ }
  }
  console.log = tee(console.log.bind(console), 'log')
  console.error = tee(console.error.bind(console), 'err')
  console.warn = tee(console.warn.bind(console), 'warn')
}
function attachConsoleLog(win: BrowserWindow): void {
  try { writeFileSync(DEBUG_LOG, `=== VoxMac 启动 ${new Date().toISOString()} ===\n`) } catch { /* ignore */ }
  win.webContents.on('console-message', (...args: unknown[]) => {
    const a0 = args[0] as { message?: string } | undefined
    const message = a0 && typeof a0 === 'object' && 'message' in a0 ? a0.message : (args[2] as string)
    try { appendFileSync(DEBUG_LOG, String(message) + '\n') } catch { /* ignore */ }
  })
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 420, height: 680, resizable: false, titleBarStyle: 'hiddenInset',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false }
  })
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
    win.webContents.openDevTools({ mode: 'detach' }) // dev 下自动开控制台，方便看渲染进程真实报错
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}

app.whenReady().then(async () => {
  teeMainConsole()
  // ① 触发 macOS 系统麦克风授权弹窗（首次运行会弹；若曾被拒，需到系统设置手动开启）
  if (process.platform === 'darwin') {
    try { await systemPreferences.askForMediaAccess('microphone') } catch { /* 忽略，下方处理器兜底 */ }
  }
  // ② 放行渲染进程的 getUserMedia(麦克风) 权限请求 / 检查
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(MIC_PERMS.has(permission)))
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => MIC_PERMS.has(permission))

  const win = createWindow()
  attachConsoleLog(win)
  const orch = createOrchestrator(win)
  on(IPC.WAKE_DETECTED, () => orch.onWake())
  on(IPC.AUDIO_CHUNK, (b64) => orch.onAudioChunk(b64))
  on(IPC.VAD, (speaking) => orch.onVad(speaking))
  on(IPC.CONFIRM_RESULT, ({ id, ok }) => orch.onConfirmResult(id, ok))

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
