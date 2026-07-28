const { ipcRenderer } = require('electron')

// ═══ CONSTANTS ════════════════════════════════════════════════════════
const XP_PER_LEVEL   = 500
const XP_PER_MISSION = 150
const XP_PER_RECLAIM = 200
const XP_PENALTY     = 75
const FUSE_COST_XP   = 10
const FUSE_EXTEND_MS = 2 * 60 * 60 * 1000
const RECLAIM_RATIO  = 0.5

// ═══ STATE ════════════════════════════════════════════════════════════
let data = {}
let countdownInterval = null
let missionEndTime    = null
let fuseUsed          = false
let lastCompletedName = ''
let lastFailedName    = ''
let emberAnimFrame    = null
let sparkAnimFrame    = null
let ignitionInterval  = null
let confirmCallback   = null

// ═══ AUDIO ════════════════════════════════════════════════════════════
let _audio = null
function getAudio() {
  if (!_audio) {
    try { _audio = require('./audio.js') } catch(e) { _audio = {} }
  }
  return _audio
}
const playIgnite   = () => { try { getAudio().playIgnite   && getAudio().playIgnite()   } catch(e){} }
const playComplete = () => { try { getAudio().playComplete && getAudio().playComplete() } catch(e){} }
const playFail     = () => { try { getAudio().playFail     && getAudio().playFail()     } catch(e){} }
const playLevelUp  = () => { try { getAudio().playLevelUp  && getAudio().playLevelUp()  } catch(e){} }
const playTick     = (u) => { try { getAudio().playTick    && getAudio().playTick(u)    } catch(e){} }
const playAlarm    = () => { try { getAudio().playAlarm    && getAudio().playAlarm()    } catch(e){} }

// ═══ TEMPLATES ════════════════════════════════════════════════════════
const TEMPLATES = [
  { name: 'Email dragon',       duration: 1800 },
  { name: 'Inbox zero',         duration: 3600 },
  { name: '5-min reset',        duration: 300  },
  { name: 'Gym beast mode',     duration: 5400 },
  { name: 'Deep focus block',   duration: 7200 },
  { name: 'Quick admin sweep',  duration: 1800 },
  { name: 'One phone call',     duration: 900  },
  { name: 'Clean one space',    duration: 1200 },
  { name: 'Write 500 words',    duration: 3600 },
  { name: 'Ship one thing',     duration: 7200 },
]

// ═══ PARTICLES ════════════════════════════════════════════════════════
const canvas = document.getElementById('particle-canvas')
const ctx2   = canvas.getContext('2d')
canvas.width = 580; canvas.height = 980
let particles = []

function addParticles(x, y, count, colors, speed = 5, life = 60) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2
    const s = speed * (0.5 + Math.random())
    particles.push({
      x, y,
      vx: Math.cos(angle) * s,
      vy: Math.sin(angle) * s - Math.random() * 3,
      life, maxLife: life,
      size: 2 + Math.random() * 4,
      color: colors[Math.floor(Math.random() * colors.length)],
      gravity: 0.12
    })
  }
}

function addConfetti(x, y, count = 60) {
  const colors = ['#ff6600','#ffaa00','#ffcc00','#ff3300','#ffffff','#ff8800']
  for (let i = 0; i < count; i++) {
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI
    const s = 4 + Math.random() * 8
    particles.push({
      x, y,
      vx: Math.cos(angle) * s,
      vy: Math.sin(angle) * s,
      life: 80 + Math.random() * 40,
      maxLife: 120,
      size: 4 + Math.random() * 6,
      color: colors[Math.floor(Math.random() * colors.length)],
      gravity: 0.2,
      isRect: Math.random() > 0.5,
      rotation: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.2
    })
  }
}

function addAsh(x, y, count = 20) {
  for (let i = 0; i < count; i++) {
    particles.push({
      x, y,
      vx: (Math.random() - 0.5) * 2,
      vy: -(Math.random() * 2),
      life: 40 + Math.random() * 30,
      maxLife: 70,
      size: 2 + Math.random() * 3,
      color: `hsl(0,0%,${20 + Math.random() * 20}%)`,
      gravity: 0.05,
      drift: (Math.random() - 0.5) * 0.1
    })
  }
}

function tickParticles() {
  ctx2.clearRect(0, 0, 580, 980)
  particles = particles.filter(p => p.life > 0)
  for (const p of particles) {
    p.x += p.vx; p.y += p.vy
    p.vy += p.gravity
    if (p.drift) p.vx += p.drift
    p.life--
    const alpha = p.life / p.maxLife
    ctx2.globalAlpha = alpha
    ctx2.fillStyle = p.color
    if (p.isRect) {
      ctx2.save()
      ctx2.translate(p.x, p.y)
      if (p.rotSpeed) { p.rotation += p.rotSpeed; ctx2.rotate(p.rotation) }
      ctx2.fillRect(-p.size/2, -p.size/2, p.size, p.size * 0.5)
      ctx2.restore()
    } else {
      ctx2.beginPath()
      ctx2.arc(p.x, p.y, p.size * alpha, 0, Math.PI * 2)
      ctx2.fill()
    }
  }
  ctx2.globalAlpha = 1
  requestAnimationFrame(tickParticles)
}
tickParticles()

function fireworksBurst(x, y, count = 28) {
  const colors = ['#ff6600','#ffaa00','#ff3300','#ffcc00','#ff8800','#fff']
  addParticles(x, y, count, colors, 7, 55)
}

