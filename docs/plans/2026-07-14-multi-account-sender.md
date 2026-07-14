# Multi-Account Sender Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let the composer and its AI choose any linked account as the real sender without switching the mailbox UI.

**Architecture:** Expose sender identities for every linked account, keep them in a composer-only store, and carry `senderAccount` through draft context and send requests. The backend opens the selected account's SMTP/IMAP clients for sending and Sent-folder persistence while retaining session-safe access. AI receives the allowed sender list plus correspondence evidence and may choose one unless the user manually locked the sender.

**Tech Stack:** SnappyMail PHP actions, Knockout JavaScript, Electron AI service, Node source-contract tests, Gulp, electron-builder.

---

### Task 1: Sender identity catalog

**Files:** `Accounts.php`, `Common/UtilsUser.js`, `Stores/User/Identity.js`, `Model/Identity.js`, focused source test.

1. Add a failing source-contract test for account-qualified sender identities.
2. Return all identities for all linked accounts without changing session state.
3. Populate a dedicated sender-identity store while preserving the existing account-settings store.
4. Run the focused test and PHP parsing.

### Task 2: Composer selector and real account-aware send

**Files:** `View/Popup/Compose.js`, `PopupsCompose.html`, `Messages.php`, focused source test.

1. Add a failing test for a manual-locking `Da` menu and `senderAccount` send contract.
2. Bind the menu to every linked sender identity, group/label options by account, and lock after manual selection.
3. Send through the selected account without calling `AccountSwitch`; save to that account's Sent folder.
4. Preserve the current account as fallback and keep drafts safe.

### Task 3: AI sender selection

**Files:** `View/Popup/Compose.js`, `desktop/ai-service.js`, `desktop/test/ai-service.test.js`.

1. Add failing tests that expose allowed senders and require evidence-based sender choice.
2. Include sender options, manual-lock state, thread account, and current recipients in AI context.
3. Instruct AI to prefer the thread account, then established correspondence, and never override a manual lock.
4. Validate returned senders against the allowed catalog before applying.

### Task 4: Build and update installed app

1. Run focused tests, desktop tests, Gulp build, PHP parsing, and `git diff --check`.
2. Package EasyMail without starting a local server.
3. Replace the installed EasyMail application only after a successful package build and verify its version/bundle identity.
