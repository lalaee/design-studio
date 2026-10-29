import { fileURLToPath } from 'node:url';
import type { ModuleServer } from '#studio/module';
import { createRunner } from './node/runner.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const runner = createRunner(root);
process.once('exit', () => runner.close());
console.log(`\n  Agent chat code: ${runner.code}  (enter it once on the studio's Agent page)\n`);

const fields = (body: unknown) =>
  body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
const text = (value: unknown, limit: number) =>
  typeof value === 'string' && value.trim() && value.length <= limit ? value : null;
const denied = { status: 403, body: { error: 'Enter the Agent chat code shown in the terminal running the studio.' } };

export default {
  // Whether claude is installed, whether this browser's code is right, and whether a request is running.
  status: ({ body }) => ({ body: { ...runner.status(), paired: runner.paired(fields(body).code) } }),

  send: ({ body }) => {
    const request = fields(body);
    if (!runner.paired(request.code)) return denied;
    const prompt = text(request.prompt, 20000);
    if (!prompt) return { status: 400, body: { error: 'Write a request first.' } };
    if (!runner.status().installed)
      return { status: 503, body: { error: "The claude command isn't installed or can't run on this computer." } };
    const prototype = text(request.prototype, 300);
    const context = prototype ? `The person is looking at the prototype in ${prototype}.` : null;
    const id = runner.start(prompt, text(request.sessionId, 200), context);
    if (!id) return { status: 409, body: { error: 'Claude is still working on the last request.' } };
    return { body: { id } };
  },

  poll: ({ body }) => {
    const request = fields(body);
    if (!runner.paired(request.code)) return denied;
    const after = typeof request.after === 'number' && Number.isInteger(request.after) ? request.after : 0;
    const progress = typeof request.id === 'string' ? runner.poll(request.id, after) : null;
    if (!progress) return { status: 404, body: { error: 'That request has ended. Send it again.' } };
    return { body: progress };
  },

  stop: ({ body }) => {
    const request = fields(body);
    if (!runner.paired(request.code)) return denied;
    return { body: { stopped: typeof request.id === 'string' && runner.stop(request.id) } };
  },
} satisfies ModuleServer;