// ═══ EXPLOSION ════════════════════════════════════════════════════════
function explosion(x, y) {
  ensureSparkLoop()

  // 1. Multiple shockwave rings, staggered
  const ringTimings = [0, 100, 220, 380]
  ringTimings.forEach((delay, i) => {
    setTimeout(() => {
      shockwaves.push({ x, y, radius: 0, alpha: 1 - i * 0.1 })
    }, delay)
  })

  // 2. Massive debris burst — 3 waves, staggered
  const debrisColors = ['#ff2200','#ff6600','#ffaa00','#ffcc00','#ffffff','#ff4400','#cc0000','#ff0000']
  function spawnDebrisWave(count, speedMin, speedMax, sizeMin, sizeMax, lifeBase, gravStrength, delay) {
    setTimeout(() => {
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2
        const speed = speedMin + Math.random() * (speedMax - speedMin)
        particles.push({
          x: x + (Math.random()-0.5)*20,
          y: y + (Math.random()-0.5)*20,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 3,
          life: lifeBase + Math.random() * 40,
          maxLife: lifeBase + 40,
          size: sizeMin + Math.random() * (sizeMax - sizeMin),
          color: debrisColors[Math.floor(Math.random() * debrisColors.length)],
          gravity: gravStrength,
          isRect: Math.random() > 0.35,
          rotation: Math.random() * Math.PI * 2,
          rotSpeed: (Math.random() - 0.5) * 0.25
        })
      }
    }, delay)
  }

  spawnDebrisWave(80,  6,  18, 4,  10, 90,  0.18, 0)
  spawnDebrisWave(50,  3,  10, 3,  7,  75,  0.12, 120)
  spawnDebrisWave(40,  2,  8,  2,  5,  60,  0.08, 280)

  // 3. Sparks from explosion point
  for (let i = 0; i < 80; i++) {
    const angle = Math.random() * Math.PI * 2
    const speed = 3 + Math.random() * 14
    sparks.push({
      x: x + (Math.random()-0.5)*10,
      y: y + (Math.random()-0.5)*10,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 2,
      life: 35 + Math.random() * 35,
      maxLife: 70,
      size: 1.5 + Math.random() * 3,
      color: debrisColors[Math.floor(Math.random() * debrisColors.length)],
      gravity: 0.1
    })
  }

  // 4. Sustained ash cloud
  for (let i = 0; i < 60; i++) {
    setTimeout(() => addAsh(
      x + (Math.random()-0.5)*200,
      y + (Math.random()-0.5)*100,
      12
    ), i * 25)
  }

  // 5. Heavy screen shake
  const target = document.querySelector('.main-content') || document.body
  target.style.transition = 'none'
  const offsets = [
    [12,-9],[-14,11],[10,-12],[-10,8],[8,-6],
    [-6,9],[5,-4],[-4,5],[3,-3],[-2,3],[1,-1],[0,0]
  ]
  let si = 0
  function shake() {
    if (si >= offsets.length) { target.style.transform = ''; return }
    target.style.transform = `translate(${offsets[si][0]}px,${offsets[si][1]}px)`
    si++
    setTimeout(shake, 50)
  }
  shake()

  // 6. Triple flash
  screenFlash('rgba(255,0,0,0.45)')
  setTimeout(() => screenFlash('rgba(255,80,0,0.25)'), 180)
  setTimeout(() => screenFlash('rgba(255,40,0,0.15)'), 400)
}

// ═══ TIMER SPARKS ═════════════════════════════════════════════════════
const sparkCanvas = document.getElementById('spark-canvas')
const sparkCtx    = sparkCanvas.getContext('2d')
sparkCanvas.width = 580; sparkCanvas.height = 980
let sparks = []
let shockwaves = []

