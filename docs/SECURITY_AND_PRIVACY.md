# Security and privacy notes

Nexus is intended for owner-authorized backup/sync. Keep the implementation transparent and Android-compliant.

## Never commit

- `.env`, `.env.*` except `.env.example`.
- API tokens, passwords, tunnel URLs tied to live deployments.
- SSH keys, private keys, keystores, signing credentials.
- Uploaded media, backups, contacts, SMS/call logs, notification/event data.
- Runtime `data/` directories, SQLite databases, APK/AAB build outputs.

## Runtime data boundaries

The server stores runtime data under `NEXUS_DATA_DIR` or `NEXUS_ROOT/data`. This directory is intentionally ignored by git and should be backed up separately.

## Android boundaries

Use explicit Android permissions and user-visible services/settings:

- MediaStore for gallery/media library sync.
- Storage Access Framework for selected backup/extra folders.
- NotificationListener for notification/chat events made available by Android.
- Standard providers for SMS, call logs, contacts, and location after user permission.
- Foreground service, boot receiver, and JobScheduler for reliability.

Do not add hidden bypasses, credential scraping, protected third-party app database reads, OTP/password harvesting, or covert anti-kill behavior.

## Token handling

Server auth expects `X-Token` or query `token` for dashboard/API access. Build the Android app with `NEXUS_API_TOKEN` supplied via environment or Gradle property. Rotate tokens if an APK or logs were exposed outside the intended environment.

## Public tunnels

Temporary tunnel URLs are operational artifacts. Do not commit them. Prefer a stable HTTPS endpoint for long-term use.
