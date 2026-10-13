const { app, BrowserWindow, ipcMain, Menu, safeStorage, screen } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

loadEnvFile();

let mainWindow;
let overlayWindow;
let recordingState = { active: false, phase: "idle", title: "", startedAt: null };
let overlayClock;

function loadEnvFile() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match || match[1] in process.env) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

function getStoredSecrets() {
  try {
    const file = path.join(app.getPath("userData"), "secrets.enc");
    if (!fs.existsSync(file) || !safeStorage.isEncryptionAvailable()) return {};
    return JSON.parse(safeStorage.decryptString(fs.readFileSync(file)));
  } catch {
    return {};
  }
}

function saveStoredSecrets(secrets) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Secure key storage is unavailable on this device.");
  }
  const file = path.join(app.getPath("userData"), "secrets.enc");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, safeStorage.encryptString(JSON.stringify(secrets)), { mode: 0o600 });
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1140,
    height: 790,
    minWidth: 820,
    minHeight: 600,
    backgroundColor: "#f5f5f7",
    title: "Lecture Lens",
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      preload: path.join(__dirname, "preload.js")
    }
  });

  mainWindow.loadFile("index.html");
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("close", (event) => {
    if (recordingState.active) {
      event.preventDefault();
      mainWindow.minimize();
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
    if (process.platform !== "darwin" && !recordingState.active) app.quit();
  });
}

function createRecordingOverlay() {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.showInactive();
    return;
  }

  const area = screen.getPrimaryDisplay().workArea;
  const width = 252;
  const height = 48;
  overlayWindow = new BrowserWindow({
    width,
    height,
    x: Math.round(area.x + area.width - width - 18),
    y: Math.round(area.y + 18),
    minWidth: width,
    maxWidth: width,
    minHeight: height,
    maxHeight: height,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    title: "Lecture Lens Recording",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      preload: path.join(__dirname, "preload.js")
    }
  });
  overlayWindow.setAlwaysOnTop(true, "floating");
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWindow.loadFile("index.html", { query: { overlay: "1" } });
  overlayWindow.webContents.once("did-finish-load", () => {
    overlayWindow.webContents.send("recording:state", getOverlayState());
    overlayWindow.showInactive();
  });
  overlayWindow.on("closed", () => {
    overlayWindow = null;
  });
}

function getOverlayState() {
  const elapsed = recordingState.startedAt
    ? Math.max(0, Math.floor((Date.now() - recordingState.startedAt) / 1000))
    : 0;
  return { ...recordingState, elapsed };
}

function broadcastRecordingState() {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send("recording:state", getOverlayState());
  }
}

function setRecordingState(next) {
  recordingState = { ...recordingState, ...next };
  if (recordingState.active) {
    createRecordingOverlay();
    broadcastRecordingState();
    if (!overlayClock) {
      overlayClock = setInterval(broadcastRecordingState, 500);
    }
  } else {
    clearInterval(overlayClock);
    overlayClock = null;
    if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.hide();
  }
}