function startTimerSparks() {
  stopTimerSparks()
  sparks = []

  function loop() {
    sparkCtx.clearRect(0, 0, 580, 980)

    const el = document.getElementById('countdown')
    if (el && !el.closest('.hidden') && missionEndTime) {
      const rect      = el.getBoundingClientRect()
      const remaining = missionEndTime - Date.now()

      let rate, colors, speed, life
      if (remaining < 60000) {
        rate   = 5 + Math.floor(Math.random() * 5)
        colors = ['#ff2200','#ff5500','#ffaa00','#ffffff','#ff3300']
        speed  = 3.5
        life   = 30
      } else if (remaining < 300000) {
        rate   = 2 + Math.floor(Math.random() * 3)
        colors = ['#ff6600','#ffaa00','#ff8800','#ffcc00']
        speed  = 2.5
        life   = 24
      } else {
        rate   = Math.random() > 0.55 ? 1 : 0
        colors = ['#ff7700','#ff9900','#ffbb00']
        speed  = 1.6
        life   = 18
      }

      for (let i = 0; i < rate; i++) {
        const edge = Math.floor(Math.random() * 4)
        let sx, sy
        if      (edge === 0) { sx = rect.left  + Math.random() * rect.width;  sy = rect.top    }
        else if (edge === 1) { sx = rect.left  + Math.random() * rect.width;  sy = rect.bottom }
        else if (edge === 2) { sx = rect.left;                                  sy = rect.top + Math.random() * rect.height }
        else                 { sx = rect.right;                                 sy = rect.top + Math.random() * rect.height }

        const spread  = Math.PI * 0.7
        const baseAng = edge === 0 ? -Math.PI/2 : edge === 1 ? Math.PI/2 : edge === 2 ? Math.PI : 0
        const angle   = baseAng + (Math.random() - 0.5) * spread
        const s       = speed * (0.5 + Math.random())

        sparks.push({
          x: sx, y: sy,
          vx: Math.cos(angle) * s,
          vy: Math.sin(angle) * s - 0.5,
          life, maxLife: life,
          size: 2 + Math.random() * 2.5,
          color: colors[Math.floor(Math.random() * colors.length)],
          gravity: 0.08
        })
      }
    }

    // Draw shockwave rings
    shockwaves = shockwaves.filter(w => w.alpha > 0)
    for (const w of shockwaves) {
      w.radius += 28
      w.alpha  -= 0.055
      if (w.alpha <= 0) continue
      sparkCtx.save()
      sparkCtx.strokeStyle = `rgba(255,220,100,${w.alpha * 0.6})`
      sparkCtx.lineWidth   = 12 * w.alpha
      sparkCtx.beginPath()
      sparkCtx.arc(w.x, w.y, w.radius, 0, Math.PI * 2)
      sparkCtx.stroke()
      sparkCtx.strokeStyle = `rgba(255,80,0,${w.alpha})`
      sparkCtx.lineWidth   = 3 * w.alpha
      sparkCtx.beginPath()
      sparkCtx.arc(w.x, w.y, w.radius + 4, 0, Math.PI * 2)
      sparkCtx.stroke()
      sparkCtx.restore()
    }

    sparks = sparks.filter(s => s.life > 0)
    for (const s of sparks) {
      s.x  += s.vx; s.y += s.vy
      s.vy += s.gravity
      s.life--
      const alpha = s.life / s.maxLife
      sparkCtx.globalAlpha = alpha
      sparkCtx.fillStyle   = s.color
      sparkCtx.beginPath()
      sparkCtx.arc(s.x, s.y, s.size * alpha + 0.5, 0, Math.PI * 2)
      sparkCtx.fill()
    }
    sparkCtx.globalAlpha = 1

    const hasActive = !!(data.missions || []).find(m => m.active)
    if (!hasActive && sparks.length === 0 && shockwaves.length === 0) {
      sparkAnimFrame = null
      sparkCtx.clearRect(0, 0, 580, 980)
      return
    }

    sparkAnimFrame = requestAnimationFrame(loop)
  }

  sparkAnimFrame = requestAnimationFrame(loop)
}

function stopTimerSparks() {
  if (sparkAnimFrame) { cancelAnimationFrame(sparkAnimFrame); sparkAnimFrame = null }
  sparks = []
  shockwaves = []
  sparkCtx.clearRect(0, 0, 580, 980)
}

function ensureSparkLoop() {
  if (!sparkAnimFrame) startTimerSparks()
}

// ═══ EMBERS ═══════════════════════════════════════════════════════════
function startEmbers() {
  const ec = document.getElementById('ember-canvas')
  if (!ec) return
  const ectx = ec.getContext('2d')
  ec.width = ec.offsetWidth; ec.height = ec.offsetHeight
  let embers = []

  function spawnEmber() {
    embers.push({
      x: Math.random() * ec.width, y: ec.height + 5,
      size: 1 + Math.random() * 2.5,
      speed: 0.4 + Math.random() * 0.8,
      drift: (Math.random() - 0.5) * 0.4,
      life: 1, decay: 0.008 + Math.random() * 0.008,
      color: Math.random() > 0.5 ? '#ff6600' : '#ffaa00'
    })
  }

  function drawEmbers() {
    ectx.clearRect(0, 0, ec.width, ec.height)
    if (Math.random() > 0.6) spawnEmber()
    embers = embers.filter(e => e.life > 0)
    for (const e of embers) {
      e.y -= e.speed; e.x += e.drift; e.life -= e.decay
      ectx.globalAlpha = e.life * 0.7
      ectx.fillStyle = e.color
      ectx.beginPath()
      ectx.arc(e.x, e.y, e.size, 0, Math.PI * 2)
      ectx.fill()
    }
    ectx.globalAlpha = 1
    emberAnimFrame = requestAnimationFrame(drawEmbers)
  }
  if (emberAnimFrame) cancelAnimationFrame(emberAnimFrame)
  drawEmbers()
}

function stopEmbers() {
  if (emberAnimFrame) { cancelAnimationFrame(emberAnimFrame); emberAnimFrame = null }
  const ec = document.getElementById('ember-canvas')
  if (ec) ec.getContext('2d').clearRect(0, 0, ec.width, ec.height)
}

// ═══ FLASH ════════════════════════════════════════════════════════════
function screenFlash(color = 'rgba(255,100,0,0.15)') {
  const f = document.createElement('div')
  f.className = 'flash-overlay'
  f.style.background = color
  document.body.appendChild(f)
  setTimeout(() => f.remove(), 400)
}

// ═══ THEME ════════════════════════════════════════════════════════════
const ALL_THEMES = ['inferno','campfire','cyber','void','toxic','arctic']

function setTheme(theme) {
  document.body.className = `theme-${theme}`
  data.settings = data.settings || {}
  data.settings.theme = theme
  saveData()
  ALL_THEMES.forEach(t => {
    const btn = document.getElementById(`theme-${t}`)
    if (btn) btn.classList.toggle('active', t === theme)
  })
}

