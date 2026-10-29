# Claude chat (Agent)

A chat with Claude inside the studio. Open **Claude** on the rail (`/agent`), or **Ask Claude** from a prototype's "…" menu. The page shows the chat on the left and the selected prototype on the right; the preview updates as Claude changes files.

The module is local only. The published viewing site has no dev server, so it has no chat.

## How it works

- `pnpm dev` loads `server.ts`, which adds `POST /__studio/agent/status`, `send`, `poll`, and `stop`.
- `send` starts the local `claude` command in headless mode (`claude -p --output-format stream-json`) in the repository root, with the request on stdin. Follow-up requests continue the same conversation with `--resume`; **New chat** starts over.
- `node/runner.ts` turns Claude's stream into short progress lines and replies, which the page polls for. One request runs at a time, and a request stops after 15 minutes.
- Vite's file watching refreshes the preview as files change, as it does for edits made in a terminal.

## Sign-in

The studio stores no keys. `claude` signs in exactly as it does in a terminal on the same computer: a Claude account, an API key, or Amazon Bedrock through `CLAUDE_CODE_USE_BEDROCK=1`, the AWS region, and AWS credentials (`~/.aws`, AWS SSO). Settings in `~/.claude/settings.json` apply. If `claude` works in a terminal, the chat works. When an AWS SSO session expires, run `aws sso login` again.

Set `STUDIO_AGENT_CLAUDE` to use a `claude` command that isn't on `PATH`.

## Safety

- **Pairing code.** The dev server prints an Agent chat code in its terminal and keeps it in `node_modules/.cache/studio-agent/code`. Each browser enters it once. People viewing the studio over the network (`pnpm dev --host`) can watch the preview but can't send requests without the code. Delete the file and restart to change the code.
- **What Claude may do.** No one can answer permission prompts in headless mode, so the runner pre-approves a narrow list (`ALLOWED_TOOLS` in `node/runner.ts`): reading the project, editing and writing inside `src/prototypes/`, and the `pnpm new`, `pnpm studio context`, `pnpm studio identify`, and contributor-resolution commands. Claude Code refuses anything else, and the chat reports how many actions were refused.
- Claude uses the computer owner's Claude or AWS access, so only share the code with people who should use it.

## Files

| File | Purpose |
| --- | --- |
| `module.ts` | Declaration. |
| `app.tsx` | Rail button, `/agent` route, and the **Ask Claude** prototype action. |
| `AgentPage.tsx` | Chat and preview. |
| `server.ts` | Dev-server routes and the printed pairing code. |
| `node/runner.ts` | Starts `claude`, reads its stream, and enforces one request at a time. |
| `agent.test.ts` | Runner tests with a stand-in `claude` command. |

See the [module contract](../../platform/context/modules.md) for extension details. To turn the chat off, run `pnpm studio disable agent`.
