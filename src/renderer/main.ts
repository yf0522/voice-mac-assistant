import { mountUI, type ActionHandle, type Risk } from './ui/ui'
import { startCapture } from './audio/capture'
import { createPlayback } from './audio/playback'
import { startWakeWord } from './wakeword'

// 与主进程 CONFIG.IDLE_TIMEOUT_MS 保持一致（5 分钟）；倒计时是纯展示，真相源在主进程状态机。
const IDLE_TIMEOUT_MS = 5 * 60 * 1000

const vox = (window as any).vox
const ui = mountUI(document.getElementById('app')!)
const playback = createPlayback()

let capture: { stop(): void } | null = null
let idleTimer: ReturnType<typeof setInterval> | null = null
const IDLE_SEC = Math.round(IDLE_TIMEOUT_MS / 1000)
let idleLeft = IDLE_SEC

// 待完成的动作日志条目（按 toolCall.id 映射），用于在结果可知时打 ✓/✗
const pendingActions = new Map<string, ActionHandle>()

function resetIdle() {
  idleLeft = IDLE_SEC
  ui.setIdle(idleLeft)
}

function startIdleCountdown() {
  if (idleTimer) clearInterval(idleTimer)
  resetIdle()
  idleTimer = setInterval(() => {
    idleLeft--
    ui.setIdle(idleLeft)
    if (idleLeft <= 0 && idleTimer) clearInterval(idleTimer)
  }, 1000)
}

function stopSession() {
  ui.setState('idle')
  ui.setSession(false)
  capture?.stop()
  capture = null
  if (idleTimer) { clearInterval(idleTimer); idleTimer = null }
  // 仍处于 ⏳ 的动作随会话结束置为失败
  pendingActions.forEach(a => a.done(false))
  pendingActions.clear()
}

async function onWake() {
  vox.wake() // 通知主进程建立 Gemini 会话
  ui.setState('listening')
  ui.setSession(true)
  startIdleCountdown()
  playback.bargeIn() // 唤醒时打断任何残余播放
  if (!capture) {
    capture = await startCapture(
      (b64) => vox.sendAudio(b64),
      (speaking) => {
        vox.vad(speaking)
        if (speaking) {
          resetIdle()
          playback.bargeIn() // 用户开口 → 打断 AI 当前播报
          ui.setState('listening')
        }
      }
    )
  }
}

// ---- 主进程事件订阅 ----
vox.onState((s: string) => {
  if (s === 'standby') stopSession()
})

vox.onModelAudio((b64: string) => {
  ui.setState('speaking')
  playback.enqueue(b64)
})

// 模型生成被打断（用户插话）→ 立即停止并清空残余播放
vox.onInterrupt(() => {
  playback.bargeIn()
  ui.setState('listening')
})

vox.onTranscript((t: { role?: string; text: string }) => {
  if (!t?.text) return
  if (t.role === 'user') ui.addUserText(t.text)
  else ui.addAssistantText(t.text)
})

vox.onActionLog((log: { call?: { id: string; name: string }; decision?: { risk: Risk; allowed: boolean }; error?: string }) => {
  if (log.error) {
    ui.addAssistantText('⚠️ ' + log.error)
    return
  }
  if (!log.call || !log.decision) return
  // 仅创建 ⏳ 条目并登记到 Map；最终 ✓/✗ 由 ACTION_RESULT 按 id 精确回填
  const handle = ui.addAction(log.call.name, log.decision.risk)
  pendingActions.set(log.call.id, handle)
})

// 精确动作结果：主进程对每个 ToolResult（拒绝/取消/执行）都发一条，按 id 标记成败
vox.onActionResult((r: { id: string; ok: boolean }) => {
  const handle = pendingActions.get(r.id)
  if (!handle) return
  handle.done(r.ok)
  pendingActions.delete(r.id)
})

vox.onConfirmRequest(async ({ id, prompt }: { id: string; prompt: string }) => {
  const ok = await ui.confirm(prompt)
  vox.confirm(id, ok)
  // 取消时主进程会回发 ACTION_RESULT({ok:false})，由 onActionResult 统一标记，无需在此处理
})

// ---- 唤醒词监听 ----
;(async () => {
  try {
    await startWakeWord(onWake)
  } catch (e: any) {
    console.error('[wakeword] 启动失败', e)
    const detail = e?.message ?? String(e)
    if (/permission/i.test(detail) || e?.name === 'NotAllowedError') {
      ui.addAssistantText('🎤 麦克风权限被拒。请到「系统设置 → 隐私与安全性 → 麦克风」勾选 Electron（或你的终端），然后重启 App。')
    } else {
      ui.addAssistantText('⚠️ 唤醒词初始化失败：' + detail)
    }
  }
})()
