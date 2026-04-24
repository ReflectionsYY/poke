const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const { createHash } = require("node:crypto");

const SIGNALING_URL = process.env.SIGNALING_URL || "ws://localhost:8443";

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: "Remote Desktop Viewer",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, "renderer.html"));
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("viewer:signaling-url", () => SIGNALING_URL);
ipcMain.handle("viewer:hash-passcode", (_evt, passcode) =>
  createHash("sha256").update(String(passcode)).digest("hex")
);