function applyTheme() {
  const theme = (data.settings && data.settings.theme) || 'inferno'
  document.body.className = `theme-${theme}`
  ALL_THEMES.forEach(t => {
    const btn = document.getElementById(`theme-${t}`)
    if (btn) btn.classList.toggle('active', t === theme)
  })
}

// ═══ CONFIRM ══════════════════════════════════════════════════════════
function showConfirm(message, callback) {
  confirmCallback = callback
  document.getElementById('confirm-message').textContent = message
  document.getElementById('confirm-overlay').classList.remove('hidden')
}

// ═══ SCREENS ══════════════════════════════════════════════════════════
const SCREENS = ['onboarding-screen','login-screen','ignition-screen','main-screen','settings-screen']

function showScreen(id) {
  SCREENS.forEach(s => document.getElementById(s).classList.add('hidden'))
  document.getElementById(id).classList.remove('hidden')
}

// ═══ INIT ══════════════════════════════════════════════════════════════
async function init() {
  try {
    data = await ipcRenderer.invoke('load-data')
    data.settings = data.settings || {}
    applyTheme()

    if (!data.onboardingDone) {
      showScreen('onboarding-screen')
      setTimeout(() => fireworksBurst(290, 300, 20), 500)
    } else {
      checkStreak()
      showLoginScreen()
    }
  } catch(e) {
    console.error('Init failed:', e)
    document.body.style.background = '#080808'
    document.body.innerHTML += `<div style="color:red;padding:20px;position:fixed;top:20px;left:20px;z-index:9999">Error: ${e.message}</div>`
  }
}

function checkStreak() {
  const today = new Date().toDateString()
  const last  = data.lastLogin
  if (!last) {
    data.streak = 1
  } else if (last !== today) {
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    data.streak = (last === yesterday.toDateString()) ? (data.streak || 0) + 1 : 1
  }
  data.lastLogin = today
  if (data.lastWinDate !== today) { data.todayWins = 0; data.lastWinDate = today }
  saveData()
}

// ═══ ONBOARDING ═══════════════════════════════════════════════════════
function nextOnboard(step) {
  document.querySelectorAll('.onboard-step').forEach((el, i) => el.classList.toggle('hidden', i !== step))
  document.querySelectorAll('.dot').forEach((el, i) => el.classList.toggle('active', i === step))
  fireworksBurst(290, 300 + step * 30, 15)
}

function finishOnboard() {
  data.onboardingDone = true
  saveData()
  checkStreak()
  showLoginScreen()
}

// ═══ LOGIN ════════════════════════════════════════════════════════════
function needsIgnition() {
  if (!data.todayFocus) return true
  if (data.focusCompleted) return false
  const age = Date.now() - (data.focusSetAt || 0)
  if (age > 24 * 60 * 60 * 1000) return true
  return false
}

function showLoginScreen() {
  const streak = data.streak || 0
  document.getElementById('login-streak').textContent = streak
  document.getElementById('login-xp').textContent    = data.xp || 0
  document.getElementById('login-level').textContent = data.level || 1

  let msg = "Welcome back. Let's get it."
  if      (streak >= 30) msg = "30 days. You are unstoppable."
  else if (streak >= 14) msg = "Two weeks strong. Don't stop now."
  else if (streak >= 7)  msg = "One full week. Your brain is waking up."
  else if (streak >= 3)  msg = "3 days in. Momentum is building."
  else if (streak === 1) msg = "Day one. Every legend starts here."
  document.getElementById('login-message').textContent = msg

  const chain = document.getElementById('login-chain')
  chain.innerHTML = ''
  const show = Math.min(streak, 20)
  for (let i = 0; i < show; i++) {
    const link = document.createElement('div')
    link.className = 'chain-link'
    link.style.animationDelay = `${i * 40}ms`
    chain.appendChild(link)
  }

  showScreen('login-screen')
  const positions = [[120,180],[350,140],[80,300],[400,260],[240,200],[160,350],[360,320]]
  positions.forEach(([x,y], i) => setTimeout(() => fireworksBurst(x, y), 200 + i * 280))
}

// ═══ IGNITION RITUAL ══════════════════════════════════════════════════
function startIgnitionRitual() {
  showScreen('ignition-screen')
  document.getElementById('ignition-input').value = ''
  document.getElementById('ignition-input').focus()

  let timeLeft = 30
  document.getElementById('ignition-timer').textContent = timeLeft
  document.getElementById('ignition-timer').classList.remove('urgent')

  ignitionInterval = setInterval(() => {
    timeLeft--
    const el = document.getElementById('ignition-timer')
    el.textContent = timeLeft
    if (timeLeft <= 5) el.classList.add('urgent')
    playTick(timeLeft <= 5)
    if (timeLeft <= 0) { clearInterval(ignitionInterval); enterApp() }
  }, 1000)
}

function confirmIgnition() {
  clearInterval(ignitionInterval)
  const val = document.getElementById('ignition-input').value.trim()
  if (val) {
    data.todayFocus    = val
    data.focusSetAt    = Date.now()
    data.focusCompleted = false
    saveData()
  }
  screenFlash()
  setTimeout(enterApp, 150)
}

function skipIgnition() {
  clearInterval(ignitionInterval)
  enterApp()
}

