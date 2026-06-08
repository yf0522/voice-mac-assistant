export type RiskLevel = 'green' | 'yellow' | 'red'

export interface ToolCall {
  id: string
  name: string
  args: Record<string, unknown>
}

export interface ToolResult {
  id: string
  name: string
  ok: boolean
  data?: unknown
  error?: string
}

export type SessionState = 'standby' | 'active'

export interface GatewayDecision {
  risk: RiskLevel
  allowed: boolean          // red => false
  needsConfirm: boolean     // yellow => true
  reason?: string           // 拒绝/确认原因（用于语音与 UI）
  confirmPrompt?: string    // 确认弹窗里展示的命令/动作描述
}

export const IPC = {
  // renderer -> main
  AUDIO_CHUNK: 'audio:chunk',
  WAKE_DETECTED: 'wake:detected',
  VAD: 'vad:state',
  CONFIRM_RESULT: 'action:confirm-result',
  // main -> renderer
  STATE: 'session:state',
  IDLE_TICK: 'session:idle-tick',
  MODEL_AUDIO: 'model:audio',
  TRANSCRIPT: 'model:transcript',
  ACTION_LOG: 'action:log',
  ACTION_RESULT: 'action:result',
  CONFIRM_REQUEST: 'action:confirm-request'
} as const
