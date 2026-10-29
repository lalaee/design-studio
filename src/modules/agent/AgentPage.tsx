// The Agent page (/agent): a chat with Claude on the left and the prototype it's changing on the right. Claude runs
// through this module's server routes (server.ts); the preview is the studio's own prototype page, which updates
// as files change.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from '@tanstack/react-router';
import { callModule, prototypeLink, useManifest } from '#studio/data';
import { Alert, AlertDescription, AlertTitle, Button, Input, Textarea } from '#studio/components';

type AgentEvent = { kind: 'text' | 'step'; text: string } | { kind: 'done'; ok: boolean; text: string };
type Message = { role: 'you' | 'claude'; events: AgentEvent[]; done: boolean };
type Status = { installed: string | null; busy: boolean; paired: boolean };
type Progress = { events: AgentEvent[]; next: number; done: boolean; sessionId: string | null };

// Browser storage can be unavailable (private windows, blocked site data); the page works without it.
const stored = {
  get: (store: () => Storage, key: string) => {
    try {
      return store().getItem(key);
    } catch {
      return null;
    }
  },
  set: (store: () => Storage, key: string, value: string | null) => {
    try {
      if (value === null) store().removeItem(key);
      else store().setItem(key, value);
    } catch {}
  },
};
const local = () => localStorage;
const session = () => sessionStorage;

