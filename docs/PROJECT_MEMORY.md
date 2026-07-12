# Nexus Project Memory

- Android source on original Hermes host: `/opt/data/nexus-build`.
- Server/dashboard source on original Hermes host: `/opt/data/nexus-local`.
- Real runtime data and media are excluded from this repository.
- Key flows: media sync, SMS/call log/contact sync, notifications, GPS/location, dashboard rendering.
- Media sync should stream files, deduplicate uploads, retry failures, and avoid full-file RAM loads.
- Android limits: cloud-only Google Photos items, locked folders, trash, and protected third-party app databases are not accessible to normal apps.
- Dashboard should show only capabilities/data actually received by server.
