# Remote Desktop (Windows MVP)

Consent-based remote desktop tool, modelled on how AnyDesk / TeamViewer /
Chrome Remote Desktop work. The person being controlled (the **host**) must
explicitly share a session ID + one-time passcode and then click **Accept**
before any viewer can see their screen, and a red banner stays on-screen for
the duration of the session.

This is an MVP. It is **not** a drop-in AnyDesk replacement — see
[Limitations](#limitations).

## Architecture

```
  Host (Windows)                 Signaling server                 Viewer
  ─────────────                  ────────────────                  ──────
  Electron app          ──WS──►  Node + ws         ◄──WS──        Electron app
  (screen capture,               (pairs a host and                 (displays remote
   input injection via           a viewer by                        screen, forwards
   nut-js, consent UI)           session ID +                       mouse / keyboard)
                                 passcode hash)
            ◄──────── WebRTC (video + "input" data channel) ────────►
```

* Video is sent host → viewer over a WebRTC peer connection.
* Mouse / keyboard events are sent viewer → host over a WebRTC data channel
  (`label: "input"`).
* The signaling server only relays JSON and sees the SHA-256 hash of the
  passcode, never the plaintext.
* STUN is Google's public server; add a TURN server if you need to traverse
  strict NATs.

See [`shared/protocol.md`](shared/protocol.md) for the message schema.

## Consent model (non-negotiable)

1. Every session generates a fresh 9-digit session ID and 6-digit passcode.
2. When a viewer connects with a valid ID + passcode, the host sees an
   "Incoming connection request" dialog and must click **Accept**.
3. While a session is active, a red banner is visible in the host app
   ("⚠ Your screen is being viewed and controlled right now") with an
   **End session** button.
4. There is no silent mode, no auto-accept, no persistent backdoor, no
   auto-start-at-boot. Do not add them. Using this tool to access a
   computer without the owner's knowledge and permission is illegal in
   most jurisdictions.

## Setup on Windows

Requirements:

* Node.js 20 or newer (https://nodejs.org)
* Windows 10 / 11
* Visual Studio Build Tools (C++ workload) — `nut-js` has native deps that
  build on first `npm install`. Easiest: `npm install --global windows-build-tools`
  once, or install "Desktop development with C++" via the Visual Studio
  Installer.

Install deps for all three apps:

```powershell
cd remote-desktop\signaling ; npm install
cd ..\host                  ; npm install
cd ..\viewer                ; npm install
```

### Run the signaling server

On a machine reachable from both the host and the viewer (your own laptop is
fine for same-LAN testing; otherwise a small VPS):

```powershell
cd remote-desktop\signaling
npm start
# [signaling] listening on ws://0.0.0.0:8443
```

For anything other than `localhost` testing you **must** put this behind TLS
(nginx / Caddy with a real cert) and use `wss://` — the passcode hash and
SDP go over this connection.

### Run the host (on the machine being controlled)

```powershell
cd remote-desktop\host
$env:SIGNALING_URL = "ws://<signaling-host>:8443"   # omit for localhost
npm start
```

The host window shows a session ID and passcode. Read them to the other
person out-of-band (phone, Signal, etc.).

### Run the viewer

```powershell
cd remote-desktop\viewer
$env:SIGNALING_URL = "ws://<signaling-host>:8443"
npm start
```

Enter the ID + passcode, click Connect, and wait for the host to Accept.
Once the video appears, click inside it to give it focus, then your mouse
and keyboard will be forwarded to the host machine.

## Limitations

* **Windows-only host.** `nut-js` works on macOS and Linux too but the
  key-code map in `host/src/main.js` is only tested on Windows.
* **Single primary monitor.** Multi-monitor support would add a source
  picker.
* **No audio**, no file transfer, no clipboard sync.
* **No TURN server configured.** Direct-NAT scenarios will fail; you need
  to add TURN credentials to `ICE_SERVERS` in both renderers.
* **Elevated (UAC) windows** will not receive input unless the host
  Electron process is itself running as Administrator, because Windows
  blocks cross-integrity-level input injection.
* **Not hardened for production.** No rate limiting, no brute-force
  protection on the passcode (6 digits = 1M keys; rotate per session and
  keep sessions short). Add lockout + TLS + auth before exposing the
  signaling server to the public internet.

## What's intentionally not here

No unattended / always-on mode. No service installer. No hidden-window
mode. No mechanism to bypass the Accept dialog. These are the features
that turn a legitimate remote-support tool into malware; if you need them
for a real use case, use a commercial product with proper audit logging.