export default function AgentPage({ prototype: initial }: { prototype?: string }) {
  const manifest = useManifest();
  const router = useRouter();
  const prototypes = manifest.prototypes.filter(p => p.status !== 'archived');
  const [selected, setSelected] = useState(
    () => initial ?? stored.get(session, 'studio-agent-prototype') ?? prototypes[0]?.contributorKey + '/' + prototypes[0]?.id,
  );
  const target = prototypes.find(p => `${p.contributorKey}/${p.id}` === selected) ?? prototypes[0];
  const preview = target ? router.buildLocation(prototypeLink(target)).href : null;

  const [code, setCode] = useState(() => stored.get(local, 'studio-agent-code') ?? '');
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [running, setRunning] = useState<string | null>(null);
  const sessionId = useRef<string | null>(stored.get(session, 'studio-agent-session'));
  const end = useRef<HTMLDivElement>(null);

  const check = (value = code) =>
    callModule<Status>('agent', 'status', { code: value })
      .then(setStatus)
      .catch(e => setError(e instanceof Error ? e.message : String(e)));
  useEffect(() => {
    void check();
  }, []);
  useEffect(() => {
    stored.set(session, 'studio-agent-prototype', selected);
  }, [selected]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  // Polls a running request until it's done, adding what Claude reports to the last message.
  useEffect(() => {
    if (!running) return;
    let after = 0;
    let stopped = false;
    const tick = async () => {
      try {
        const progress = await callModule<Progress>('agent', 'poll', { code, id: running, after });
        if (stopped) return;
        after = progress.next;
        if (progress.sessionId) {
          sessionId.current = progress.sessionId;
          stored.set(session, 'studio-agent-session', progress.sessionId);
        }
        if (progress.events.length || progress.done)
          setMessages(list => {
            const last = list.at(-1)!;
            return [...list.slice(0, -1), { ...last, events: [...last.events, ...progress.events], done: progress.done }];
          });
        if (progress.done) setRunning(null);
        else setTimeout(tick, 700);
      } catch (e) {
        if (stopped) return;
        setError(e instanceof Error ? e.message : String(e));
        setRunning(null);
      }
    };
    void tick();
    return () => {
      stopped = true;
    };
  }, [running]);

  const send = async () => {
    const prompt = draft.trim();
    if (!prompt || running) return;
    setError(null);
    try {
      const { id } = await callModule<{ id: string }>('agent', 'send', {
        code,
        prompt,
        sessionId: sessionId.current,
        prototype: target ? `src/prototypes/${target.contributorKey}/${target.id}` : undefined,
      });
      setMessages(list => [
        ...list,
        { role: 'you', events: [{ kind: 'text', text: prompt }], done: true },
        { role: 'claude', events: [], done: false },
      ]);
      setDraft('');
      setRunning(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const stop = () => running && void callModule('agent', 'stop', { code, id: running }).catch(() => {});
  const restart = () => {
    sessionId.current = null;
    stored.set(session, 'studio-agent-session', null);
    setMessages([]);
  };
  const pair = (event: FormEvent) => {
    event.preventDefault();
    stored.set(local, 'studio-agent-code', code.trim());
    void check(code.trim());
  };

  return (
    <div className='flex h-full min-h-0 w-full flex-col lg:flex-row'>
      <section className='flex min-h-0 w-full flex-col border-b border-border lg:w-[400px] lg:shrink-0 lg:border-r lg:border-b-0'>
        <header className='flex items-center justify-between gap-2 border-b border-border px-4 py-3'>
          <div>
            <h1 className='text-sm font-semibold'>Claude</h1>
            <p className='text-xs text-muted-foreground'>
              {status?.installed ? `Runs the claude command on this computer (${status.installed})` : 'Checking claude…'}
            </p>
          </div>
          <Button variant='ghost' size='sm' onClick={restart} disabled={Boolean(running) || !messages.length}>
            New chat
          </Button>
        </header>

        <div className='min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4'>
          {status && !status.installed && (
            <Alert>
              <AlertTitle>claude isn't available</AlertTitle>
              <AlertDescription>
                Install Claude Code and check that <code>claude</code> works in a terminal on this computer, then reload.
              </AlertDescription>
            </Alert>
          )}
          {status?.installed && !status.paired && (
            <form onSubmit={pair} className='space-y-2'>
              <p className='text-sm'>Enter the Agent chat code printed in the terminal where the studio is running.</p>
              <div className='flex gap-2'>
                <Input
                  value={code}
                  onChange={e => setCode(e.target.value)}
                  inputMode='numeric'
                  placeholder='6-digit code'
                  aria-label='Agent chat code'
                />
                <Button type='submit'>Connect</Button>
              </div>
            </form>
          )}
          {status?.paired && !messages.length && (
            <p className='text-sm text-muted-foreground'>
              Ask for a change to {target ? <strong>{target.title}</strong> : 'a prototype'}, like “Add a search bar to
              the inbox.” The preview updates as Claude works.
            </p>
          )}
          {messages.map((message, i) => (
            <div key={i} className={message.role === 'you' ? 'ml-8 rounded-lg bg-muted px-3 py-2 text-sm' : 'space-y-1.5 text-sm'}>
              {message.events.map((event, j) =>
                event.kind === 'step' ? (
                  <p key={j} className='truncate text-xs text-muted-foreground'>
                    • {event.text}
                  </p>
                ) : event.kind === 'done' ? (
                  <p key={j} className={event.ok ? 'text-xs text-muted-foreground' : 'text-xs text-destructive'}>
                    {event.text}
                  </p>
                ) : (
                  <p key={j} className='whitespace-pre-wrap'>
                    {event.text}
                  </p>
                ),
              )}
              {!message.done && <p className='text-xs text-muted-foreground'>Working…</p>}
            </div>
          ))}
          {error && <p className='text-sm text-destructive'>{error}</p>}
          <div ref={end} />
        </div>

        <form
          onSubmit={e => {
            e.preventDefault();
            void send();
          }}
          className='space-y-2 border-t border-border p-3'>
          <Textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key !== 'Enter' || e.shiftKey) return;
              e.preventDefault();
              void send();
            }}
            placeholder={status?.paired ? 'Describe a change…' : 'Connect first'}
            disabled={!status?.paired}
            rows={3}
            aria-label='Request for Claude'
          />
          <div className='flex justify-end gap-2'>
            {running && (
              <Button type='button' variant='outline' onClick={stop}>
                Stop
              </Button>
            )}
            <Button type='submit' disabled={!status?.paired || Boolean(running) || !draft.trim()}>
              Send
            </Button>
          </div>
        </form>
      </section>

      <section className='flex min-h-[60vh] min-w-0 flex-1 flex-col lg:min-h-0'>
        <header className='flex items-center gap-2 border-b border-border px-4 py-2'>
          <label htmlFor='agent-prototype' className='text-xs text-muted-foreground'>
            Preview
          </label>
          <select
            id='agent-prototype'
            value={target ? `${target.contributorKey}/${target.id}` : ''}
            onChange={e => setSelected(e.target.value)}
            className='min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm'
          >
            {prototypes.map(p => (
              <option key={`${p.contributorKey}/${p.id}`} value={`${p.contributorKey}/${p.id}`}>
                {p.title} — {p.contributor}
              </option>
            ))}
          </select>
          {preview && (
            <a href={preview} target='_blank' rel='noreferrer' className='text-xs text-muted-foreground underline'>
              Open
            </a>
          )}
        </header>
        {preview ? (
          <iframe title='Prototype preview' src={preview} className='min-h-0 w-full flex-1 bg-background' />
        ) : (
          <p className='p-6 text-sm text-muted-foreground'>No prototypes yet. Ask Claude to create one.</p>
        )}
      </section>
    </div>
  );
}
