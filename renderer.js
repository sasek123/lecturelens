const state = {
  config: null,
  mediaRecorder: null,
  chunks: [],
  stream: null,
  timer: null,
  startedAt: null,
  audioBlob: null,
  sessions: JSON.parse(localStorage.getItem("lecture-lens-sessions") || "[]")
};

const $ = (id) => document.getElementById(id);
const toast = $("toast");

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => toast.classList.remove("visible"), 3400);
}

function formatTime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function elapsedSeconds() {
  return state.startedAt ? Math.floor((Date.now() - state.startedAt) / 1000) : 0;
}

function setPage(view) {
  const views = ["capture", "library", "settings"];
  views.forEach((name) => $(`${name}-view`).classList.toggle("hidden", name !== view));
  document.querySelectorAll(".sidebar-item[data-view]").forEach((button) => {
    button.classList.toggle("selected", button.dataset.view === view);
  });
  const label = view === "capture" ? "New Lecture" : view === "library" ? "All Lectures" : "Settings";
  $("toolbar-section").textContent = label;
  $("toolbar-record-button").classList.toggle("hidden", view !== "capture");
}

function setRecordingUi(phase, title = $("lecture-title").value) {
  const recording = phase === "recording";
  const processing = phase === "processing";
  $("record-panel").classList.toggle("recording", recording);
  $("record-state").classList.toggle("recording", recording);
  $("record-state").innerHTML = `<span class="state-dot"></span> ${recording ? "Recording" : processing ? "Processing" : phase === "error" ? "Error" : "Ready"}`;
  $("record-heading").textContent = recording ? "Recording in progress" : processing ? "Transcribing your lecture" : phase === "error" ? "Something went wrong" : "Ready when you are";
  $("record-description").textContent = recording
    ? "Lecture Lens keeps recording while the main window is minimized."
    : processing
      ? "Your audio is being transcribed and turned into study notes."
      : phase === "error"
        ? title
        : "The recording indicator stays visible above other windows.";
  $("audio-meta-status").textContent = recording ? "Microphone active" : processing ? "Transcribing audio…" : phase === "error" ? "Needs attention" : "Microphone ready";
  $("record-button").classList.toggle("hidden", recording || processing);
  $("stop-button").classList.toggle("hidden", !recording);
  $("toolbar-record-button").classList.toggle("hidden", recording || processing || $("capture-view").classList.contains("hidden"));
  $("toolbar-recording").classList.toggle("hidden", !recording && !processing);
  $("toolbar-recording").querySelector("span:nth-child(2)").textContent = processing ? "Processing" : "Recording";
  $("overlay-status").textContent = processing ? "Transcribing audio" : "Microphone active";
  $("overlay-stop").disabled = processing;
  $("overlay-stop").title = processing ? "Audio is processing" : "Stop recording";
  $("overlay-stop").setAttribute("aria-label", processing ? "Audio is processing" : "Stop recording");
}

function publishRecordingState(active, phase) {
  window.lectureLens.updateRecording({
    active,
    phase,
    title: $("lecture-title").value || "Untitled lecture",
    startedAt: state.startedAt
  });
}

function updateTimer() {
  const elapsed = elapsedSeconds();
  const formatted = formatTime(elapsed);
  $("record-timer").textContent = formatted;
  $("toolbar-timer").textContent = formatted;
}

function beginTimer() {
  window.clearInterval(state.timer);
  updateTimer();
  state.timer = window.setInterval(updateTimer, 250);
}

function stopTimer() {
  window.clearInterval(state.timer);
  state.timer = null;
}

async function startRecording() {
  if (state.mediaRecorder && state.mediaRecorder.state !== "inactive") return;
  if (!navigator.mediaDevices?.getUserMedia) {
    showToast("Microphone recording is unavailable on this device.");
    return;
  }
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const preferredMime = "audio/webm;codecs=opus";
    const mimeType = MediaRecorder.isTypeSupported(preferredMime) ? preferredMime : "";
    state.mediaRecorder = new MediaRecorder(state.stream, mimeType ? { mimeType } : undefined);
    state.chunks = [];
    state.startedAt = Date.now();
    state.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size) state.chunks.push(event.data);
    };
    state.mediaRecorder.onstop = async () => {
      state.audioBlob = new Blob(state.chunks, { type: state.mediaRecorder.mimeType || "audio/webm" });
      state.stream?.getTracks().forEach((track) => track.stop());
      state.stream = null;
      stopTimer();
      setRecordingUi("processing");
      publishRecordingState(true, "processing");
      await processAudio();
    };
    state.mediaRecorder.start(1000);
    beginTimer();
    setRecordingUi("recording");
    publishRecordingState(true, "recording");
    showToast("Recording started. The floating control stays on top.");
  } catch (error) {
    state.stream?.getTracks().forEach((track) => track.stop());
    state.stream = null;
    setRecordingUi("error", error.message || "Microphone permission was denied.");
    showToast(error.message || "Microphone permission was denied.");
  }
}

