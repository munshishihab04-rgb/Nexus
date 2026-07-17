# Operations guide

## Start server locally

```bash
cd server
npm install
PORT=3000 \
NEXUS_TOKEN="change-me" \
NEXUS_DATA_DIR="$(pwd)/data" \
node index.js
```

Dashboard:

```text
http://127.0.0.1:3000/?token=change-me
```

## Check device state

```bash
curl -H "X-Token: change-me" http://127.0.0.1:3000/api/devices
curl -H "X-Token: change-me" http://127.0.0.1:3000/api/stats
```

## Force media sync

```bash
curl -X POST \
  -H "X-Token: change-me" \
  -H "Content-Type: application/json" \
  -d '{"type":"sync_media"}' \
  http://127.0.0.1:3000/api/commands/<deviceId>
```

The Android app acknowledges commands through `/api/commands/:deviceId/:commandId/ack`.

## Check separated flows

```bash
# Gallery/media from Android MediaStore
curl -H "X-Token: change-me" http://127.0.0.1:3000/api/media/<deviceId>

# Backup/extra folder selected through SAF
curl -H "X-Token: change-me" http://127.0.0.1:3000/api/backups/<deviceId>

# Notification/chat events
curl -H "X-Token: change-me" 'http://127.0.0.1:3000/api/events?deviceId=<deviceId>&limit=20'
```

## Android install checklist

1. Install APK built with the correct `NEXUS_SERVER_URL` and `NEXUS_API_TOKEN`.
2. Open Nexus Sync once.
3. Grant requested permissions.
4. Enable Notification Access for Nexus Sync.
5. Enable battery optimization exemption when prompted.
6. Optional: select backup/extra folder only if you want a specific folder uploaded separately.
7. Keep the device charging for initial sync, especially for large galleries.

## Troubleshooting

| Symptom | Check |
|---|---|
| Device not online | Server URL/token in APK, network, `/api/ping` logs |
| Notifications absent | Android Notification Access enabled |
| Gallery count 0 | Media permissions, force `sync_media`, watch server `POST /api/media` logs |
| Backup count 0 | SAF folder selected and contains supported files |
| Uploads slow | Battery level, metered/mobile network, large video files |
