import { app, BrowserWindow, ipcMain, desktopCapturer, screen } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createHash, randomInt } from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Lazy-load nut-js so the app still starts on machines where the optional
// native deps failed to build; input injection will just no-op in that case.
let nut = null;
async function loadNut() {
  if (nut) return nut;
  try {
    nut = await import("@nut-tree-fork/nut-js");
    nut.keyboard.config.autoDelayMs = 0;
    nut.mouse.config.autoDelayMs = 0;
    return nut;
  } catch (err) {
    console.error("[host] nut-js unavailable, input injection disabled:", err);
    nut = { disabled: true };
    return nut;
  }
}

const SIGNALING_URL =
  process.env.SIGNALING_URL || "ws://localhost:8443";

function sha256Hex(s) {
  return createHash("sha256").update(s).digest("hex");
}

function newPasscode() {
  // 6 digits, zero-padded.
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 520,
    height: 640,
    resizable: false,
    title: "Remote Desktop Host",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, "renderer.html"));
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// ---------------------------------------------------------------------------
// IPC bridge used by the renderer (which owns the WebRTC peer connection)
// ---------------------------------------------------------------------------

ipcMain.handle("host:new-credentials", () => {
  const passcode = newPasscode();
  return { passcode, passcodeHash: sha256Hex(passcode) };
});

ipcMain.handle("host:signaling-url", () => SIGNALING_URL);

ipcMain.handle("host:list-sources", async () => {
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width: 160, height: 90 },
  });
  return sources.map((s) => ({
    id: s.id,
    name: s.name,
    thumbnail: s.thumbnail.toDataURL(),
  }));
});

ipcMain.handle("host:primary-display-size", () => {
  const d = screen.getPrimaryDisplay();
  return { width: d.size.width, height: d.size.height };
});

// ---------------------------------------------------------------------------
// Input injection. Called from the renderer when a message arrives on the
// "input" data channel from the viewer. All coordinates the viewer sends are
// normalized to [0, 1] against the captured display size; we denormalize here.
// ---------------------------------------------------------------------------

const BUTTON_MAP = () => ({
  left: nut.Button.LEFT,
  right: nut.Button.RIGHT,
  middle: nut.Button.MIDDLE,
});

ipcMain.handle("host:inject", async (_evt, event) => {
  await loadNut();
  if (nut.disabled) return { ok: false, reason: "nut-js unavailable" };

  try {
    switch (event.type) {
      case "mouse-move": {
        const d = screen.getPrimaryDisplay().size;
        const x = Math.round(event.xNorm * d.width);
        const y = Math.round(event.yNorm * d.height);
        await nut.mouse.setPosition(new nut.Point(x, y));
        break;
      }
      case "mouse-button": {
        const btn = BUTTON_MAP()[event.button];
        if (btn == null) break;
        if (event.state === "down") await nut.mouse.pressButton(btn);
        else await nut.mouse.releaseButton(btn);
        break;
      }
      case "mouse-wheel": {
        if (event.dy) {
          if (event.dy > 0) await nut.mouse.scrollDown(Math.abs(event.dy));
          else await nut.mouse.scrollUp(Math.abs(event.dy));
        }
        if (event.dx) {
          if (event.dx > 0) await nut.mouse.scrollRight(Math.abs(event.dx));
          else await nut.mouse.scrollLeft(Math.abs(event.dx));
        }
        break;
      }
      case "key": {
        const key = codeToNutKey(event.code, nut);
        if (key == null) break;
        if (event.state === "down") await nut.keyboard.pressKey(key);
        else await nut.keyboard.releaseKey(key);
        break;
      }
      case "text": {
        await nut.keyboard.type(String(event.value ?? ""));
        break;
      }
    }
    return { ok: true };
  } catch (err) {
    console.error("[host] inject failed:", err);
    return { ok: false, reason: String(err) };
  }
});

// Map a DOM KeyboardEvent.code to a nut-js Key enum value. Covers the common
// cases; unknown codes are dropped rather than guessed.
function codeToNutKey(code, nut) {
  const K = nut.Key;
  if (!code) return null;
  if (/^Key[A-Z]$/.test(code)) return K[code.slice(3)];
  if (/^Digit[0-9]$/.test(code)) return K["Num" + code.slice(5)];
  if (/^Numpad[0-9]$/.test(code)) return K["NumPad" + code.slice(6)];
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return K[code];
  const direct = {
    Enter: K.Enter,
    Escape: K.Escape,
    Backspace: K.Backspace,
    Tab: K.Tab,
    Space: K.Space,
    ArrowUp: K.Up,
    ArrowDown: K.Down,
    ArrowLeft: K.Left,
    ArrowRight: K.Right,
    Home: K.Home,
    End: K.End,
    PageUp: K.PageUp,
    PageDown: K.PageDown,
    Delete: K.Delete,
    Insert: K.Insert,
    ShiftLeft: K.LeftShift,
    ShiftRight: K.RightShift,
    ControlLeft: K.LeftControl,
    ControlRight: K.RightControl,
    AltLeft: K.LeftAlt,
    AltRight: K.RightAlt,
    MetaLeft: K.LeftSuper,
    MetaRight: K.RightSuper,
    CapsLock: K.CapsLock,
    Minus: K.Minus,
    Equal: K.Equal,
    BracketLeft: K.LeftBracket,
    BracketRight: K.RightBracket,
    Backslash: K.Backslash,
    Semicolon: K.Semicolon,
    Quote: K.Quote,
    Comma: K.Comma,
    Period: K.Period,
    Slash: K.Slash,
    Backquote: K.Grave,
  };
  return direct[code] ?? null;
}
