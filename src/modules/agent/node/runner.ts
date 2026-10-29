// The Agent panel's runner: starts the local `claude` command in its headless mode (`claude -p`), one request at a
// time, and keeps what it reports as a list of events the browser polls for. `claude` signs in the same way it does in
// a terminal on this computer (a Claude account, an API key, or Amazon Bedrock settings), so the studio needs no key.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export type AgentEvent =
  | { kind: 'text'; text: string }
  | { kind: 'step'; text: string }
  | { kind: 'done'; ok: boolean; text: string };

type Run = {
  id: string;
  events: AgentEvent[];
  done: boolean;
  sessionId: string | null;
  child: ChildProcess | null;
  timer: NodeJS.Timeout | null;
};

// What Claude may do without anyone to answer its permission prompts: read the project, change files only inside
// src/prototypes/, and run the studio commands that create and inspect prototypes. Anything else is refused.
export const ALLOWED_TOOLS = [
  'Read',
  'Glob',
  'Grep',
  'Edit(./src/prototypes/**)',
  'Write(./src/prototypes/**)',
  'MultiEdit(./src/prototypes/**)',
  'Bash(pnpm new:*)',
  'Bash(pnpm studio context:*)',
  'Bash(pnpm studio identify:*)',
  'Bash(node src/platform/node/cli/resolve-contributor.js)',
];

const GUIDANCE = [
  "You are running inside Design Studio's Agent panel, started by the studio's dev server.",
  'The person is watching a live preview beside this chat; nobody can answer permission prompts.',
  'Follow AGENTS.md. Change files only inside src/prototypes/; other changes are refused.',
  'Keep replies short and in plain language: say what you changed and where to look.',
].join(' ');

// A run stops by itself after this long.
const RUN_LIMIT_MS = 15 * 60 * 1000;