// ═══ MAIN APP ═════════════════════════════════════════════════════════
function enterApp() {
  screenFlash()
  setTimeout(() => {
    showScreen('main-screen')
    renderTemplates()
    updateMainUI()
    checkExpiredMissions()
    renderMission()
    renderGraveyard()
    renderFocusBanner()
  }, 150)
}

function updateMainUI() {
  const xp    = data.xp || 0
  const level = data.level || 1
  document.getElementById('streak-count').textContent = data.streak || 0
  document.getElementById('level-count').textContent  = level
  document.getElementById('wins-count').textContent   = data.todayWins || 0

  const pct = ((xp % XP_PER_LEVEL) / XP_PER_LEVEL) * 100
  document.getElementById('xp-bar').style.width = pct + '%'
  document.getElementById('xp-text').textContent = `${xp} XP`
  document.getElementById('level-badge').classList.toggle('near-level', pct >= 80)
}

// ═══ TEMPLATES ════════════════════════════════════════════════════════
function renderTemplates() {
  const container = document.getElementById('templates')
  container.innerHTML = ''
  TEMPLATES.forEach(t => {
    const btn = document.createElement('button')
    btn.className = 'template-btn'
    btn.textContent = t.name
    btn.onclick = () => launchMissionData(t.name, t.duration * 1000)
    container.appendChild(btn)
  })
}

// ═══ MISSIONS ═════════════════════════════════════════════════════════
function checkExpiredMissions() {
  const now = Date.now()
  ;(data.missions || []).filter(m => m.active).forEach(m => {
    if (now >= m.endTime) expireMission(m)
  })
}

function renderMission() {
  const active   = (data.missions || []).find(m => m.active)
  const card     = document.getElementById('mission-card')
  const emptyEl  = document.getElementById('mission-empty')
  const activeEl = document.getElementById('mission-active')

  if (active) {
    card.classList.add('has-mission')
    emptyEl.classList.add('hidden')
    activeEl.classList.remove('hidden')
    document.getElementById('mission-name').textContent = active.name
    missionEndTime = active.endTime
    fuseUsed = active.fuseUsed || false
    updateFuseBtn()
    startCountdown()
    startEmbers()
    startTimerSparks()
  } else {
    card.classList.remove('has-mission', 'urgent-card')
    emptyEl.classList.remove('hidden')
    activeEl.classList.add('hidden')
    stopCountdown()
    stopEmbers()
    stopTimerSparks()
  }
}

function updateFuseBtn() {
  const btn = document.getElementById('fuse-btn')
  const xp  = data.xp || 0
  if (fuseUsed) {
    btn.classList.add('used')
    btn.title = 'Emergency fuse already used'
    btn.textContent = '⚡ USED'
  } else if (xp < FUSE_COST_XP) {
    btn.classList.add('used')
    btn.title = `Need ${FUSE_COST_XP} XP to use emergency fuse`
    btn.textContent = '⚡ FUSE'
  } else {
    btn.classList.remove('used')
    btn.title = `Spend ${FUSE_COST_XP} XP to extend by 2 hours`
    btn.textContent = '⚡ FUSE'
  }
}

function startCountdown() {
  stopCountdown()
  updateCountdown()
  countdownInterval = setInterval(updateCountdown, 1000)
}

function stopCountdown() {
  if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null }
}

function updateCountdown() {
  const remaining = missionEndTime - Date.now()
  if (remaining <= 0) {
    stopCountdown()
    const active = (data.missions || []).find(m => m.active)
    if (active) expireMission(active)
    return
  }
  const h = Math.floor(remaining / 3600000)
  const m = Math.floor((remaining % 3600000) / 60000)
  const s = Math.floor((remaining % 60000) / 1000)
  const el   = document.getElementById('countdown')
  const card = document.getElementById('mission-card')
  el.textContent = `${pad(h)}:${pad(m)}:${pad(s)}`

  if (remaining < 60000) {
    el.className = 'countdown urgent'
    card.classList.add('urgent-card')
  } else if (remaining < 300000) {
    el.className = 'countdown warning'
    card.classList.remove('urgent-card')
  } else {
    el.className = 'countdown'
    card.classList.remove('urgent-card')
  }
}

function pad(n) { return String(n).padStart(2, '0') }

function launchMission() {
  const name = document.getElementById('mission-input').value.trim()
  if (!name) { document.getElementById('mission-input').focus(); return }
  const durationSec = parseInt(document.getElementById('duration-select').value)
  launchMissionData(name, durationSec * 1000)
  document.getElementById('mission-input').value = ''
}

function launchMissionData(name, durationMs, isReclaim = false) {
  const mission = {
    id: Date.now(), name, active: true,
    startTime: Date.now(), endTime: Date.now() + durationMs,
    originalDuration: durationMs,
    isReclaim, reclaimXp: isReclaim ? XP_PER_RECLAIM : 0
  }
  data.missions = (data.missions || []).filter(m => !m.active)
  data.missions.push(mission)
  saveData()

  document.getElementById('add-mission-form').classList.add('hidden')
  fuseUsed = false
  screenFlash()
  playIgnite()
  addParticles(290, 500, 20, ['#ff6600','#ffaa00'], 5, 35)
  missionEndTime = mission.endTime
  setTimeout(() => { renderMission(); renderFocusBanner() }, 150)
}

