# Maintenance knowledge base

## Ownership

`index.tsx` owns profile observation, mutual-group lookup, tab insertion, and navigation. `style.css` styles the injected tab panel and group rows.

Use Discord's semantic `--text-strong`, `--text-default`, and `--text-muted` tokens for panel text. Legacy profile tokens such as `--header-primary` can resolve to dark foreground colors inside custom dark profile themes.

## Data path

1. `ChannelStore.getSortedPrivateChannels()` supplies locally known private channels.
2. `channel.isGroupDM()` removes one-to-one DMs.
3. `channel.recipients.includes(userId)` identifies shared group DMs.
4. `UserStore`, `RelationshipStore`, and Discord's user-name utility produce fallback names for unnamed groups.

The plugin does not discover groups the current account cannot access. It only exposes group DMs already present in Discord's authenticated local store.

## UI integration

- A `MutationObserver` schedules profile decoration after Discord renders or replaces profile markup.
- The selected profile ID is retained while the modal is open. Every observer pass re-applies tab selection and panel visibility, preventing Discord React re-renders from restoring Activity over the Mutual Groups panel.
- The full-profile tab label includes the current group count, matching Discord's `12 Mutual Friends` and `3 Mutual Servers` labels.
- Group rows store their channel ID and use one capture-phase document handler. Clicking a row calls Discord's profile-close action, routes to its private channel, and then clears remaining modals, so generated markup and React re-renders cannot detach the behavior.
- `.user-profile-modal-v2` scopes full profile tabs. The plugin clones an unselected native tab and the current tab panel class, preserving Discord's active theme and experiment styling.
- `.user-profile-sidebar` scopes compact profile popouts. The plugin clones the Mutual Servers summary section and replaces its content with the mutual-group count.
- Profile user IDs come from the target profile's Discord avatar URL. Bots and the current account are excluded.

The profile root classes and ARIA roles are the most update-sensitive integration points. The plugin intentionally avoids Webpack source patches because the July 2026 desktop experiment renders the official patched tab bar but skips its section hook.

## Failure behavior

If Discord removes or changes a required profile element, the decorator returns without changing the profile. All injected UI is outside Discord's React tree and is removed when the plugin stops.

## Verification checklist

1. Run `npm test` from the Vencord repository root.
2. Run `npx eslint src/userplugins/AlwaysMutualGroups/index.tsx`.
3. Build and inject Vencord.
4. Open a human user's full profile and confirm the count and rows match known shared group DMs.
5. Open the compact profile popout and confirm its Mutual Groups count opens the full profile tab.
6. Open a user with no shared groups and confirm the empty state appears.
7. Select a group row and confirm Discord navigates to that group DM.
8. Confirm bots and the current user's own profile do not receive the tab.
