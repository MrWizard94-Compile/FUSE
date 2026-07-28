const { app, BrowserWindow, ipcMain, shell } = require('electron')
const path = require('path')
const fs = require('fs')

// Data file location
const dataPath = path.join(app.getPath('userData'), 'fuse_data.json')

const DEFAULT_DATA = {
  streak: 0,
  lastLogin: null,
  xp: 0,
  level: 1,
  missions: [],
  graveyard: []
}

// Load or initialize data - with corruption protection
function loadData() {
  try {
    if (fs.existsSync(dataPath)) {
      const raw = fs.readFileSync(dataPath, 'utf8')
      const parsed = JSON.parse(raw)
      // Basic sanity check - must be an object
      if (parsed && typeof parsed === 'object') return parsed
    }
  } catch(e) {
    // Corrupted save - back it up and start fresh
    try {
      const backupPath = dataPath + '.corrupted.' + Date.now()
      fs.copyFileSync(dataPath, backupPath)
    } catch(_) {}
  }
  return { ...DEFAULT_DATA }
}

function saveData(data) {
  try {
    fs.writeFileSync(dataPath, JSON.stringify(data, null, 2))
  } catch(e) {
    console.error('Failed to save data:', e)
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 580,
    height: 980,
    resizable: false,
    frame: false,
    icon: path.join(__dirname, 'Icon.ico'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    backgroundColor: '#0a0a0a'
  })

  win.loadFile('index.html')
}

app.whenReady().then(() => {
  createWindow()
})

app.on('window-all-closed', () => {
  app.quit()
})

// IPC handlers - communication between frontend and backend
ipcMain.handle('load-data', () => loadData())
ipcMain.handle('save-data', (event, data) => {
  saveData(data)
  return true
})
ipcMain.handle('open-x', (event, text) => {
  const encoded = encodeURIComponent(text)
  shell.openExternal(`https://twitter.com/intent/tweet?text=${encoded}`)
})
ipcMain.handle('quit-app', () => app.quit())
