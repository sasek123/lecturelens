# Lecture Lens

Lecture Lens is a desktop app for recording Slovak university lectures, transcribing them with ElevenLabs Scribe, and preparing study notes.

## Use the app

The current build uses a local development account configured with environment variables. If they are unset, the development fallback credentials are `student` / `philosophy2026`:

- `LECTURE_LENS_USERNAME`
- `LECTURE_LENS_PASSWORD`

This is not a hosted multi-user identity system. A class-wide sign-in needs an identity provider and a hosted backend; do not ship a shared password in a public installer.

For local development, set `ELEVENLABS_API_KEY` and `OCTAVA_API_KEY` in `.env`. Keys entered in Settings are encrypted with the operating system's secure storage. The summary request uses `https://octavapi.shop/v1/chat/completions` with `gpt-6-luna`.

The shared ElevenLabs key requested for classmates is not bundled into the installer. A server-side transcription proxy must be configured first; distributing an API key inside a desktop application would expose it to every user.

When you start recording, a compact always-on-top control appears near the upper-right corner of the screen. It shows elapsed time and recording status and has controls to reopen the main window or stop the recording. Minimize the main window while recording; the control remains visible.

Audio and lecture notes are stored locally in the app profile. Audio is sent to ElevenLabs for transcription when you stop the recording. The transcript is sent to OctavApi only when a key is configured.

## Run from source

1. Install Node.js 20 or newer.
2. Install dependencies with `npm install`.
3. Start the app with `npm start`.

The `.env` file remains supported for local development. See `.env.example`; never commit your real `.env`.

## Build installers

Build a universal macOS DMG on macOS:

```sh
npm run build:mac
```

Build a Windows installer on Windows:

```sh
npm run build:win
```

The Windows installer is configured as an NSIS setup executable. Build and sign each platform on its native operating system for the most reliable distribution experience.

## Distribution and updates

Automatic updates are not configured yet. They require a GitHub Releases publishing workflow, updater code in the desktop app, and platform-specific signing configuration. Until those are added, installers must be built and distributed manually.
