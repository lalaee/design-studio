import type { ModuleSpec } from '#studio/module';

// Agent: a chat with Claude inside the studio (/agent), beside a live preview of the prototype it changes. The dev
// server runs the local `claude` command, which signs in as it does in a terminal (including Amazon Bedrock).
export default {
  lib: false,
  id: 'agent',
  label: 'Claude chat',
  version: '0.1.0',
  requires: '0.1.2',
  description: 'Chat with Claude inside the studio while a live preview shows the prototype it changes.',
  optional: true,
  settings: { group: 'prototyping', order: 9 },
  section: { key: 'agent' },
  instructions: [
    {
      path: 'skills/use-agent/',
      when: "asks to set up, change, or troubleshoot the studio's built-in Claude chat",
    },
  ],
} satisfies ModuleSpec;
