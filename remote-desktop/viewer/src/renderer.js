// Viewer-side renderer. Owns the WebSocket to the signaling server and the
// RTCPeerConnection to the host. Captures pointer/keyboard events on the
// <video> element and forwards them over the "input" data channel, with
// coordinates normalized to [0, 1] so the host can denormalize against its
// own screen size.

const $ = (id) => document.getElementById(id);

const state = {
  ws: null,
  pc: null,
  inputChannel: null,
  connected: false,
};

const ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];

function setStatus(text) { $("status").textContent = text; }

$("btn-connect").addEventListener("click", connect);
$("btn-disconnect").addEventListener("click", disconnect);

async function connect() {
  const rawId = $("session-id").value.replace(/\D/g, "");
  const passcode = $("passcode").value.replace(/\D/g, "");
  if (rawId.length !== 9 || passcode.length !== 6) {
    setStatus("Enter a 9-digit ID and 6-digit passcode.");
    return;
  }
  const passcodeHash = await window.viewerAPI.hashPasscode(passcode);
  const url = await window.viewerAPI.signalingUrl();

  const ws = new WebSocket(url);
  state.ws = ws;
  setStatus("Connecting to signaling…");

  ws.addEventListener("open", () => {
    ws.send(
      JSON.stringify({
        type: "viewer-connect",
        sessionId: rawId,
        passcodeHash,
        viewerLabel: navigator.userAgent.split(")")[0] + ")",
      })
    );
  });

  ws.addEventListener("message", async (evt) => {
    const msg = JSON.parse(evt.data);
    await handleSignal(msg);
  });

  ws.addEventListener("close", () => {
    if (!state.connected) setStatus("Signaling closed.");
  });
}

async function handleSignal(msg) {
  switch (msg.type) {
    case "awaiting-approval":
      setStatus("Waiting for host to approve…");
      break;
    case "approved":
      setStatus("Approved. Establishing peer connection…");
      await startPeer();
      break;
    case "rejected":
      setStatus("Host rejected the connection.");
      state.ws?.close();
      break;
    case "signal":
      await handleWebRTCSignal(msg.payload);
      break;
    case "session-closed":
      setStatus("Session closed: " + msg.reason);
      disconnect();
      break;
    case "error":
      setStatus("Error: " + msg.error);
      break;
  }
}

async function startPeer() {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  state.pc = pc;

  pc.addEventListener("track", (e) => {
    const video = $("remote-video");
    video.srcObject = e.streams[0];
    video.style.display = "block";
    $("placeholder").style.display = "none";
    wireInputCapture(video);
    $("btn-connect").style.display = "none";
    $("btn-disconnect").style.display = "inline-block";
    state.connected = true;
    setStatus("Connected.");
  });

  pc.addEventListener("icecandidate", (e) => {
    if (e.candidate) {
      state.ws.send(
        JSON.stringify({
          type: "signal",
          payload: { kind: "ice", candidate: e.candidate },
        })
      );
    }
  });

  // Viewer creates the data channel; host picks it up via `ondatachannel`.
  const ch = pc.createDataChannel("input", { ordered: true });
  state.inputChannel = ch;
}

async function handleWebRTCSignal(payload) {
  if (!state.pc) return;
  if (payload.kind === "sdp") {
    await state.pc.setRemoteDescription(payload.sdp);
    if (payload.sdp.type === "offer") {
      const ans = await state.pc.createAnswer();
      await state.pc.setLocalDescription(ans);
      state.ws.send(
        JSON.stringify({
          type: "signal",
          payload: { kind: "sdp", sdp: state.pc.localDescription },
        })
      );
    }
  } else if (payload.kind === "ice") {
    try { await state.pc.addIceCandidate(payload.candidate); } catch {}
  }
}

function sendInput(event) {
  const ch = state.inputChannel;
  if (!ch || ch.readyState !== "open") return;
  ch.send(JSON.stringify(event));
}

function wireInputCapture(video) {
  video.addEventListener("mousemove", (e) => {
    const rect = video.getBoundingClientRect();
    const xNorm = (e.clientX - rect.left) / rect.width;
    const yNorm = (e.clientY - rect.top) / rect.height;
    sendInput({ type: "mouse-move", xNorm, yNorm });
  });

  const BUTTON = { 0: "left", 1: "middle", 2: "right" };
  video.addEventListener("mousedown", (e) => {
    e.preventDefault();
    video.focus();
    sendInput({ type: "mouse-button", button: BUTTON[e.button] || "left", state: "down" });
  });
  video.addEventListener("mouseup", (e) => {
    e.preventDefault();
    sendInput({ type: "mouse-button", button: BUTTON[e.button] || "left", state: "up" });
  });
  video.addEventListener("contextmenu", (e) => e.preventDefault());
  video.addEventListener("wheel", (e) => {
    e.preventDefault();
    // Convert pixel-delta to a small "ticks" count for nut-js.
    sendInput({
      type: "mouse-wheel",
      dx: Math.sign(e.deltaX) * Math.min(5, Math.ceil(Math.abs(e.deltaX) / 40)),
      dy: Math.sign(e.deltaY) * Math.min(5, Math.ceil(Math.abs(e.deltaY) / 40)),
    });
  }, { passive: false });

  video.addEventListener("keydown", (e) => {
    e.preventDefault();
    sendInput({ type: "key", code: e.code, state: "down" });
  });
  video.addEventListener("keyup", (e) => {
    e.preventDefault();
    sendInput({ type: "key", code: e.code, state: "up" });
  });
}

function disconnect() {
  if (state.ws) { try { state.ws.send(JSON.stringify({ type: "end-session" })); } catch {} state.ws.close(); state.ws = null; }
  if (state.pc) { try { state.pc.close(); } catch {} state.pc = null; }
  const video = $("remote-video");
  video.srcObject = null;
  video.style.display = "none";
  $("placeholder").style.display = "block";
  $("btn-connect").style.display = "inline-block";
  $("btn-disconnect").style.display = "none";
  state.connected = false;
  state.inputChannel = null;
  setStatus("Disconnected.");
}
