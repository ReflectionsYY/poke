# Wire protocol

All messages are JSON, sent over WebSocket (signaling) or the WebRTC data
channel (input events). Keep this file in sync with `signaling/server.js`,
`host/src/main.js`, and `viewer/src/renderer.js`.

## Signaling (WebSocket)

### Host -> server

- `{ type: "host-register", passcodeHash }`
  - `passcodeHash` = SHA-256 hex of the session passcode. Plaintext never
    leaves the host.
- `{ type: "host-decision", accept: boolean }`
  - Sent after the host UI displays the Accept / Reject dialog.
- `{ type: "signal", payload }`
  - Opaque WebRTC SDP / ICE payload, forwarded to the paired viewer.
- `{ type: "end-session" }`

### Viewer -> server

- `{ type: "viewer-connect", sessionId, passcodeHash, viewerLabel }`
- `{ type: "signal", payload }`
- `{ type: "end-session" }`

### Server -> host

- `{ type: "host-registered", sessionId }`
- `{ type: "join-request", viewerNonce, viewerLabel }`
- `{ type: "viewer-disconnected" }`
- `{ type: "signal", payload }`
- `{ type: "session-closed", reason }`
- `{ type: "error", error }`

### Server -> viewer

- `{ type: "awaiting-approval" }`
- `{ type: "approved" }`
- `{ type: "rejected" }`
- `{ type: "signal", payload }`
- `{ type: "session-closed", reason }`
- `{ type: "error", error }`

## Input channel (WebRTC data channel, label = "input")

Viewer -> host only. Host ignores messages sent in the other direction.

- `{ type: "mouse-move", xNorm, yNorm }`
  - `xNorm`, `yNorm` in `[0, 1]` relative to the captured display.
- `{ type: "mouse-button", button: "left" | "right" | "middle", state: "down" | "up" }`
- `{ type: "mouse-wheel", dx, dy }`
- `{ type: "key", code, state: "down" | "up" }`
  - `code` is a KeyboardEvent `code` value (e.g. `KeyA`, `Enter`, `ShiftLeft`).
- `{ type: "text", value }`
  - Fallback for IME / paste; host types the string literally.
