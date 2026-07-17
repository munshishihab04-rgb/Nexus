# Nexus architecture

## Components

```text
Android app ── HTTPS JSON/multipart ── Node.js API server ── filesystem JSON/data store
     │                                      │
     └── foreground service + jobs          └── dashboard + WebSocket updates
```

## Android app

Key classes:

- `NexusService` — foreground service, heartbeat, command polling, scheduled sync orchestration.
- `GallerySync` — automatic media library sync via Android `MediaStore`.
- `ExternalTreeSync` — user-selected Storage Access Framework folder sync for backup/extra files.
- `NexusNotificationListener` — notification/chat event ingestion.
- `NotificationEventQueue` — persistent bounded outbox for reliable notification delivery.
- `NexusAPI` — authenticated HTTP client for JSON and multipart upload.
- `RecoveryScheduler` / `NexusRecoveryJobService` / `BootReceiver` — Android-compliant recovery after boot/process stop.

## Data-flow separation

### Gallery/media

- Source: Android MediaStore images/videos.
- Requires media read permission (`READ_MEDIA_IMAGES`, `READ_MEDIA_VIDEO`, or legacy `READ_EXTERNAL_STORAGE`).
- Upload endpoint: `/api/media/:deviceId`.
- Purpose: normal gallery/media library sync.
- Does **not** depend on the folder picker.

### Backup/extra folder

- Source: a user-selected SAF tree (`ACTION_OPEN_DOCUMENT_TREE`).
- Upload endpoint: `/api/backups/:deviceId`.
- Purpose: WhatsApp backup exports, selected folders, `.crypt12/.crypt14/.crypt15`, `.db`, `.zip`, `.txt`, `.json`, `.vcf`, and media files inside that selected tree.
- Kept out of Gallery/media endpoints so backup files do not pollute the media view.

### Notifications/chats

- Source: Android NotificationListener.
- Upload endpoint: `/api/events`.
- Purpose: notification stream and chat previews exposed by Android notification APIs.
- Independent from both Gallery and backup folder sync.

## Server

Primary endpoints:

- `POST /api/ping` — device heartbeat and command delivery.
- `GET/POST /api/commands/:deviceId` — dashboard/device command queue.
- `POST/GET /api/events` — notification/event stream.
- `POST/GET /api/media/:deviceId` — gallery media metadata and files.
- `POST/GET /api/backups/:deviceId` — selected backup/extra folder files.
- `POST/GET /api/sms/:deviceId`, `/api/calllog/:deviceId`, `/api/contacts/:deviceId`.
- `GET /api/stats` — dashboard aggregate counts.

## Storage

By default the server writes to `NEXUS_DATA_DIR` (or `NEXUS_ROOT/data`). Treat this as runtime data and never commit it.

Suggested layout:

```text
data/
  devices.json
  events/<deviceId>.json
  media/<deviceId>/meta.json + uploaded files
  backups/<deviceId>/meta.json + uploaded files
  sms/<deviceId>.json
  calllog/<deviceId>.json
  contacts/<deviceId>.json
```
