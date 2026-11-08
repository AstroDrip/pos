# Keyboard Shortcuts and Quick Actions

**Date:** 2026-11-08. **Branch:** `feature/owner-tools`.

## How it fits together

| Part | File | Job |
|---|---|---|
| Registry | `src/renderer/keyboard-registry.ts` | The one list of shortcuts and letters, and every decision about them. Pure and unit-tested |
| Listener | `src/renderer/key-hub.ts` | The app's only global keydown listener. The scanner sees each key first |
| Provider | `src/renderer/Keyboard.tsx` | Connects the listener to the current screen |
| Palette | `src/renderer/QuickActions.tsx` | Ctrl+K box |
| Checkout keys | `src/renderer/checkout-keys.ts` | Unchanged. Still owns Enter, Ctrl+Enter, Shift+Enter, + and − on Sell |

The central listener ignores the payment keys, so one key press cannot be handled twice.

## Rulings

| Conflict in the requirement | Decision |
|---|---|
| "Press a letter" and "search by typing" both use letters | With the box empty, a listed letter runs its action. Tab or `/` switches to searching. A letter with no action starts a search |
| Ctrl+K during the quantity step | Refused with a message, because moving focus would cancel the chosen item |
| Ctrl+K on the payment step | Allowed. Only Item information can be used there; the rest are grey |
| Ctrl+K, F1 or F4 while Help is over the screen | Do nothing, so popups never stack. Ctrl+F stays inside Help |
| Ctrl+F while a filled box, a note, a list or a PIN box has focus | Does nothing. An empty box may be left |
| Leaving Sell loses the bill | M and S are grey while the bill has items |
| Every letter on every screen (the owner's choice, replacing "only what fits the screen") | A letter from another screen opens its screen first. I works on the spot. S and R pick from their list first, so Esc leaves you where you were. H is grey away from Sell because no bill exists there. Permissions still hide letters |
| Letters on an Arabic keyboard | The physical key is used |
| A scanned code that starts with a letter | A letter waits 40 ms; another key that soon means a scanner, and the command is dropped |
| Item information for cashiers | Price and stock are shown with no extra permission, as requested. Cost is never sent |

## Changing keys (Admin → Keyboard shortcuts)

- Needs `settings.manage`. Audited as `settings.shortcuts`. Stored in `settings` under `keyboard_shortcuts`.
- Rules are in `src/core/shortcuts.ts`. A function key, or Ctrl or Alt with a letter or digit. Not allowed: keys used for typing, editing, or closing or reloading the window; AltGr; two functions on one key.
- A changed checkout key is translated by `canonicalize` into the key `decideKey` already knows, so every guard stays the same.
- If Enter is moved away from cash, Enter still picks items and confirms quantities. Moved keys apply only in their own box.
- Alt+Enter never counts as Enter.
- Arrow keys, Tab and `/` inside Quick Actions, and Enter for picking items, are fixed.

## Checks

- `npm test`, `typecheck`, `lint`, `build`: see the commit message.
- `npm run ui-audit`: see the final run in the commit message.
- Each review finding had a real-app flow that failed before the fix and passes after it.

## Not checked in the real app

- A physical scanner. The flows send a fast key burst instead.
- A real Arabic IME session. Composition and Arabic layouts are covered by unit tests and one simulated key.
- A cashier login. Permission hiding is covered by unit tests; the audit logs in as the owner.
- Focus on a PIN box. Covered by a unit test.

## Deferred, minor

- After S picks a supplier, focus is on no box. Keys still work.
