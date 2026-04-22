// Renderer-side of the host app. Owns the WebSocket signaling connection and
// the WebRTC peer connection. Input events arriving on the data channel are
// forwarded to the main process via `window.hostAPI.inject`, which applies
// them with nut-js.

const $ = (id) => document.getElementById(id);

const state = {
  ws: null,
  pc: null,
  inputChannel: null,
  sessionId: null,
  passcode: null,
  pendingViewer: null,
  screenStream: null,
};

const ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];

async function boot() {
  const { passcode, passcodeHash } = await window.hostAPI.newCredentials();
  state.passcode = passcode;
  $("passcode").textContent = passcode.replace(/(\d{3})(\d{3})/, "$1 $2");

  const url = await window.hostAPI.signalingUrl();
  const ws = new WebSocket(url);
  state.ws = ws;

  ws.addEventListener("open", () => {
    setStatus("Connected. Registering session…");
    ws.send(JSON.stringify({ type: "host-register", passcodeHash }));
  });

  ws.addEventListener("message", (evt) => {
    const msg = JSON.parse(evt.data);
    handleSignal(msg);
  });

  ws.addEventListener("close", () => setStatus("Signaling connection closed."));
  ws.addEventListener("error", () => setStatus("Signaling connection error."));
}

function setStatus(text) {
  $("conn-status").textContent = text;
}

function formatSessionId(id) {
  return id.replace(/(\d{3})(\d{3})(\d{3})/, "$1 $2 $3");
}

async function handleSignal(msg) {
  switch (msg.type) {
    case "host-registered":
      state.sessionId = msg.sessionId;
      $("session-id").textContent = formatSessionId(msg.sessionId);
      setStatus("Waiting for a viewer to connect.");
      break;

    case "join-request":
      state.pendingViewer = msg;
      $("approve-box").style.display = "block";
      $("approve-detail").textContent =
        `Viewer "${msg.viewerLabel}" (${msg.viewerNonce}) wants to view and control this computer.`;
      break;

    case "viewer-disconnected":
      teardownPeer();
      setStatus("Viewer disconnected. Waiting for a new viewer.");
      $("active-banner").style.display = "none";
      break;

    case "signal":
      await handleWebRTCSignal(msg.payload);
      break;

    case "session-closed":
      teardownPeer();
      setStatus("Session closed: " + msg.reason);
      $("active-banner").style.display = "none";
      break;

    case "error":
      setStatus("Signaling error: " + msg.error);
      break;
  }
}

$("btn-accept").addEventListener("click", async () => {
  if (!state.pendingViewer) return;
  $("approve-box").style.display = "none";
  state.ws.send(JSON.stringify({ type: "host-decision", accept: true }));
  await startPeer();
  $("active-banner").style.display = "block";
});

$("btn-reject").addEventListener("click", () => {
  state.ws.send(JSON.stringify({ type: "host-decision", accept: false }));
  state.pendingViewer = null;
  $("approve-box").style.display = "none";
});

$("btn-end").addEventListener("click", () => {
  state.ws.send(JSON.stringify({ type: "end-session" }));
  teardownPeer();
  $("active-banner").style.display = "none";
  setStatus("Session ended by host.");
});

async function startPeer() {
  const sources = await window.hostAPI.listSources();
  if (!sources.length) {
    setStatus("No screens available to capture.");
    return;
  }
  // Capture the primary screen. Multi-monitor picker is left as a follow-up.
  const sourceId = sources[0].id;

  // The desktopCapturer-backed getUserMedia API expects this legacy shape.
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: "desktop",
        chromeMediaSourceId: sourceId,
        maxWidth: 1920,
        maxHeight: 1080,
        maxFrameRate: 30,
      },
    },
  });
  state.screenStream = stream;

  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  state.pc = pc;
  for (const track of stream.getTracks()) pc.addTrack(track, stream);

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

  pc.addEventListener("datachannel", (e) => {
    if (e.channel.label === "input") wireInputChannel(e.channel);
  });

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  state.ws.send(
    JSON.stringify({
      type: "signal",
      payload: { kind: "sdp", sdp: pc.localDescription },
    })
  );
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
    try {
      await state.pc.addIceCandidate(payload.candidate);
    } catch (err) {
      console.warn("addIceCandidate failed", err);
    }
  }
}

function wireInputChannel(ch) {
  state.inputChannel = ch;
  ch.addEventListener("message", async (evt) => {
    let event;
    try {
      event = JSON.parse(evt.data);
    } catch {
      return;
    }
    await window.hostAPI.inject(event);
  });
}

function teardownPeer() {
  if (state.pc) {
    try { state.pc.close(); } catch {}
    state.pc = null;
  }
  if (state.screenStream) {
    for (const t of state.screenStream.getTracks()) t.stop();
    state.screenStream = null;
  }
  state.inputChannel = null;
  state.pendingViewer = null;
}

boot().catch((err) => {
  console.error(err);
  setStatus("Startup failed: " + err.message);
});
