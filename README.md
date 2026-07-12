# Nexus

Nexus is a personal Android + server/dashboard project for transparent device backup/sync workflows.

## Structure

- `android/` — Android app source.
- `server/` — Node.js server and dashboard.
- `docs/` — operational notes and project memory.

## Security / privacy

This repository intentionally excludes real device data, media, database files, build artifacts, API tokens, `.env` files, and local secrets.

Android integrations should use standard transparent APIs such as MediaStore, Storage Access Framework, NotificationListener, Contacts/SMS/CallLog permissions, and location permissions. Do not add hidden scraping of protected databases, passwords, OTPs, or private third-party app storage.

## Runtime configuration

Create local environment/config files outside git for server URLs, API tokens, tunnels, and keys.
