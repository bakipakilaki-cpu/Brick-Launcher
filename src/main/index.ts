import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { ensureDirs } from './paths.js'
import { store } from './store.js'
import { registerIpc, stopAllGames } from './ipc.js'
import { integrateLinuxDesktop } from './linuxDesktop.js'

const isDev = !app.isPackaged

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1000,
    minHeight: 640,
    show: false,
    backgroundColor: '#0f1115',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    // Leave room for the traffic lights inside our own header bar.
    trafficLightPosition: { x: 16, y: 18 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  win.once('ready-to-show', () => win.show())

  // Anchor tags with target=_blank go to the system browser, never a new window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

app.whenReady().then(() => {
  ensureDirs()
  store.load()
  registerIpc()
  createWindow()

  // On Linux the AppImage/tar.gz builds have no installer, so add the menu
  // entry and desktop shortcut ourselves. Runs once, then leaves the user alone.
  void integrateLinuxDesktop()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', stopAllGames)
