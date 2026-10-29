import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRunner, ALLOWED_TOOLS } from './node/runner.ts';

// A stand-in for `claude`: records its arguments and stdin, then prints a short stream-json conversation.
function fakeClaude(dir: string, { fail = false, hang = false } = {}) {
  const file = path.join(dir, 'claude');
  fs.writeFileSync(
    file,
    `#!${process.execPath}
const fs = require('node:fs');
if (process.argv[2] === '--version') { console.log('9.9.9 (Claude Code)'); process.exit(0); }
let input = '';
process.stdin.on('data', c => (input += c));
process.stdin.on('end', () => {
  fs.writeFileSync(${JSON.stringify(path.join(dir, 'call.json'))}, JSON.stringify({ args: process.argv.slice(2), input }));
  const say = m => console.log(JSON.stringify(m));
  say({ type: 'system', subtype: 'init', session_id: 'session-1' });
  say({ type: 'assistant', session_id: 'session-1', message: { content: [
    { type: 'text', text: 'Adding a search bar.' },
    { type: 'tool_use', name: 'Edit', input: { file_path: ${JSON.stringify(dir)} + '/src/prototypes/a/b/app.tsx' } },
  ] } });
  if (${hang}) return setInterval(() => {}, 1000);
  say({ type: 'result', subtype: 'success', is_error: ${fail}, session_id: 'session-1', permission_denials: [{}] });
});
`,
    { mode: 0o755 },
  );
  return file;
}

const settle = async (runner: ReturnType<typeof createRunner>, id: string) => {
  for (let i = 0; i < 100; i++) {
    const progress = runner.poll(id, 0)!;
    if (progress.done) return progress;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('The run did not finish.');
};

test('runs claude headless with the request on stdin and reports its progress', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-agent-'));
  const runner = createRunner(dir, fakeClaude(dir));
  assert.match(runner.code, /^\d{6}$/);
  assert.equal(runner.paired(runner.code), true);
  assert.equal(runner.paired('000000x'), false);
  assert.equal(runner.paired(undefined), false);
  assert.equal(runner.status().installed, '9.9.9 (Claude Code)');

  const id = runner.start('--add a search bar', null, 'The person is looking at src/prototypes/a/b.')!;
  assert.ok(id);
  assert.equal(runner.start('another', null, null), null, 'one request at a time');
  const progress = await settle(runner, id);
  assert.deepEqual(progress.events, [
    { kind: 'text', text: 'Adding a search bar.' },
    { kind: 'step', text: 'Editing src/prototypes/a/b/app.tsx' },
    { kind: 'done', ok: true, text: 'Done. 1 action was not allowed.' },
  ]);
  assert.equal(progress.sessionId, 'session-1');

  const call = JSON.parse(fs.readFileSync(path.join(dir, 'call.json'), 'utf8'));
  assert.equal(call.input, '--add a search bar');
  assert.ok(!call.args.includes('--add a search bar'), 'the request is not an argument');
  assert.deepEqual(call.args.slice(0, 7), ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'default', '--allowedTools']);
  for (const tool of ALLOWED_TOOLS) assert.ok(call.args.includes(tool));
  assert.ok(call.args.at(-1).endsWith('The person is looking at src/prototypes/a/b.'));

  const next = runner.start('and a filter', 'session-1', null)!;
  await settle(runner, next);
  const resumed = JSON.parse(fs.readFileSync(path.join(dir, 'call.json'), 'utf8'));
  assert.deepEqual(resumed.args.slice(-2), ['--resume', 'session-1']);
  assert.equal(runner.poll(id, 0), null, 'only the latest run is kept');
});

test('keeps the pairing code between restarts', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-agent-'));
  const first = createRunner(dir, fakeClaude(dir)).code;
  assert.equal(createRunner(dir, fakeClaude(dir)).code, first);
});

test('reports errors, missing commands, and stops', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-agent-'));
  const failing = createRunner(dir, fakeClaude(dir, { fail: true }));
  const failed = await settle(failing, failing.start('x', null, null)!);
  assert.equal(failed.events.at(-1)?.kind, 'done');
  assert.equal((failed.events.at(-1) as { ok: boolean }).ok, false);

  const missing = createRunner(dir, path.join(dir, 'not-claude'));
  assert.equal(missing.status().installed, null);
  const absent = await settle(missing, missing.start('x', null, null)!);
  assert.match((absent.events.at(-1) as { text: string }).text, /Couldn't start claude/);

  const hanging = createRunner(dir, fakeClaude(dir, { hang: true }));
  const id = hanging.start('x', null, null)!;
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(hanging.stop(id), true);
  const stopped = hanging.poll(id, 0)!;
  assert.equal(stopped.done, true);
  assert.deepEqual(stopped.events.at(-1), { kind: 'done', ok: false, text: 'Stopped.' });
  assert.equal(hanging.status().busy, false);
});