export function createRunner(root: string, command = process.env.STUDIO_AGENT_CLAUDE || 'claude') {
  let current: Run | null = null;
  let version: string | null | undefined;

  // The pairing code, kept between restarts in node_modules/.cache (never committed). Only someone who can see this
  // computer's terminal knows it, so people viewing the studio over the network can watch but not prompt.
  const codeFile = path.join(root, 'node_modules', '.cache', 'studio-agent', 'code');
  const code = (() => {
    try {
      const saved = fs.readFileSync(codeFile, 'utf8').trim();
      if (/^\d{6}$/.test(saved)) return saved;
    } catch {}
    const fresh = String(randomInt(100000, 1000000));
    try {
      fs.mkdirSync(path.dirname(codeFile), { recursive: true });
      fs.writeFileSync(codeFile, fresh + '\n', { mode: 0o600 });
    } catch {}
    return fresh;
  })();

  const paired = (given: unknown) =>
    typeof given === 'string' && given.length === code.length && timingSafeEqual(Buffer.from(given), Buffer.from(code));

  // The installed claude version, or null when the command can't be found. Checked once.
  const installed = () => {
    if (version !== undefined) return version;
    const result = spawnSync(command, ['--version'], { encoding: 'utf8', timeout: 15000 });
    version = result.status === 0 ? result.stdout.trim() || 'unknown' : null;
    return version;
  };

  const relative = (file: unknown) =>
    typeof file === 'string' ? path.relative(root, path.resolve(root, file)) || file : 'a file';

  // A short line for each tool Claude uses, for the chat's progress list.
  const describe = (name: string, input: Record<string, unknown>) => {
    if (name === 'Edit' || name === 'MultiEdit') return `Editing ${relative(input.file_path)}`;
    if (name === 'Write') return `Writing ${relative(input.file_path)}`;
    if (name === 'Read') return `Reading ${relative(input.file_path)}`;
    if (name === 'Glob' || name === 'Grep') return `Searching for ${String(input.pattern ?? 'files')}`;
    if (name === 'Bash') return `Running ${String(input.command ?? 'a command')}`;
    return `Using ${name}`;
  };

  const finish = (run: Run, event: Extract<AgentEvent, { kind: 'done' }>) => {
    if (run.done) return;
    run.events.push(event);
    run.done = true;
    if (run.timer) clearTimeout(run.timer);
    run.child = null;
  };

  // One line of `--output-format stream-json`.
  const read = (run: Run, line: string) => {
    let message: Record<string, any>;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (typeof message.session_id === 'string') run.sessionId = message.session_id;
    if (message.type === 'assistant') {
      for (const block of message.message?.content ?? []) {
        if (block.type === 'text' && block.text?.trim()) run.events.push({ kind: 'text', text: block.text.trim() });
        if (block.type === 'tool_use') run.events.push({ kind: 'step', text: describe(block.name, block.input ?? {}) });
      }
    }
    if (message.type === 'result') {
      const refused = Array.isArray(message.permission_denials) ? message.permission_denials.length : 0;
      const note = refused ? ` ${refused} action${refused === 1 ? ' was' : 's were'} not allowed.` : '';
      finish(run, {
        kind: 'done',
        ok: !message.is_error,
        text: (message.is_error ? 'Claude stopped with an error.' : 'Done.') + note,
      });
    }
  };

  return {
    code,
    status: () => ({ installed: installed(), busy: Boolean(current && !current.done) }),
    paired,

    // Starts a request, continuing the conversation when a session is given. Returns null while another one runs.
    start(prompt: string, sessionId: string | null, context: string | null) {
      if (current && !current.done) return null;
      const args = [
        '-p',
        '--output-format',
        'stream-json',
        '--verbose',
        '--permission-mode',
        'default',
        '--allowedTools',
        ...ALLOWED_TOOLS,
        '--append-system-prompt',
        context ? `${GUIDANCE} ${context}` : GUIDANCE,
      ];
      if (sessionId) args.push('--resume', sessionId);
      const run: Run = {
        id: randomBytes(8).toString('hex'),
        events: [],
        done: false,
        sessionId,
        child: null,
        timer: null,
      };
      current = run;
      // The prompt goes in on stdin, so text that looks like an option is never read as one.
      const child = spawn(command, args, { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });
      run.child = child;
      run.timer = setTimeout(() => {
        child.kill();
        finish(run, { kind: 'done', ok: false, text: 'Stopped after 15 minutes.' });
      }, RUN_LIMIT_MS);
      let buffered = '';
      let errors = '';
      child.stdout!.setEncoding('utf8');
      child.stdout!.on('data', (chunk: string) => {
        buffered += chunk;
        const lines = buffered.split('\n');
        buffered = lines.pop() ?? '';
        for (const line of lines) if (line.trim()) read(run, line);
      });
      child.stderr!.setEncoding('utf8');
      child.stderr!.on('data', (chunk: string) => {
        errors = (errors + chunk).slice(-2000);
      });
      child.on('error', error => {
        finish(run, { kind: 'done', ok: false, text: `Couldn't start claude: ${error.message}` });
      });
      child.on('close', status => {
        if (buffered.trim()) read(run, buffered);
        finish(run, {
          kind: 'done',
          ok: status === 0,
          text: status === 0 ? 'Done.' : errors.trim() || `claude exited with status ${status}.`,
        });
      });
      child.stdin!.on('error', () => {});
      child.stdin!.end(prompt);
      return run.id;
    },

    // The events after `after`, for the run with this ID.
    poll(id: string, after: number) {
      if (!current || current.id !== id) return null;
      return {
        events: current.events.slice(Math.max(0, after)),
        next: current.events.length,
        done: current.done,
        sessionId: current.sessionId,
      };
    },

    stop(id: string) {
      if (!current || current.id !== id || current.done) return false;
      current.child?.kill();
      finish(current, { kind: 'done', ok: false, text: 'Stopped.' });
      return true;
    },

    // Ends a running request when the dev server shuts down.
    close() {
      current?.child?.kill();
    },
  };
}

export type Runner = ReturnType<typeof createRunner>;