function completeMission() {
  const active = (data.missions || []).find(m => m.active)
  if (!active) return

  lastCompletedName = active.name
  const xpReward = active.isReclaim ? XP_PER_RECLAIM : XP_PER_MISSION
  data.missions = (data.missions || []).filter(m => m.id !== active.id)
  stopCountdown(); stopEmbers(); stopTimerSparks()

  const oldLevel = data.level || 1
  data.xp        = (data.xp || 0) + xpReward
  data.level     = Math.floor(data.xp / XP_PER_LEVEL) + 1
  data.todayWins = (data.todayWins || 0) + 1
  data.totalCompleted = (data.totalCompleted || 0) + 1

  // Clear focus banner if this mission matches it
  if (data.todayFocus && active.name.toLowerCase().trim() === data.todayFocus.toLowerCase().trim()) {
    data.focusCompleted = true
    renderFocusBanner()
  }
  saveData()

  screenFlash()
  playComplete()
  addConfetti(290, 400, 80)
  addParticles(290, 425, 30, ['#ff6600','#ffaa00','#fff'], 6, 50)
  renderMission()
  updateMainUI()

  const didLevelUp = data.level > oldLevel

  // FIX: Handle auto-post AND level-up correctly — level-up takes priority
  setTimeout(() => {
    if (didLevelUp) {
      // Show level-up first; auto-post happens inside showLevelUp if enabled
      showLevelUp()
    } else if (data.settings && data.settings.autoPostComplete) {
      postToX(`Mission complete on FUSE! 🔥 "${lastCompletedName}" — DONE. Day ${data.streak} streak. ${data.todayWins} win${data.todayWins !== 1 ? 's' : ''} today. #FUSE #ADHD`)
    } else {
      showMissionComplete(xpReward)
    }
  }, 300)
}

function expireMission(mission, abandoned = false) {
  lastFailedName = mission.name
  data.missions  = (data.missions || []).filter(m => m.id !== mission.id)
  data.xp        = Math.max(0, (data.xp || 0) - XP_PENALTY)
  data.level     = Math.floor(data.xp / XP_PER_LEVEL) + 1
  data.graveyard = data.graveyard || []
  data.graveyard.unshift({
    id: Date.now(),
    name: mission.name,
    diedAt: Date.now(),
    originalDuration: mission.originalDuration || 3600000,
    permanent: !!mission.isReclaim || abandoned
  })
  saveData()
  stopCountdown(); stopEmbers(); stopTimerSparks()

  const card = document.getElementById('mission-card')
  const rect = card ? card.getBoundingClientRect() : null
  const ex   = rect ? rect.left + rect.width  / 2 : 290
  const ey   = rect ? rect.top  + rect.height / 2 : 400
  explosion(ex, ey)
  playFail()
  renderMission(); updateMainUI(); renderGraveyard()

  const mc = document.querySelector('.main-content')
  if (mc) mc.scrollTop = 0

  setTimeout(() => {
    particles.length = 0
    sparks.length = 0
    shockwaves.length = 0
    ctx2.clearRect(0, 0, 580, 980)
    sparkCtx.clearRect(0, 0, 580, 980)

    if (data.settings && data.settings.autoPostShame) {
      postToX(`Mission expired on FUSE. 💀 "${lastFailedName}" is in the graveyard. #FUSE #ADHD #Accountability`)
    } else {
      showGraveyardOverlay()
    }
  }, 1800)
}

function abandonMission() {
  const active = (data.missions || []).find(m => m.active)
  if (!active) return
  showConfirm('Abandon this mission? It goes to the graveyard permanently — no reclaim.', () => expireMission(active, true))
}

function useEmergencyFuse() {
  if (fuseUsed) return
  if ((data.xp || 0) < FUSE_COST_XP) return
  const active = (data.missions || []).find(m => m.active)
  if (!active) return

  showConfirm(`Spend ${FUSE_COST_XP} XP to extend your fuse by 2 hours?`, () => {
    active.endTime  += FUSE_EXTEND_MS
    active.fuseUsed  = true
    missionEndTime   = active.endTime
    fuseUsed         = true
    data.xp          = Math.max(0, (data.xp || 0) - FUSE_COST_XP)
    saveData()
    updateFuseBtn()
    updateMainUI()
    screenFlash('rgba(255,200,0,0.1)')
  })
}

// ═══ FOCUS BANNER ═════════════════════════════════════════════════════
function renderFocusBanner() {
  const banner = document.getElementById('focus-banner')
  const textEl = document.getElementById('focus-banner-text')
  if (!banner) return

  const activeMission = (data.missions || []).find(m => m.active)
  const focusIsRunning = activeMission && data.todayFocus &&
    activeMission.name.toLowerCase().trim() === data.todayFocus.toLowerCase().trim()
  if (!data.todayFocus || data.focusCompleted || focusIsRunning) { banner.classList.add('hidden'); return }
  const age = Date.now() - (data.focusSetAt || 0)
  if (age > 24 * 60 * 60 * 1000) {
    data.todayFocus = null; data.focusSetAt = null; saveData()
    banner.classList.add('hidden'); return
  }

  textEl.textContent = data.todayFocus
  banner.classList.remove('hidden')

  const launchBtn = document.getElementById('focus-launch-btn')
  if (launchBtn) {
    const hasActive = !!(data.missions || []).find(m => m.active)
    launchBtn.style.display = hasActive ? 'none' : ''
  }
}

