import { contextBridge } from 'electron'
contextBridge.exposeInMainWorld('vox', { ping: () => 'pong' })
