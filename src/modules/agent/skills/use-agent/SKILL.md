---
name: use-agent
description: Set up, change, or troubleshoot the studio's built-in Claude chat (/agent). Use only when the Agent module is enabled.
---

Read this module's [README](../../README.md) before changing the chat.

- **Setup.** Confirm `claude` runs in a terminal on the same computer (for Bedrock, the Bedrock settings and AWS sign-in are in place). Start the studio with `pnpm dev`, open **Claude** on the rail, and enter the Agent chat code printed in the terminal.
- **Troubleshooting.** "claude isn't available" means the dev server can't run `claude --version`: check `PATH` or set `STUDIO_AGENT_CLAUDE`. Sign-in errors come from `claude` itself; reproduce them with `claude -p "hi"` in the repository root. Refused actions mean the request needed a tool outside `ALLOWED_TOOLS`.
- **Changing permissions.** Edit `ALLOWED_TOOLS` in `node/runner.ts`. Keep file changes inside `src/prototypes/` unless the person explicitly asks for wider access, and explain that anyone with the pairing code gets the same access.
- **Verify.** Run `pnpm test`, `pnpm check`, and `pnpm build`, then send a request from `/agent` and confirm the preview updates.
