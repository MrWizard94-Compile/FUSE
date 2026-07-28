// Run with: node download-sounds.js
// Downloads free sound effects for FUSE from public sources

const https = require('https')
const http  = require('http')
const fs    = require('fs')
const path  = require('path')

const dir = path.join(__dirname, 'sounds')
if (!fs.existsSync(dir)) fs.mkdirSync(dir)

// Free sounds from Mixkit (no API key needed, direct MP3 links)
const sounds = [
  {
    file: 'whoosh.mp3',
    url: 'https://assets.mixkit.co/active_storage/sfx/2649/2649-preview.mp3',
    label: 'Whoosh (launch)'
  },
  {
    file: 'complete.mp3',
    url: 'https://assets.mixkit.co/active_storage/sfx/2013/2013-preview.mp3',
    label: 'Complete (mission done)'
  },
  {
    file: 'fail.mp3',
    url: 'https://assets.mixkit.co/active_storage/sfx/2955/2955-preview.mp3',
    label: 'Fail (mission expired)'
  },
  {
    file: 'levelup.mp3',
    url: 'https://assets.mixkit.co/active_storage/sfx/1435/1435-preview.mp3',
    label: 'Level up'
  },
  {
    file: 'tick.mp3',
    url: 'https://assets.mixkit.co/active_storage/sfx/2571/2571-preview.mp3',
    label: 'Tick (ignition countdown)'
  },
  {
    file: 'alarm.mp3',
    url: 'https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3',
    label: 'Alarm (urgent countdown)'
  },
]

function download(url, dest, label) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest)
    const client = url.startsWith('https') ? https : http

    client.get(url, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        // Follow redirect
        file.close()
        fs.unlinkSync(dest)
        download(res.headers.location, dest, label).then(resolve).catch(reject)
        return
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${label}`))
        return
      }
      res.pipe(file)
      file.on('finish', () => {
        file.close()
        const size = fs.statSync(dest).size
        console.log(`✓ ${label} → sounds/${path.basename(dest)} (${(size/1024).toFixed(1)}kb)`)
        resolve()
      })
    }).on('error', err => {
      fs.unlink(dest, () => {})
      reject(err)
    })
  })
}

async function run() {
  console.log('Downloading FUSE sounds...\n')
  for (const s of sounds) {
    const dest = path.join(dir, s.file)
    try {
      await download(s.url, dest, s.label)
    } catch(e) {
      console.error(`✗ Failed: ${s.label} — ${e.message}`)
    }
  }
  console.log('\nDone! Restart FUSE to hear the sounds.')
}

run()