function stopRecording() {
  if (!state.mediaRecorder || state.mediaRecorder.state === "inactive") return;
  stopTimer();
  state.mediaRecorder.stop();
}

async function processAudio() {
  if (!state.audioBlob) return;
  try {
    const buffer = await state.audioBlob.arrayBuffer();
    const transcription = await window.lectureLens.transcribeAudio({
      buffer,
      mimeType: state.audioBlob.type,
      fileName: "lecture-audio"
    });
    $("transcript-panel").textContent = transcription.text;
    const summary = await window.lectureLens.summarizeText({
      text: transcription.text,
      title: $("lecture-title").value
    });
    $("summary-panel").innerHTML = markdownToHtml(summary.text);
    saveSession({
      title: $("lecture-title").value || "Untitled lecture",
      transcript: transcription.text,
      summary: summary.text,
      createdAt: new Date().toISOString()
    });
    $("result-section").classList.remove("hidden");
    $("empty-state").classList.add("hidden");
    setRecordingUi("ready");
    publishRecordingState(false, "idle");
    showToast(summary.source === "local" ? "Transcript complete. Added a local study outline." : "Transcript and AI summary are ready.");
  } catch (error) {
    setRecordingUi("error", error.message);
    publishRecordingState(false, "idle");
    showToast(error.message || "Could not process this audio.");
  }
}

async function processImportedFile(file) {
  if (!file) return;
  state.audioBlob = file;
  state.startedAt = null;
  $("record-timer").textContent = "00:00:00";
  $("record-description").textContent = `${file.name} is ready to transcribe.`;
  setRecordingUi("processing");
  publishRecordingState(true, "processing");
  await processAudio();
}

