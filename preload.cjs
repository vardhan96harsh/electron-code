/* electron/preload.cjs */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("worktracker", {
  // config / API base
  getConfig: () => ipcRenderer.invoke("config:get"),

  // show main window from overlay
  openMain: () => ipcRenderer.invoke("main:show"),

  // overlay helpers
  setOverlayEnabled: (enabled) =>
    ipcRenderer.invoke("overlay:setEnabled", !!enabled),
  setTimerRunning: (running) =>
    ipcRenderer.invoke("timer:setRunning", !!running),
  alertTimerReminder: () => ipcRenderer.invoke("timer:alertReminder"),
  resizeOverlay: (size) => ipcRenderer.invoke("overlay:resize", size),

  // sessions broadcast
  notifySessionsChanged: () => ipcRenderer.send("sessions:changed"),

  onSessionsChanged: (handler) => {
    const fn = () => handler && handler();
    ipcRenderer.on("sessions:changed", fn);
    return () => ipcRenderer.removeListener("sessions:changed", fn);
  },

  // 🔥 system sleep / wake
  onSystemSleep: (handler) => {
    const fn = () => handler && handler();
    ipcRenderer.on("system:sleep", fn);
    return () => ipcRenderer.removeListener("system:sleep", fn);
  },

  onSystemWake: (handler) => {
    const fn = () => handler && handler();
    ipcRenderer.on("system:wake", fn);
    return () => ipcRenderer.removeListener("system:wake", fn);
  },

  // 🔥 NEW: system idle / active
  onSystemIdle: (handler) => {
    const fn = () => handler && handler();
    ipcRenderer.on("system:idle", fn);
    return () => ipcRenderer.removeListener("system:idle", fn);
  },

  onSystemActive: (handler) => {
    const fn = () => handler && handler();
    ipcRenderer.on("system:active", fn);
    return () => ipcRenderer.removeListener("system:active", fn);
  },



  // 🔥 NEW: APP CLOSE HOOKS (👇 ADD FROM HERE)
  onAppClosing: (handler) => {
    if (typeof handler !== "function") return;
    const fn = () => handler();
    ipcRenderer.on("app:closing", fn);
    // return unsubscribe
    return () => ipcRenderer.removeListener("app:closing", fn);
  },

  confirmAppClose: () => {
    ipcRenderer.send("app:confirm-close");
  },
  // 🔥 NEW: APP CLOSE HOOKS END
});
