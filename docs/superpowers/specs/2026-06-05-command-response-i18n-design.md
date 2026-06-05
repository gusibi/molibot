# Command Response Internationalization

## Goal

Use the language selected in Settings as the global runtime response language for Web Chat and all shared channel commands.

## Design

- Add `locale` to `RuntimeSettings`, limited to `zh-CN` and `en-US`.
- Persist Settings language changes through `/api/settings`; browser local storage remains a UI cache only.
- Keep command localization in the shared Agent command layer, not in channel adapters.
- Make Web Chat local commands read the same runtime locale.
- Translate fixed command titles, descriptions, statuses, usage hints, and errors. Preserve command names, IDs, model/provider names, paths, and source skill descriptions.
- Fall back to English for unsupported locale values.

## Verification

- Setting `locale=zh-CN` makes `/help`, `/status`, and representative control commands return Chinese.
- Setting `locale=en-US` makes the same commands return English.
- Settings sanitization preserves supported locales and rejects unsupported values by falling back to English.