// ═══ GRAVEYARD ════════════════════════════════════════════════════════
// FIX: Use textContent instead of innerHTML to prevent XSS from mission names
function renderGraveyard() {
  const graveyard = data.graveyard || []
  const container = document.getElementById('graveyard')
  const emptyEl   = document.getElementById('graveyard-empty')
  const countEl   = document.getElementById('graveyard-count')

  countEl.textContent = graveyard.length > 0 ? `(${graveyard.length})` : ''
  container.querySelectorAll('.grave-card').forEach(c => c.remove())

  if (graveyard.length === 0) {
    emptyEl.classList.remove('hidden')
    return
  }
  emptyEl.classList.add('hidden')

  graveyard.forEach(g => {
    const card = document.createElement('div')
    card.className = 'grave-card'

    const reclaimMs    = Math.floor((g.originalDuration || 3600000) * RECLAIM_RATIO)
    const reclaimLabel = formatDuration(reclaimMs)

    const info = document.createElement('div')
    info.className = 'grave-info'

    if (g.permanent) {
      const badge = document.createElement('div')
      badge.className = 'expired-badge permanent-badge'
      badge.textContent = '🪦 PERMANENT'

      const name = document.createElement('div')
      name.className = 'grave-name'
      name.textContent = g.name  // safe: textContent not innerHTML

      const note = document.createElement('div')
      note.className = 'reclaim-xp permanent-note'
      note.textContent = 'this one is gone forever'

      info.append(badge, name, note)
      card.appendChild(info)
    } else {
      const badge = document.createElement('div')
      badge.className = 'expired-badge'
      badge.textContent = '💀 EXPIRED'

      const name = document.createElement('div')
      name.className = 'grave-name'
      name.textContent = g.name  // safe: textContent not innerHTML

      const xpNote = document.createElement('div')
      xpNote.className = 'reclaim-xp'
      xpNote.textContent = `reclaim → +${XP_PER_RECLAIM} XP · ${reclaimLabel} timer`

      const actions = document.createElement('div')
      actions.className = 'grave-actions'

      const reclaimBtn = document.createElement('button')
      reclaimBtn.className = 'reclaim-btn'
      reclaimBtn.textContent = 'RECLAIM'
      reclaimBtn.addEventListener('click', () => reclaimMission(g.id, g.name, reclaimMs))

      actions.appendChild(reclaimBtn)
      info.append(badge, name, xpNote)
      card.append(info, actions)
    }

    container.appendChild(card)
  })
}

function formatDuration(ms) {
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  if (h > 0 && m > 0) return `${h}h ${m}m`
  if (h > 0) return `${h}h`
  return `${m}m`
}

// FIX: Reclaim race condition — wait for expireMission's animation to fully clear before launching
function reclaimMission(id, name, durationMs) {
  const alreadyActive = (data.missions || []).find(m => m.active)
  if (alreadyActive) {
    showConfirm('Abandon your current mission and reclaim this one?', () => {
      expireMission(alreadyActive)
      // Wait for the full explosion + overlay sequence before launching the reclaim
      setTimeout(() => doReclaim(id, name, durationMs), 2200)
    })
    return
  }
  doReclaim(id, name, durationMs)
}

function doReclaim(id, name, durationMs) {
  data.graveyard = (data.graveyard || []).filter(g => g.id !== id)
  saveData()
  renderGraveyard()
  launchMissionData(name, durationMs, true)
}

// ═══ SETTINGS ═════════════════════════════════════════════════════════
function showSettings() {
  const s = data.settings || {}
  document.getElementById('setting-post-levelup').checked  = !!s.autoPostLevelup
  document.getElementById('setting-post-complete').checked = !!s.autoPostComplete
  document.getElementById('setting-post-shame').checked    = !!s.autoPostShame
  document.getElementById('stats-streak').textContent     = data.streak || 0
  document.getElementById('stats-xp').textContent         = data.xp || 0
  document.getElementById('stats-completed').textContent  = data.totalCompleted || 0
  showScreen('settings-screen')
}

function saveSettings() {
  data.settings = data.settings || {}
  data.settings.autoPostLevelup  = document.getElementById('setting-post-levelup').checked
  data.settings.autoPostComplete = document.getElementById('setting-post-complete').checked
  data.settings.autoPostShame    = document.getElementById('setting-post-shame').checked
  saveData()
}

// ═══ OVERLAYS ═════════════════════════════════════════════════════════
function showLevelUp() {
  document.getElementById('new-level').textContent = data.level
  document.getElementById('levelup-overlay').classList.remove('hidden')
  playLevelUp()
  const positions = [[120,200],[360,180],[80,350],[460,300],[290,150],[200,400],[380,380]]
  positions.forEach(([x,y], i) => setTimeout(() => fireworksBurst(x, y, 35), i * 200))
  addConfetti(290, 425, 120)

  // FIX: Auto-post level-up without skipping the overlay — post AND show overlay
  if (data.settings && data.settings.autoPostLevelup) {
    postToX(`Just hit Level ${data.level} on FUSE! 🔥 Day ${data.streak} streak. ADHD brain on FIRE. #FUSE #ADHD`)
    // Hide the manual post button since we already posted — no double-posting
    document.getElementById('post-levelup-btn').style.display = 'none'
    // Auto-dismiss after the fireworks
    setTimeout(() => {
      document.getElementById('levelup-overlay').classList.add('hidden')
      document.getElementById('post-levelup-btn').style.display = ''
    }, 4000)
  }
}

