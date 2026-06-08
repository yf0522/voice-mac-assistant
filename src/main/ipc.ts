import { ipcMain, BrowserWindow } from 'electron'

export function send(win: BrowserWindow, channel: string, payload: unknown) {
  win.webContents.send(channel, payload)
}
export function on(channel: string, handler: (payload: any) => void) {
  ipcMain.on(channel, (_e, payload) => handler(payload))
}
