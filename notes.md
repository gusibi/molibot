# Notes: Telegram Session Commands

## New Commands Implemented
- `/new`: create + switch to new session
- `/clear`: clear current session context
- `/sessions`: list sessions and current active; supports `/sessions <index|sessionId>`
- `/delete_sessions`: list/delete sessions via `/delete_sessions <index|sessionId>`
- `/help`: list commands and suggested future commands

## Storage Model
- Active session pointer: `data/telegram-mom/<chatId>/active_session.txt`
- Context files: `data/telegram-mom/<chatId>/contexts/<sessionId>.json`
- Legacy migration: `context.json` -> `contexts/default.json` on first access

## Runtime Update
- Runner pool key changed from `chatId` to `chatId::sessionId`.
- Session switch and clear/delete now reset corresponding runner instance to ensure clean context load.

## Verification
- `npm run build` succeeded.
