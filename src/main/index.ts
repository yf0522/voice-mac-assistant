import { app, BrowserWindow, systemPreferences, session } from 'electron'
import { join } from 'path'
import { createOrchestrator } from './orchestrator'
import { on } from './ipc'
import { IPC } from '@shared/types'

const MIC_PERMS = new Set(['media', 'audioCapture', 'microphone'])

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
  // ① 触发 macOS 系统麦克风授权弹窗（首次运行会弹；若曾被拒，需到系统设置手动开启）
  if (process.platform === 'darwin') {
    try { await systemPreferences.askForMediaAccess('microphone') } catch { /* 忽略，下方处理器兜底 */ }
  }
  // ② 放行渲染进程的 getUserMedia(麦克风) 权限请求 / 检查
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(MIC_PERMS.has(permission)))
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => MIC_PERMS.has(permission))

  const win = createWindow()
  const orch = createOrchestrator(win)
  on(IPC.WAKE_DETECTED, () => orch.onWake())
  on(IPC.AUDIO_CHUNK, (b64) => orch.onAudioChunk(b64))
  on(IPC.VAD, (speaking) => orch.onVad(speaking))
  on(IPC.CONFIRM_RESULT, ({ id, ok }) => orch.onConfirmResult(id, ok))

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