function markdownToHtml(markdown) {
  const safe = escapeHtml(markdown);
  return safe
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^- (.+)$/gm, "<li>$1</li>")
    .replace(/(<li>.*<\/li>\n?)+/g, (list) => `<ul>${list}</ul>`)
    .split(/\n{2,}/)
    .map((block) => block.startsWith("<h2>") || block.startsWith("<ul>") ? block : `<p>${block.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}

function saveSession(session) {
  state.sessions.unshift({ id: crypto.randomUUID(), ...session });
  state.sessions = state.sessions.slice(0, 50);
  localStorage.setItem("lecture-lens-sessions", JSON.stringify(state.sessions));
  renderLibrary();
}

function renderLibrary() {
  $("library-count").textContent = state.sessions.length;
  const list = $("library-list");
  if (!state.sessions.length) {
    list.innerHTML = '<div class="empty-library">No lectures yet. Your processed recordings will appear here.</div>';
    return;
  }
  list.innerHTML = state.sessions.map((session) => {
    const date = new Date(session.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
    return `<article class="library-item"><div><h2>${escapeHtml(session.title)}</h2><p>${date} · ${session.transcript.length.toLocaleString()} characters</p></div><div class="library-item-actions"><button class="button secondary open-session" data-id="${escapeHtml(session.id)}">Open</button><button class="icon-control delete-session" data-id="${escapeHtml(session.id)}" aria-label="Delete lecture" title="Delete lecture">×</button></div></article>`;
  }).join("");
  list.querySelectorAll(".open-session").forEach((button) => button.addEventListener("click", () => openSession(button.dataset.id)));
  list.querySelectorAll(".delete-session").forEach((button) => button.addEventListener("click", () => {
    state.sessions = state.sessions.filter((session) => session.id !== button.dataset.id);
    localStorage.setItem("lecture-lens-sessions", JSON.stringify(state.sessions));
    renderLibrary();
  }));
}

function openSession(id) {
  const session = state.sessions.find((item) => item.id === id);
  if (!session) return;
  $("lecture-title").value = session.title;
  $("summary-panel").innerHTML = markdownToHtml(session.summary);
  $("transcript-panel").textContent = session.transcript;
  $("result-section").classList.remove("hidden");
  $("empty-state").classList.add("hidden");
  setPage("capture");
}

function setKeyStatus(id, configured, fallback) {
  const element = $(`${id}-key-status`);
  element.textContent = configured ? "Configured" : fallback;
  element.classList.toggle("configured", configured);
}

async function refreshKeyStatuses() {
  state.config = await window.lectureLens.getConfig();
  setKeyStatus("elevenlabs", state.config.hasTranscriptionKey, "Service unavailable");
  setKeyStatus("octava", state.config.hasSummaryKey, "Not configured");
}

async function saveKeys({ clear = [] } = {}) {
  const status = $("settings-message");
  status.textContent = "";
  try {
    state.config = await window.lectureLens.saveApiKeys({
      octava: $("octava-key").value,
      clear
    });
    $("octava-key").value = "";
    setKeyStatus("elevenlabs", state.config.hasTranscriptionKey, "Service unavailable");
    setKeyStatus("octava", state.config.hasSummaryKey, "Not configured");
    status.textContent = "Saved securely on this device.";
  } catch (error) {
    status.textContent = error.message || "Could not save settings.";
    status.style.color = "var(--red)";
  }
}

function initializeOverlay() {
  document.body.classList.add("overlay-mode");
  document.querySelectorAll("#login-view, #workspace-view, #toast").forEach((element) => element.classList.add("hidden"));
  $("recording-overlay").classList.remove("hidden");
  $("overlay-open").addEventListener("click", () => window.lectureLens.openMainWindow());
  $("overlay-stop").addEventListener("click", () => window.lectureLens.stopRecording());
  window.lectureLens.onRecordingState((recording) => {
    $("overlay-title").textContent = recording.title || "Lecture Lens";
    $("overlay-timer").textContent = formatTime(recording.elapsed || 0);
    $("overlay-status").textContent = recording.phase === "processing" ? "Transcribing audio" : "Microphone active";
    $("overlay-stop").disabled = recording.phase === "processing";
    $("overlay-stop").classList.toggle("hidden", recording.phase === "processing");
  });
}

async function initializeMain() {
  state.config = await window.lectureLens.getConfig();
  $("login-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const valid = $("username").value === state.config.username && $("password").value === state.config.password;
    $("login-error").textContent = valid ? "" : "That username or password is not correct.";
    if (!valid) return;
    $("login-view").classList.add("hidden");
    $("workspace-view").classList.remove("hidden");
    renderLibrary();
  });

  document.querySelectorAll(".sidebar-item[data-view]").forEach((button) => {
    button.addEventListener("click", async () => {
      setPage(button.dataset.view);
      if (button.dataset.view === "settings") await refreshKeyStatuses();
    });
  });
  $("logout-button").addEventListener("click", () => {
    $("workspace-view").classList.add("hidden");
    $("login-view").classList.remove("hidden");
  });

  $("record-button").addEventListener("click", startRecording);
  $("toolbar-record-button").addEventListener("click", startRecording);
  $("stop-button").addEventListener("click", stopRecording);
  $("audio-file").addEventListener("change", (event) => processImportedFile(event.target.files[0]));
  $("drop-zone").addEventListener("dragover", (event) => {
    event.preventDefault();
    $("drop-zone").classList.add("dragging");
  });
  $("drop-zone").addEventListener("dragleave", () => $("drop-zone").classList.remove("dragging"));
  $("drop-zone").addEventListener("drop", (event) => {
    event.preventDefault();
    $("drop-zone").classList.remove("dragging");
    processImportedFile(event.dataTransfer.files[0]);
  });
  $("new-session-button").addEventListener("click", () => {
    $("result-section").classList.add("hidden");
    $("empty-state").classList.remove("hidden");
    $("lecture-title").value = "Political Philosophy";
    $("record-timer").textContent = "00:00:00";
    state.audioBlob = null;
    setRecordingUi("ready");
    setPage("capture");
  });
  $("library-new-button").addEventListener("click", () => setPage("capture"));
  document.querySelectorAll(".result-tab").forEach((button) => button.addEventListener("click", () => {
    document.querySelectorAll(".result-tab").forEach((tab) => tab.classList.toggle("selected", tab === button));
    $("summary-panel").classList.toggle("hidden", button.dataset.tab !== "summary");
    $("transcript-panel").classList.toggle("hidden", button.dataset.tab !== "transcript");
  }));
  $("settings-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    await saveKeys();
  });
  document.querySelectorAll("[data-clear-key]").forEach((button) => button.addEventListener("click", async () => {
    await saveKeys({ clear: [button.dataset.clearKey] });
  }));
  window.lectureLens.onRecordingControl((action) => {
    if (action === "start") startRecording();
    if (action === "stop") stopRecording();
  });
  window.lectureLens.onNewLecture(() => $("new-session-button").click());
  window.lectureLens.onOpenSettings(() => {
    setPage("settings");
    refreshKeyStatuses();
  });
  renderLibrary();
}

async function init() {
  const config = await window.lectureLens.getConfig();
  if (config.isOverlay) initializeOverlay();
  else initializeMain();
}

init();
