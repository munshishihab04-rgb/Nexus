# Nexus

Nexus is a personal, owner-authorized Android + Node.js server/dashboard project for transparent backup/sync workflows.

## Repository layout

- `android/` — Android Java app source, Gradle wrapper, unit tests.
- `server/` — Node.js API server and web dashboard.
- `docs/` — build, deployment, operations, and architecture notes.

## What is intentionally not committed

This repository must never contain live user/device data or secrets:

- Runtime data directories (`data/`, uploaded media, backups, events, contacts, calls, SMS).
- Built APK/AAB artifacts.
- `.env` files or live API tokens.
- Private keys, keystores, certificates, SSH keys.
- Temporary public tunnel URLs.

See `.gitignore` and `docs/SECURITY_AND_PRIVACY.md`.

## Current data model

Nexus intentionally keeps these flows separate:

| Flow | Android source | Server endpoint | Dashboard area |
|---|---|---|---|
| Gallery/media sync | Android MediaStore library | `/api/media/:deviceId` | Gallery / media |
| Backup/extra folder | User-selected Storage Access Framework tree | `/api/backups/:deviceId` | Backups / extra folder APIs |
| WhatsApp/chat notifications | Android NotificationListener events | `/api/events` | Activity / notifications |
| Calls/SMS/contacts | Android platform providers with explicit permissions | `/api/calllog`, `/api/sms`, `/api/contacts` | Calls/SMS/contacts views |

The folder picker is **not** a prerequisite for gallery sync. It is only for user-selected backup/extra folders such as WhatsApp backup exports.

## Quick build

### Server

```bash
cd server
npm install
cp .env.example .env
# edit .env locally; do not commit it
NEXUS_TOKEN="change-me" NEXUS_DATA_DIR="./data" PORT=3000 npm start
```

### Android debug APK

```bash
cd android
export ANDROID_HOME=/path/to/android-sdk
export JAVA_HOME=/path/to/jdk17
./gradlew clean assembleDebug \
  -PNEXUS_SERVER_URL="https://your-server.example.com" \
  -PNEXUS_API_TOKEN="your-token"
```

APK output:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

## Verification commands

```bash
# Android
cd android
./gradlew clean testDebugUnitTest lintDebug assembleDebug

# Server
cd server
npm install
node --check index.js
node test-hardening.js
node test-reliability.js
```

## Documentation

- `docs/BUILD_AND_DEPLOY.md` — full future build/deploy guide.
- `docs/ARCHITECTURE.md` — component and data-flow overview.
- `docs/SECURITY_AND_PRIVACY.md` — what must remain out of git and operational boundaries.
- `docs/OPERATIONS.md` — running, checking, and troubleshooting server/app sync.
