export type UIState = 'idle' | 'listening' | 'thinking' | 'speaking'
export type Risk = 'green' | 'yellow' | 'red'

export interface ActionHandle {
  done(ok: boolean): void
}

export interface UI {
  setState(s: UIState): void
  setSession(active: boolean): void
  setIdle(secLeft: number): void
  addUserText(t: string): void
  addAssistantText(t: string): void
  addAction(label: string, risk: Risk): ActionHandle
  confirm(prompt: string): Promise<boolean>
}

const PILL_CLASS: Record<UIState, string> = {
  idle: '', listening: 'listen', thinking: 'think', speaking: 'speak'
}
const PILL_TXT: Record<UIState, string> = {
  idle: '待命中', listening: '聆听中…', thinking: '思考中…', speaking: '回复中…'
}
const RISK_COLOR: Record<Risk, string> = {
  green: 'var(--green)', yellow: 'var(--amber)', red: 'var(--red)'
}

export function mountUI(root: HTMLElement): UI {
  root.innerHTML = `
    <div class="aurora"><b class="a1"></b><b class="a2"></b><b class="a3"></b></div>
    <div class="macwin">
      <div class="titlebar">
        <span class="tl r"></span><span class="tl y"></span><span class="tl g"></span>
        <span class="tt">VoxMac</span>
        <span class="sess" id="sessTimer">● 待机</span>
      </div>
      <div class="appbody">
        <div class="statuspill" id="pill"><span class="sd"></span><span id="pillTxt">待命中</span></div>
        <div class="stage" id="stage">
          <div class="halo"></div>
          <div class="spinner"></div>
          <div class="orbit"><i></i><i></i><i></i></div>
          <div class="ring"></div><div class="ring r2"></div><div class="ring r3"></div>
          <div class="bigorb idle"></div>
          <div class="bars"><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span></div>
        </div>
        <div class="wakehint" id="wakehint">监听唤醒词 <b>「贾维斯」</b></div>
        <div class="sessmode" id="sessmode"><span class="live">●</span> 连续对话中 · 无需再喊唤醒词　<b id="idleTxt">静默 5:00 后待机</b></div>
        <div class="convo" id="convo"></div>
      </div>
      <div class="modal" id="modal">
        <div class="mcard">
          <div class="mh"><span class="wico">⚠️</span><h4>需要你确认</h4></div>
          <p>这个动作可能改动系统或文件，确认执行吗？</p>
          <div class="cmd" id="mCmd"></div>
          <div class="mbtns">
            <button class="no" id="mNo">取消</button>
            <button class="ok" id="mOk">确认执行</button>
          </div>
        </div>
      </div>
    </div>`

  const $ = (id: string) => root.querySelector('#' + id) as HTMLElement
  const stage = $('stage')
  const pill = $('pill')
  const pillTxt = $('pillTxt')
  const sessTimer = $('sessTimer')
  const convo = $('convo')
  const wakehint = $('wakehint')
  const sessmode = $('sessmode')
  const idleTxt = $('idleTxt')
  const modal = $('modal')
  const mCmd = $('mCmd')
  const mOk = $('mOk') as HTMLButtonElement
  const mNo = $('mNo') as HTMLButtonElement

  const fmt = (s: number) => {
    const v = Math.max(0, s)
    return Math.floor(v / 60) + ':' + String(v % 60).padStart(2, '0')
  }
  const scroll = () => { convo.scrollTop = convo.scrollHeight }

  return {
    setState(s) {
      stage.className = 'stage ' + (s === 'idle' ? '' : s)
      pill.className = 'statuspill ' + PILL_CLASS[s]
      pillTxt.textContent = PILL_TXT[s]
    },
    setSession(active) {
      wakehint.style.display = active ? 'none' : 'block'
      sessmode.classList.toggle('show', active)
      sessTimer.textContent = active ? '● 会话中' : '● 待机'
    },
    setIdle(sec) {
      idleTxt.textContent = '静默 ' + fmt(sec) + ' 后待机'
    },
    addUserText(t) {
      const d = document.createElement('div')
      d.className = 'bub u'
      d.textContent = t
      convo.appendChild(d); scroll()
    },
    addAssistantText(t) {
      const d = document.createElement('div')
      d.className = 'bub a'
      d.textContent = t
      convo.appendChild(d); scroll()
    },
    addAction(label, risk) {
      const d = document.createElement('div')
      d.className = 'bub act'
      const main = document.createElement('span')
      main.textContent = '⚙️ ' + label
      const st = document.createElement('span')
      st.className = 'st'
      st.textContent = '⏳'
      d.appendChild(main)
      d.appendChild(st)
      d.style.borderLeft = `3px solid ${RISK_COLOR[risk]}`
      convo.appendChild(d); scroll()
      return {
        done(ok: boolean) { st.textContent = ok ? '✓' : '✗' }
      }
    },
    confirm(prompt) {
      mCmd.textContent = prompt
      modal.classList.add('show')
      return new Promise<boolean>(res => {
        const finish = (v: boolean) => {
          modal.classList.remove('show')
          mOk.onclick = null
          mNo.onclick = null
          res(v)
        }
        mOk.onclick = () => finish(true)
        mNo.onclick = () => finish(false)
      })
    }
  }
}
