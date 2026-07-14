# Unified Inbox Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make all linked inboxes the default mailbox view and keep individual accounts as optional filters.

**Architecture:** Add a read-only aggregate endpoint that opens independent IMAP clients for every linked account and merges their Inbox headers by date without changing the authenticated account cookie. Store the selected mailbox filter in session storage, render an explicit "All inboxes" item, and reuse the existing message list models. Opening a message from another account transitions to that account only at the point where account-specific message actions are needed.

**Tech Stack:** SnappyMail PHP actions, Knockout-style JavaScript stores and views, HTML templates, Less, Node test runner, PHP lint.

---

### Task 1: Aggregate Inbox endpoint

**Files:**
- Modify: `snappymail/v/0.0.0/app/libraries/RainLoop/Actions/Accounts.php`
- Test: `desktop/test/unified-inbox-source.test.js`

1. Add a source-contract test for a `DoUnifiedInbox` action that uses `aiMailClient`, fetches only `INBOX`, annotates every message with its account, merges by descending timestamp, paginates after merging, and reports partial account failures.
2. Run `node --test desktop/test/unified-inbox-source.test.js` and confirm it fails.
3. Implement the smallest endpoint satisfying that contract without mutating the selected account.
4. Run the test and PHP lint.

### Task 2: Unified mailbox state and sidebar filter

**Files:**
- Modify: `dev/Stores/User/Account.js`
- Modify: `dev/View/User/SystemDropDown.js`
- Modify: `snappymail/v/0.0.0/app/templates/Views/User/SystemDropDown.html`
- Modify: `dev/Styles/User/SystemDropDown.less`
- Modify: `snappymail/v/0.0.0/app/localization/en/user.json`
- Modify: `snappymail/v/0.0.0/app/localization/it/user.json`
- Test: `desktop/test/unified-inbox-source.test.js`

1. Extend the source-contract test for the all-inboxes state, explicit sidebar item, account filter persistence, and accessible selected state.
2. Implement an `allInboxes` observable and session-storage-backed filter helpers.
3. Add the all-inboxes row above the account list and style it consistently with the existing restrained EasyMail sidebar.
4. Make account clicks set a filter before using the existing account transition; make the all-inboxes click clear the filter and reload the Inbox list without switching accounts.

### Task 3: Aggregate message list and account-aware opening

**Files:**
- Modify: `dev/Stores/User/Messagelist.js`
- Modify: `dev/Model/Message.js`
- Modify: `dev/View/User/MailBox/MessageList.js`
- Modify: `snappymail/v/0.0.0/app/templates/Views/User/MailMessageList.html`
- Modify: `dev/Styles/User/MessageList.less`
- Test: `desktop/test/unified-inbox-source.test.js`

1. Extend the source-contract test for calling `UnifiedInbox`, reviving aggregate messages, displaying their mailbox label, and opening cross-account messages through the existing authenticated account transition.
2. Add `account` to the message model and an account badge to list rows only in unified mode.
3. Route Inbox reloads through `UnifiedInbox` when all-inboxes mode is active, preserving the existing loading, search, count, and pagination observables.
4. Before selecting a cross-account message, persist its account filter and call `AccountSwitch`; after success navigate to the exact Inbox message.

### Task 4: Verification

1. Run the focused Node contract test.
2. Run all desktop tests with `npm test --prefix desktop`.
3. Run PHP syntax checks for the touched action file.
4. Run the project JavaScript and CSS production build commands from the existing Make/Gulp configuration, without starting a local server.
5. Run `git diff --check` and inspect only the task diff.
