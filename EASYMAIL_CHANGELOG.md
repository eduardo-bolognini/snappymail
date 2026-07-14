# EasyMail changelog

This file tracks product changes made by the EasyMail fork. See [CHANGELOG.md](CHANGELOG.md) for the history of the underlying SnappyMail mail core.

## [0.1.0] - 2026-07-14

### Email, self-contained

- Ship EasyMail as a desktop application with the SnappyMail core and a checksum-pinned FrankenPHP runtime bundled together.
- Add manual IMAP and SMTP setup when provider discovery cannot configure a domain.
- Add unified inbox support, multi-account navigation, per-account sender identities, and account-aware notifications.
- Preserve local mail data and settings across desktop updates.

### Focus interface

- Introduce the Focus theme and the `#FC4B08` EasyMail accent across login, mailbox, composer, settings, and dialogs.
- Move accounts and intelligent contacts into the left sidebar.
- Redesign the composer around visible recipients, subject, essential delivery controls, collapsible windows, and a restrained formatting toolbar.
- Add responsive layouts, skeleton states, progress feedback, motion with reduced-motion support, and Gravity UI iconography.

### Optional Codex sidecar

- Add an isolated, app-specific Codex home and workspace with API key and browser login.
- Add complete-thread analysis across sent and received mail, configurable time ranges, and automatic handling for new correspondents.
- Add editable contact dossiers and groups with relationship facts, user writing style, contact writing style, and supporting evidence.
- Add a read-restricted mail MCP bridge for mailboxes, threads, contacts, groups, and approved attachment folders.
- Add composer chat, adaptive reasoning, recipient suggestions, rewrites, reply/reply-all/forward planning, and review-before-send behavior.
- Add an explicit plugin catalog and authorization surface for future integrations.

### Desktop reliability

- Add persistent session and window state, local notification permissions, automatic updates, and safe window lifecycle cleanup.
- Fix backend autoconfiguration failures, PHP deprecations, destroyed-window callbacks, and desktop cache invalidation.
- Add desktop tests for the local runtime, AI workspace, Codex transport, MCP bridge, persistence, updates, and security boundaries.

[0.1.0]: https://github.com/eduardo-bolognini/snappymail/releases/tag/easymail-v0.1.0
