const path = require('path')

function play(file, volume = 1.0) {
  try {
    const audio = new Audio(path.join(__dirname, 'sounds', file))
    audio.volume = Math.min(1, Math.max(0, volume))
    audio.play().catch(() => {})
    return audio
  } catch(e) {}
}

function playIgnite()   { play('whoosh.mp3',    0.85) }
function playComplete() { play('complete.mp3',  0.8)  }
function playFail()     { play('fail.mp3',      0.75) }
function playLevelUp()  { play('levelup.wav',   0.9)  }  // mp3 was 0 bytes, wav works
function playTick(urgent = false) {
  // tick.mp3 was 0 bytes - use wav variants
  play(urgent ? 'tick-urgent.wav' : 'tick.wav', urgent ? 0.6 : 0.35)
}
function playAlarm()    { play('alarm.mp3',     0.6)  }

module.exports = { playIgnite, playComplete, playFail, playLevelUp, playTick, playAlarm }
