import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { createOrchestrator } from './orchestrator'
import { on } from './ipc'
import { IPC } from '@shared/types'
import { CONFIG } from './config'

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 420, height: 680, resizable: false, titleBarStyle: 'hiddenInset',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false }
  })
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
  return win
}

app.whenReady().then(() => {
  const win = createWindow()
  const orch = createOrchestrator(win)
  on(IPC.WAKE_DETECTED, () => orch.onWake())
  on(IPC.AUDIO_CHUNK, (b64) => orch.onAudioChunk(b64))
  on(IPC.VAD, (speaking) => orch.onVad(speaking))
  on(IPC.CONFIRM_RESULT, ({ id, ok }) => orch.onConfirmResult(id, ok))
  ipcMain.handle('cfg:pv-key', () => CONFIG.PICOVOICE_ACCESS_KEY)

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
