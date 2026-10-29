// Agent in the app: a rail button and the page it opens at /agent (AgentPage.tsx), and an "Ask Claude" entry in each
// prototype's "…" menu that opens the page with that prototype in the preview. Local only: the published site has no
// dev server to run Claude.
import { createRoute, useNavigate, useSearch } from '@tanstack/react-router';
import { AiChat02Icon } from '@hugeicons/core-free-icons';
import type { ModuleApp } from '#studio/ui';
import { APP_NAME, type PrototypeInfo } from '#studio/data';
import AgentPage from './AgentPage';

const useActions = (proto: PrototypeInfo, can: { editable: boolean }) => {
  const navigate = useNavigate();
  return can.editable
    ? [
        {
          label: 'Ask Claude',
          icon: AiChat02Icon,
          onSelect: () =>
            void navigate({ to: '/agent', search: { prototype: `${proto.contributorKey}/${proto.id}` } } as never),
        },
      ]
    : [];
};

export default {
  icon: AiChat02Icon,
  navLabel: 'Claude',
  rail: 'top',
  order: 50,
  localOnly: true,
  routes: root => [
    createRoute({
      getParentRoute: () => root,
      path: 'agent',
      validateSearch: (search: Record<string, unknown>) => ({
        prototype: typeof search.prototype === 'string' ? search.prototype : undefined,
      }),
      head: () => ({ meta: [{ title: `Claude — ${APP_NAME}` }] }),
      component: function Agent() {
        const { prototype } = useSearch({ strict: false }) as { prototype?: string };
        return <AgentPage key={prototype} prototype={prototype} />;
      },
    }),
  ],
  useActions,
} satisfies ModuleApp;
