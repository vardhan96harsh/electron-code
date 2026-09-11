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
import fs from "node:fs";   // ⭐ ADD THIS




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
  "http://13.201.46.13";

let mainWindow = null;
let overlayWindow = null;
let tray = null;
let overlayAllowed = false; // only true for employee role
let isTimerRunning = false; // only true when a session is active/paused

let overlayBounds = store.get("overlayBounds") || null;
let overlayUserMoved = false;
let isQuitting = false;
const isDev = () => !app.isPackaged;

/* ---------- app icon helper ---------- */
function getAppIcon() {
  const candidates = [
    path.join(__dirname, "build", "icon.ico"),
    path.join(__dirname, "build", "icon.png"),
    path.join(__dirname, "frontend-dist", "favicon.png"),
    path.join(process.resourcesPath || "", "build", "icon.ico"),
    path.join(process.resourcesPath || "", "build", "icon.png"),
    path.join(process.resourcesPath || "", "app.asar", "build", "icon.ico"),
    path.join(process.resourcesPath || "", "app.asar", "build", "icon.png"),
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch {}
  }
  return undefined;
}

/* ---------- main window ---------- */
function createWindow() {
  const iconPath = getAppIcon();
  console.log("RESOLVED ICON PATH:", iconPath);
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: "Work Tracker",
    icon: iconPath,
    show: false,
    backgroundColor: "#0f172a",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
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
      return;
    }

    // 🔒 USER CANNOT CLOSE APP - ONLY MINIMIZE:
    // Intercept "X" button & Alt+F4 -> minimize to taskbar instead of closing
    e.preventDefault();
    mainWindow.minimize();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  wireOverlayVisibility();
}

/* ---------- show main window helper ---------- */
function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  if (!mainWindow.isVisible()) {
    mainWindow.show();
  }

  // Force window to foreground on Windows OS
  mainWindow.setAlwaysOnTop(true);
  mainWindow.show();
  mainWindow.focus();
  mainWindow.setAlwaysOnTop(false);

  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.hide();
  }
}

/* ---------- tray ---------- */
function setupTray() {
  try {
    const iconPath = getAppIcon();
    if (!iconPath) {
      console.warn("Tray icon not found, skipping tray setup");
      return;
    }
    const icon = nativeImage.createFromPath(iconPath);
    if (!icon || icon.isEmpty()) return;

    tray = new Tray(icon);
    const menu = Menu.buildFromTemplate([
      {
        label: "Open Work Tracker",
        click: () => showMainWindow(),
      },
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]);
    tray.setToolTip("Work Tracker");
    tray.setContextMenu(menu);
    tray.on("click", () => showMainWindow());
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
  if (overlayWindow && !overlayWindow.isDestroyed()) return overlayWindow;

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
    icon: getAppIcon(),

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
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.on("minimize", () => {
    // ⏱️ ONLY open overlay if timer is running!
    if (!overlayAllowed || !isTimerRunning) return;
    const ow = createOverlayWindow();
    ow?.show();
  });
  mainWindow.on("hide", () => {
    // ⏱️ ONLY open overlay if timer is running!
    if (!overlayAllowed || !isTimerRunning) return;
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

// 🚀 High-Performance Switches: Smooth 60fps rendering, hardware acceleration, and memory stability
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.commandLine.appendSwitch("enable-gpu-rasterization");
app.commandLine.appendSwitch("enable-zero-copy");
app.commandLine.appendSwitch("disable-renderer-backgrounding");

// 🚀 Single instance lock: Prevents multiple instances from running at the same time
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  console.log("⚠️ Another instance of Work Tracker is already running. Quitting.");
  app.quit();
} else {
  app.on("second-instance", () => {
    // When someone tries to launch a second instance (e.g. desktop shortcut), show and focus main window
    showMainWindow();
  });

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);

    overlayAllowed = true;
    await registerMachineIfNeeded();
    createWindow();
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

  // 🔥 OS IDLE / ACTIVE DETECTION (Strict 5 minutes)
  const IDLE_THRESHOLD_SECONDS = 5 * 60; // 5 minutes
  let wasIdle = false;

  setInterval(() => {
    const idleSeconds = powerMonitor.getSystemIdleTime();

    // Just became idle (after 5 full minutes of no mouse/keyboard activity)
    if (!wasIdle && idleSeconds >= IDLE_THRESHOLD_SECONDS) {
      wasIdle = true;
      console.log("System idle (5 min) → sending system:idle to all windows");
      const all = BrowserWindow.getAllWindows();
      for (const win of all) {
        if (!win.isDestroyed()) {
          win.webContents.send("system:idle");
        }
      }
    }

    // Became active again: user moved mouse or typed (idleSeconds dropped)
    if (wasIdle && idleSeconds < 10) {
      wasIdle = false;
      console.log("System active → sending system:active to all windows");
      const all = BrowserWindow.getAllWindows();
      for (const win of all) {
        if (!win.isDestroyed()) {
          win.webContents.send("system:active");
        }
      }
    }
  }, 2_000);

  globalShortcut.register("Ctrl+Shift+o", () => {
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
}

app.on("before-quit", () => {
  isQuitting = true;
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  showMainWindow();
});

/* ---------- IPC ---------- */
ipcMain.handle("config:get", async () => {
  const machine = store.get("machine") || {};
  return { SERVER_URL, machine };
});

ipcMain.handle("main:show", async () => {
  showMainWindow();
  return true;
});

ipcMain.handle("overlay:setEnabled", async (_evt, enabled) => {
  overlayAllowed = !!enabled;
  if (!overlayAllowed && overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.hide();
  }
  return overlayAllowed;
});

ipcMain.handle("timer:setRunning", async (_evt, running) => {
  isTimerRunning = !!running;
  if (!isTimerRunning && overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.hide();
  }
  if (isTimerRunning && overlayAllowed && mainWindow && (!mainWindow.isVisible() || mainWindow.isMinimized())) {
    const ow = createOverlayWindow();
    ow?.show();
  }
  return isTimerRunning;
});

// ⏰ Focus window & flash taskbar when 10-minute idle timer reminder triggers
ipcMain.handle("timer:alertReminder", async () => {
  showMainWindow();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.flashFrame(true);
  }
  return true;
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
  if (isQuitting && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.close();
  }
});