function showMissionComplete(xp) {
  document.getElementById('xp-earned').textContent = `+${xp} XP`
  document.getElementById('complete-mission-name').textContent = `"${lastCompletedName}"`
  document.getElementById('complete-overlay').classList.remove('hidden')
  setTimeout(() => fireworksBurst(290, 300, 25), 100)
  setTimeout(() => fireworksBurst(120, 350, 20), 300)
  setTimeout(() => fireworksBurst(460, 280, 20), 450)
}

function showGraveyardOverlay() {
  document.getElementById('grave-mission-name').textContent = `"${lastFailedName}"`
  document.getElementById('graveyard-overlay').classList.remove('hidden')
  for (let i = 0; i < 8; i++) {
    setTimeout(() => addAsh(100 + Math.random() * 380, 200 + Math.random() * 200, 10), i * 150)
  }
}

// ═══ UTILS ════════════════════════════════════════════════════════════
function postToX(text) { ipcRenderer.invoke('open-x', text) }
function saveData()    { ipcRenderer.invoke('save-data', data) }

// ═══ EVENTS ═══════════════════════════════════════════════════════════
window.nextOnboard   = nextOnboard
window.finishOnboard = finishOnboard
window.setTheme      = setTheme

document.getElementById('enter-btn').addEventListener('click', () => {
  if (needsIgnition()) startIgnitionRitual()
  else enterApp()
})
document.getElementById('ignition-btn').addEventListener('click', confirmIgnition)
document.getElementById('ignition-skip').addEventListener('click', skipIgnition)
document.getElementById('ignition-input').addEventListener('keydown', e => { if (e.key === 'Enter') confirmIgnition() })
document.getElementById('close-btn').addEventListener('click', () => ipcRenderer.invoke('quit-app'))
document.getElementById('settings-btn').addEventListener('click', showSettings)

document.getElementById('add-mission-btn').addEventListener('click', () => {
  document.getElementById('add-mission-form').classList.remove('hidden')
  setTimeout(() => document.getElementById('mission-input').focus(), 50)
})
document.getElementById('launch-btn').addEventListener('click', launchMission)
document.getElementById('cancel-btn').addEventListener('click', () => {
  document.getElementById('add-mission-form').classList.add('hidden')
})
document.getElementById('mission-input').addEventListener('keydown', e => { if (e.key === 'Enter') launchMission() })
document.getElementById('complete-btn').addEventListener('click', completeMission)
document.getElementById('fuse-btn').addEventListener('click', useEmergencyFuse)
document.getElementById('abandon-btn').addEventListener('click', abandonMission)

document.getElementById('settings-back').addEventListener('click', () => {
  saveSettings(); applyTheme(); showScreen('main-screen')
})
;['setting-post-levelup','setting-post-complete','setting-post-shame'].forEach(id => {
  document.getElementById(id).addEventListener('change', saveSettings)
})
document.getElementById('reset-btn').addEventListener('click', () => {
  showConfirm('Reset ALL data? This cannot be undone.', () => {
    data = { onboardingDone: true, settings: data.settings }
    saveData()
    checkStreak()
    showLoginScreen()
  })
})

document.getElementById('post-levelup-btn').addEventListener('click', () => {
  postToX(`Just hit Level ${data.level} on FUSE! 🔥 Day ${data.streak} streak. ADHD brain on FIRE. #FUSE #ADHD #BuildingMomentum`)
  document.getElementById('levelup-overlay').classList.add('hidden')
})
document.getElementById('skip-levelup-btn').addEventListener('click', () => {
  document.getElementById('levelup-overlay').classList.add('hidden')
})

document.getElementById('post-complete-btn').addEventListener('click', () => {
  postToX(`Mission complete on FUSE! 🔥 "${lastCompletedName}" — DONE. Day ${data.streak} streak. ${data.todayWins} win${data.todayWins !== 1 ? 's' : ''} today. #FUSE #ADHD`)
  document.getElementById('complete-overlay').classList.add('hidden')
})
document.getElementById('skip-complete-btn').addEventListener('click', () => {
  document.getElementById('complete-overlay').classList.add('hidden')
})

document.getElementById('post-shame-btn').addEventListener('click', () => {
  postToX(`Mission expired on FUSE. 💀 "${lastFailedName}" is in the graveyard. Reclaiming it. #FUSE #ADHD #Accountability`)
  document.getElementById('graveyard-overlay').classList.add('hidden')
})
document.getElementById('skip-shame-btn').addEventListener('click', () => {
  document.getElementById('graveyard-overlay').classList.add('hidden')
})

document.getElementById('confirm-yes').addEventListener('click', () => {
  document.getElementById('confirm-overlay').classList.add('hidden')
  if (confirmCallback) { confirmCallback(); confirmCallback = null }
})
document.getElementById('confirm-no').addEventListener('click', () => {
  document.getElementById('confirm-overlay').classList.add('hidden')
  confirmCallback = null
})

document.getElementById('focus-launch-btn').addEventListener('click', () => {
  if (!data.todayFocus) return
  const active = (data.missions || []).find(m => m.active)
  if (active) {
    showConfirm('Abandon current mission and launch your focus mission?', () => {
      expireMission(active, true)
      setTimeout(() => launchMissionData(data.todayFocus, 3600000), 100)
    })
  } else {
    launchMissionData(data.todayFocus, 3600000)
  }
})

// ═══ START ════════════════════════════════════════════════════════════
init()
