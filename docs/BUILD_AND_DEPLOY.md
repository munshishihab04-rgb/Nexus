# Build and deploy guide

This guide is designed so a future clean machine can rebuild Nexus without any local runtime data.

## Prerequisites

### Android

- JDK 17.
- Android SDK with platform 34 and build tools installed.
- `ANDROID_HOME` set to the SDK path.
- The Gradle wrapper included in `android/`.

### Server

- Node.js 20+ recommended.
- npm.
- A private server/VPS or tunnel for HTTPS access from the Android device.

## Clean checkout

```bash
git clone https://github.com/<owner>/<repo>.git nexus
cd nexus
```

## Server setup

```bash
cd server
npm install
cp .env.example .env
```

Edit `.env` locally. Example values:

```bash
PORT=3000
NEXUS_TOKEN=replace-with-strong-token
NEXUS_ROOT=/srv/nexus
NEXUS_DATA_DIR=/srv/nexus/data
NEXUS_DASHBOARD_DIR=/srv/nexus/server/dashboard
```

Run locally:

```bash
PORT=3000 \
NEXUS_TOKEN="replace-with-strong-token" \
NEXUS_DATA_DIR="$(pwd)/data" \
node index.js
```

Health checks:

```bash
curl -H "X-Token: replace-with-strong-token" http://127.0.0.1:3000/api/devices
curl -H "X-Token: replace-with-strong-token" http://127.0.0.1:3000/api/stats
```

## Android build

The Android app reads server URL and API token from Gradle properties or environment variables at build time. Do not hard-code live values into source.

```bash
cd android
export JAVA_HOME=/path/to/jdk17
export ANDROID_HOME=/path/to/android-sdk
./gradlew clean assembleDebug \
  -PNEXUS_SERVER_URL="https://your-server.example.com" \
  -PNEXUS_API_TOKEN="replace-with-strong-token"
```

Output:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

Alternative using environment variables:

```bash
export NEXUS_SERVER_URL="https://your-server.example.com"
export NEXUS_API_TOKEN="replace-with-strong-token"
./gradlew clean assembleDebug
```

## Full verification before release/push

```bash
# Android
cd android
./gradlew clean testDebugUnitTest lintDebug assembleDebug \
  -PNEXUS_SERVER_URL="https://example.invalid" \
  -PNEXUS_API_TOKEN="change-me"

# Server
cd ../server
npm install
node --check index.js
node test-hardening.js
node test-reliability.js
```

## Deploying the server with systemd

Example unit file, adjust paths and user:

```ini
[Unit]
Description=Nexus server
After=network.target

[Service]
Type=simple
User=nexus
WorkingDirectory=/srv/nexus/server
Environment=PORT=3000
Environment=NEXUS_ROOT=/srv/nexus
Environment=NEXUS_DATA_DIR=/srv/nexus/data
Environment=NEXUS_DASHBOARD_DIR=/srv/nexus/server/dashboard
EnvironmentFile=/srv/nexus/.env
ExecStart=/usr/bin/node index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

`.env` should contain only secrets, for example:

```bash
NEXUS_TOKEN=replace-with-strong-token
```

## Updating a deployment

```bash
cd /srv/nexus
git pull
cd server
npm install --omit=dev
sudo systemctl restart nexus
```

Then rebuild the APK if the server URL/token changed.

## Runtime data backup

Back up `NEXUS_DATA_DIR` separately from git. Example:

```bash
tar -czf nexus-data-$(date +%F).tar.gz /srv/nexus/data
```

Do not commit the archive.
