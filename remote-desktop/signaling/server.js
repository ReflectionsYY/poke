import { WebSocketServer } from "ws";
import { randomBytes } from "node:crypto";

const PORT = Number(process.env.PORT || 8443);

// sessionId -> { hostSocket, viewerSocket, passcodeHash, createdAt }
const sessions = new Map();

function newSessionId() {
  // 9 digits, grouped like "123 456 789" when displayed by the host UI.
  let id = "";
  for (let i = 0; i < 9; i++) id += Math.floor(Math.random() * 10);
  // Avoid collisions by regenerating if already in use.
  if (sessions.has(id)) return newSessionId();
  return id;
}

function send(ws, msg) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function closeSession(sessionId, reason) {
  const s = sessions.get(sessionId);
  if (!s) return;
  send(s.hostSocket, { type: "session-closed", reason });
  send(s.viewerSocket, { type: "session-closed", reason });
  sessions.delete(sessionId);
}

const wss = new WebSocketServer({ port: PORT });
console.log(`[signaling] listening on ws://0.0.0.0:${PORT}`);

wss.on("connection", (ws) => {
  ws.role = null;
  ws.sessionId = null;

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return send(ws, { type: "error", error: "invalid-json" });
    }

    switch (msg.type) {
      case "host-register": {
        // Host asks the server to allocate a new session id.
        // Passcode is generated client-side by the host and only its hash
        // is sent here — the server never sees the plaintext passcode.
        if (!msg.passcodeHash || typeof msg.passcodeHash !== "string") {
          return send(ws, { type: "error", error: "missing-passcode-hash" });
        }
        const sessionId = newSessionId();
        sessions.set(sessionId, {
          hostSocket: ws,
          viewerSocket: null,
          passcodeHash: msg.passcodeHash,
          createdAt: Date.now(),
        });
        ws.role = "host";
        ws.sessionId = sessionId;
        send(ws, { type: "host-registered", sessionId });
        console.log(`[signaling] host registered session=${sessionId}`);
        break;
      }

      case "viewer-connect": {
        // Viewer supplies session id + passcode hash; if they match, we
        // forward a join-request to the host for explicit approval.
        const s = sessions.get(msg.sessionId);
        if (!s) return send(ws, { type: "error", error: "unknown-session" });
        if (s.viewerSocket) {
          return send(ws, { type: "error", error: "session-busy" });
        }
        if (msg.passcodeHash !== s.passcodeHash) {
          return send(ws, { type: "error", error: "bad-passcode" });
        }
        s.viewerSocket = ws;
        ws.role = "viewer";
        ws.sessionId = msg.sessionId;
        const viewerNonce = randomBytes(4).toString("hex");
        ws.viewerNonce = viewerNonce;
        send(s.hostSocket, {
          type: "join-request",
          viewerNonce,
          viewerLabel: msg.viewerLabel || "unknown",
        });
        send(ws, { type: "awaiting-approval" });
        console.log(
          `[signaling] viewer requested session=${msg.sessionId} nonce=${viewerNonce}`
        );
        break;
      }

      case "host-decision": {
        // Host accepts or rejects the pending viewer.
        const s = sessions.get(ws.sessionId);
        if (!s || ws.role !== "host" || !s.viewerSocket) return;
        if (msg.accept) {
          send(s.viewerSocket, { type: "approved" });
          console.log(`[signaling] session=${ws.sessionId} approved by host`);
        } else {
          send(s.viewerSocket, { type: "rejected" });
          s.viewerSocket = null;
          console.log(`[signaling] session=${ws.sessionId} rejected by host`);
        }
        break;
      }

      case "signal": {
        // Relay SDP / ICE between the two paired peers.
        const s = sessions.get(ws.sessionId);
        if (!s) return;
        const peer =
          ws.role === "host" ? s.viewerSocket : s.hostSocket;
        send(peer, { type: "signal", payload: msg.payload });
        break;
      }

      case "end-session": {
        closeSession(ws.sessionId, "ended-by-peer");
        break;
      }

      default:
        send(ws, { type: "error", error: "unknown-type" });
    }
  });

  ws.on("close", () => {
    if (!ws.sessionId) return;
    const s = sessions.get(ws.sessionId);
    if (!s) return;
    if (ws.role === "host") {
      closeSession(ws.sessionId, "host-disconnected");
    } else if (ws.role === "viewer") {
      s.viewerSocket = null;
      send(s.hostSocket, { type: "viewer-disconnected" });
    }
  });
});
