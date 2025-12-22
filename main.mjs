/* electron/main.mjs (ESM) */
import {
  app,
  BrowserWindow,
  ipcMain,
  Tray,
  Menu,
  nativeImage,
  screen,
  powerMonitor,
    globalShortcut,
} from "electron";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import os from "node:os";
import Store from "electron-store";
import machineIdPkg from "node-machine-id";



const { machineIdSync } = machineIdPkg;

/* --- resolve __dirname / __filename --- */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* --- persistent store --- */
const store = new Store({ name: "worktracker" });

/* --- server URL (dev/prod) --- */
const SERVER_URL =
  process.env.WORKTRACKER_SERVER_URL ||
  process.env.VITE_SERVER_URL ||
  "http://13.233.100.51";

let mainWindow = null;
let overlayWindow = null;
let tray = null;
let overlayAllowed = false; // only true for employee role

let overlayBounds = store.get("overlayBounds") || null;
let overlayUserMoved = false;
let isQuitting = false;
const isDev = () => !app.isPackaged;

/* ---------- main window ---------- */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: "Work Tracker",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev()) {
    mainWindow.loadURL("http://localhost:5175");
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    const indexPath = path.join(__dirname, "frontend-dist", "index.html");
    mainWindow.loadFile(indexPath);
  }


    mainWindow.on("close", (e) => {
    if (isQuitting) {
      // already confirmed from renderer, allow close
      return;
    }

    // stop immediate close
    e.preventDefault();

    // tell renderer "app is closing"
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send("app:closing");
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

/* ---------- tray ---------- */
function setupTray() {
  try {
    const iconPath = path.join(__dirname, "build", "icon.png");
    const icon = nativeImage.createFromPath(iconPath);
    if (!icon || icon.isEmpty()) return;

    tray = new Tray(icon);
    const menu = Menu.buildFromTemplate([
      {
        label: "Open Work Tracker",
        click: () => (mainWindow ? mainWindow.show() : createWindow()),
      },
      { type: "separator" },
      { label: "Quit", click: () => app.quit() },
    ]);
    tray.setToolTip("Work Tracker");
    tray.setContextMenu(menu);
    tray.on("click", () => (mainWindow ? mainWindow.show() : createWindow()));
  } catch (e) {
    console.warn("Tray not set:", e?.message || e);
  }
}

/* ---------- machine register ---------- */
async function registerMachineIfNeeded() {
  let machine = store.get("machine");
  if (machine?.machineToken) return machine;

  const payload = {
    machineId: machineIdSync({ original: true }),
    hostname: os.hostname(),
    platform: `${process.platform} ${process.arch}`,
    user: os.userInfo().username,
    mac: "",
    agentVersion: "desktop-1.0.0",
  };

  try {
    const res = await fetch(`${SERVER_URL}/api/machines/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok)
      throw new Error(`Register failed: ${res.status} ${JSON.stringify(data)}`);

    const machineToken = data.machineToken || data.token;
    if (!machineToken) throw new Error("No machineToken in response");

    machine = { ...payload, machineToken };
    store.set("machine", machine);
    return machine;
  } catch (e) {
    console.error("Machine register error:", e.message);
    return null;
  }
}

/* ---------- overlay helpers ---------- */
function getTopRightPosition(width, height) {
  const { workArea } = screen.getPrimaryDisplay();
  return {
    x: workArea.x + workArea.width - width - 16,
    y: workArea.y + 16,
  };
}

function positionOverlayTopRight() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  if (overlayUserMoved) return;
  const [w, h] = overlayWindow.getSize();
  const pos = getTopRightPosition(w, h);
  overlayWindow.setPosition(pos.x, pos.y);
}

function createOverlayWindow() {
  if (!overlayAllowed) return null;
  if (overlayWindow) return overlayWindow;

 const defaultSize = { width: 180, height: 28 };

  const pos = overlayBounds
    ? { x: overlayBounds.x, y: overlayBounds.y }
    : getTopRightPosition(defaultSize.width, defaultSize.height);

  overlayWindow = new BrowserWindow({
    ...defaultSize,
    ...pos,
    frame: false,
    resizable: false,
    movable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
  
    focusable: true,
    transparent: true,      // ✅ IMPORTANT
  backgroundColor: "#00000000", // ✅ transparent bg
    title: "Work Tracker Overlay",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev()) {
    overlayWindow.loadURL("http://localhost:5175/#/overlay");
  } else {
    const indexPath = path.join(__dirname, "frontend-dist", "index.html");
    const fileUrl = pathToFileURL(indexPath).toString() + "#/overlay";
    overlayWindow.loadURL(fileUrl);
  }

  overlayWindow.once("ready-to-show", () => {
    if (!overlayBounds) positionOverlayTopRight();
  });

  overlayWindow.on("moved", () => {
    overlayUserMoved = true;
    overlayBounds = overlayWindow.getBounds();
    store.set("overlayBounds", overlayBounds);
  });
  overlayWindow.on("resized", () => {
    overlayBounds = overlayWindow.getBounds();
    store.set("overlayBounds", overlayBounds);
  });

  overlayWindow.on("closed", () => {
    overlayWindow = null;
  });

  return overlayWindow;
}

function wireOverlayVisibility() {
  if (!mainWindow) return;
  mainWindow.on("minimize", () => {
    if (!overlayAllowed) return;
    const ow = createOverlayWindow();
    ow?.show();
  });
  const hideOverlay = () => {
    if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.hide();
  };
  mainWindow.on("restore", hideOverlay);
  mainWindow.on("show", hideOverlay);
  mainWindow.on("focus", hideOverlay);
}

/* ---------- app lifecycle ---------- */
if (!app.isPackaged) {
  process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = "true";
}

app.whenReady().then(async () => {
  await registerMachineIfNeeded();
  createWindow();
  wireOverlayVisibility();
  setupTray();
  app.setLoginItemSettings({ openAtLogin: true });

  // 🔥 BROADCAST SYSTEM SLEEP / LOCK TO ALL WINDOWS
  const broadcastSleep = () => {
    console.log("System sleep/lock → sending system:sleep to all windows");
    const all = BrowserWindow.getAllWindows();
    for (const win of all) {
      if (!win.isDestroyed()) {
        win.webContents.send("system:sleep");
      }
    }
  };

  powerMonitor.on("suspend", broadcastSleep);
  powerMonitor.on("lock-screen", broadcastSleep);

  // 🔥 BROADCAST SYSTEM WAKE / UNLOCK TO ALL WINDOWS
  const broadcastWake = () => {
    console.log("System resume/unlock → sending system:wake to all windows");
    const all = BrowserWindow.getAllWindows();
    for (const win of all) {
      if (!win.isDestroyed()) {
        win.webContents.send("system:wake");
      }
    }
  };

  powerMonitor.on("resume", broadcastWake);
  powerMonitor.on("unlock-screen", broadcastWake);

  // 🔥 NEW: OS IDLE / ACTIVE DETECTION (5 min)
  const IDLE_THRESHOLD_SECONDS = 5 * 60; // 5 minutes
  let wasIdle = false;

  setInterval(() => {
    const idleSeconds = powerMonitor.getSystemIdleTime();
      console.log("OS idle seconds:", idleSeconds);  

    // Just became idle
    if (!wasIdle && idleSeconds >= IDLE_THRESHOLD_SECONDS) {
      wasIdle = true;
      console.log("System idle → sending system:idle to all windows");
      const all = BrowserWindow.getAllWindows();
      for (const win of all) {
        if (!win.isDestroyed()) {
          win.webContents.send("system:idle");
        }
      }
    }

    // Became active again
    if (wasIdle && idleSeconds < 4) {
      wasIdle = false;
      console.log("System active → sending system:active to all windows");
      const all = BrowserWindow.getAllWindows();
      for (const win of all) {
        if (!win.isDestroyed()) {
          win.webContents.send("system:active");
        }
      }
    }
  }, 5_000);

 globalShortcut.register("Ctrl+Shift+T", () => {
  if (!overlayAllowed) return;

  // ✅ ensure overlay exists
  const ow = createOverlayWindow();
  if (!ow) return;

  const { workArea } = screen.getPrimaryDisplay();

  ow.setAlwaysOnTop(true, "screen-saver");
  ow.setPosition(
    workArea.x + workArea.width - 320,
    workArea.y + workArea.height - 120
  );
  ow.show();
  ow.focus();
});


});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});


app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

/* ---------- IPC ---------- */
ipcMain.handle("config:get", async () => {
  const machine = store.get("machine") || {};
  return { SERVER_URL, machine };
});

ipcMain.handle("main:show", async () => {
  if (!mainWindow) {
    createWindow();
  } else {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.hide();
  return true;
});

ipcMain.handle("overlay:setEnabled", async (_evt, enabled) => {
  overlayAllowed = !!enabled;
  if (!overlayAllowed && overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.hide();
  }
  return overlayAllowed;
});

ipcMain.handle("overlay:resize", (_evt, { width, height }) => {
  if (!overlayWindow || overlayWindow.isDestroyed()) return false;

  const w = Math.max(140, Math.min(200, Math.floor(width || 150)));
 const h = Math.max(28, Math.min(40, Math.floor(height || 28)));


  overlayWindow.setSize(w, h, true);

  overlayBounds = overlayWindow.getBounds();
  store.set("overlayBounds", overlayBounds);

  return true;
});

// Broadcast from any renderer → all renderer windows
ipcMain.on("sessions:changed", () => {
  const all = BrowserWindow.getAllWindows();
  for (const win of all) {
    if (!win.isDestroyed()) {
      win.webContents.send("sessions:changed");
    }
  }
});

ipcMain.on("app:confirm-close", () => {
  isQuitting = true;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.close(); // this time "close" will not be prevented
  }
});