function focusMainWindow() {
  if (!mainWindow) createMainWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function installAppMenu() {
  const template = [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { label: "Settings…", accelerator: "CmdOrCtrl+,", click: () => {
          focusMainWindow();
          mainWindow?.webContents.send("app:settings");
        } },
        { type: "separator" },
        { role: "quit" }
      ]
    },
    {
      label: "File",
      submenu: [
        { label: "New Lecture", accelerator: "CmdOrCtrl+N", click: () => mainWindow?.webContents.send("app:new-lecture") },
        { type: "separator" },
        { role: "close" }
      ]
    },
    {
      label: "Recording",
      submenu: [
        { label: "Start Recording", accelerator: "CmdOrCtrl+Shift+R", click: () => mainWindow?.webContents.send("recording:control", "start") },
        { label: "Stop Recording", accelerator: "CmdOrCtrl+Shift+S", click: () => mainWindow?.webContents.send("recording:control", "stop") }
      ]
    },
    { role: "windowMenu" },
    { role: "help", submenu: [{ label: "About Lecture Lens", click: focusMainWindow }] }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

ipcMain.handle("get-config", (event) => {
  const stored = getStoredSecrets();
  return {
    username: process.env.LECTURE_LENS_USERNAME || "student",
    password: process.env.LECTURE_LENS_PASSWORD || "philosophy2026",
    hasTranscriptionKey: Boolean(process.env.ELEVENLABS_API_KEY || stored.elevenlabs),
    hasSummaryKey: Boolean(process.env.OCTAVA_API_KEY || stored.octava),
    isOverlay: event.sender.getURL().includes("overlay=1"),
    encryptionAvailable: safeStorage.isEncryptionAvailable()
  };
});

ipcMain.handle("save-api-keys", (_event, { octava, clear } = {}) => {
  const secrets = getStoredSecrets();
  if (clear?.includes("octava")) delete secrets.octava;
  if (octava?.trim()) secrets.octava = octava.trim();
  saveStoredSecrets(secrets);
  return {
    hasTranscriptionKey: Boolean(process.env.ELEVENLABS_API_KEY || secrets.elevenlabs),
    hasSummaryKey: Boolean(process.env.OCTAVA_API_KEY || secrets.octava)
  };
});

ipcMain.on("recording:update", (_event, next) => setRecordingState(next));
ipcMain.on("recording:stop", () => mainWindow?.webContents.send("recording:control", "stop"));
ipcMain.on("recording:open", () => focusMainWindow());
ipcMain.on("app:new-lecture", () => mainWindow?.webContents.send("app:new-lecture"));

ipcMain.handle("transcribe-audio", async (_event, payload) => {
  const apiKey = process.env.ELEVENLABS_API_KEY || getStoredSecrets().elevenlabs;
  if (!apiKey) throw new Error("Add your ElevenLabs API key in Settings before transcribing.");

  const audioBuffer = Buffer.from(payload.buffer);
  const form = new FormData();
  form.append("file", new Blob([audioBuffer], { type: payload.mimeType || "audio/webm" }), payload.fileName || "lecture.webm");
  form.append("model_id", process.env.ELEVENLABS_STT_MODEL || "scribe_v2");
  form.append("language_code", "slk");
  form.append("tag_audio_events", "true");
  form.append("diarize", "true");

  const response = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": apiKey },
    body: form
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail?.message || data.detail || "ElevenLabs could not transcribe this audio.");
  return { text: data.text || "", languageCode: data.language_code || "slk", duration: data.duration || null };
});

ipcMain.handle("summarize-text", async (_event, { text, title }) => {
  const apiKey = process.env.OCTAVA_API_KEY || getStoredSecrets().octava;
  if (!apiKey) return { source: "local", text: createLocalSummary(text, title) };

  const response = await fetch("https://octavapi.shop/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "gpt-6-luna",
      temperature: 0.2,
      messages: [
        { role: "system", content: "You summarize Slovak university lectures for students. Return concise Markdown in Slovak with sections: Hlavná myšlienka, Kľúčové body, Pojmy a mená, Otázky na skúšku. Do not invent details." },
        { role: "user", content: `Lecture title: ${title || "Untitled lecture"}\n\nTranscript:\n${text}` }
      ]
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || "The summary service could not process this lecture.");
  return { source: "octava", text: data.choices?.[0]?.message?.content || createLocalSummary(text, title) };
});

function createLocalSummary(text, title) {
  const cleaned = text.trim();
  const sentences = cleaned.split(/(?<=[.!?])\s+/).filter(Boolean);
  const keyPoints = sentences.slice(0, 5);
  const words = cleaned.toLowerCase().match(/[a-záäčďéíĺľňóôŕšťúýž]+/gi) || [];
  const stopWords = new Set(["a", "ale", "ako", "aj", "že", "sa", "je", "na", "v", "vo", "z", "zo", "do", "o", "s", "so", "pre", "pri", "to", "ten", "tá", "toto", "ktorý", "ktorá", "by", "bol", "bola", "sú"]);
  const frequent = [...new Set(words.filter((word) => word.length > 4 && !stopWords.has(word)))]
    .sort((a, b) => words.filter((word) => word === b).length - words.filter((word) => word === a).length)
    .slice(0, 8);
  return `## Hlavná myšlienka\n${keyPoints[0] || "Pre túto prednášku zatiaľ nie je k dispozícii dostatok textu."}\n\n## Kľúčové body\n${keyPoints.map((point) => `- ${point}`).join("\n") || "- Bez rozpoznaného obsahu."}\n\n## Pojmy a mená\n${frequent.map((word) => `- ${word}`).join("\n") || "- Pojmy sa doplnia po pridaní dlhšieho prepisu."}\n\n## Otázky na skúšku\n- Aký problém prednáška rieši?\n- Ktoré argumenty alebo pojmy sú pre tému najdôležitejšie?\n\n*Lokálne orientačné zhrnutie pre titul „${title || "Untitled lecture"}“. Pre plnohodnotné AI zhrnutie nastavte OCTAVA_API_KEY.*`;
}

app.whenReady().then(() => {
  installAppMenu();
  createMainWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().filter((window) => window !== overlayWindow).length === 0) createMainWindow();
    focusMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  clearInterval(overlayClock);
});
