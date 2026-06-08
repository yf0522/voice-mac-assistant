import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/types'

contextBridge.exposeInMainWorld('vox', {
  // renderer -> main
  wake: () => ipcRenderer.send(IPC.WAKE_DETECTED),
  sendAudio: (b64: string) => ipcRenderer.send(IPC.AUDIO_CHUNK, b64),
  vad: (speaking: boolean) => ipcRenderer.send(IPC.VAD, speaking),
  confirm: (id: string, ok: boolean) => ipcRenderer.send(IPC.CONFIRM_RESULT, { id, ok }),
  // main -> renderer 订阅
  onState: (cb: (s: string) => void) => ipcRenderer.on(IPC.STATE, (_e, s) => cb(s)),
  onModelAudio: (cb: (b64: string) => void) => ipcRenderer.on(IPC.MODEL_AUDIO, (_e, a) => cb(a)),
  onTranscript: (cb: (t: any) => void) => ipcRenderer.on(IPC.TRANSCRIPT, (_e, t) => cb(t)),
  onActionLog: (cb: (l: any) => void) => ipcRenderer.on(IPC.ACTION_LOG, (_e, l) => cb(l)),
  onConfirmRequest: (cb: (r: any) => void) => ipcRenderer.on(IPC.CONFIRM_REQUEST, (_e, r) => cb(r))
})
