import { EventsTab } from '@/components/analytics/events-tab';
import { GraphTab } from '@/components/analytics/graph-tab';
import { InboxTab } from '@/components/analytics/inbox-tab';
import { SessionsTab } from '@/components/analytics/sessions-tab';
import { SettingsTab } from '@/components/analytics/settings-tab';
import { ToolsTab } from '@/components/analytics/tools-tab';

export const metadata = {
  title: 'Analytics',
};

const TABS = [
  { id: 'inbox', label: 'Inbox' },
  { id: 'events', label: 'Events' },
  { id: 'sessions', label: 'Sessions' },
  { id: 'graph', label: 'Graph' },
  { id: 'tools', label: 'Tools' },
  { id: 'settings', label: 'Settings' },
] as const;
type TabId = (typeof TABS)[number]['id'];

interface AnalyticsPageProps {
  searchParams: Promise<{ tab?: string }>;
}

export default async function AnalyticsPage({ searchParams }: AnalyticsPageProps) {
  const { tab } = await searchParams;
  const activeTab: TabId =
    TABS.some((t) => t.id === tab) ? (tab as TabId) : 'inbox';

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Top bar */}
      <div className="border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-40">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="flex h-14 items-center gap-6">
            <span className="font-mono text-xs font-bold tracking-widest uppercase text-muted-foreground">
              Analytics
            </span>
            <div className="h-4 w-px bg-border" />
            <nav className="flex gap-1">
              {TABS.map((t) => (
                <a
                  key={t.id}
                  href={`/analytics?tab=${t.id}`}
                  className={[
                    'relative rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                    activeTab === t.id
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                  ].join(' ')}
                >
                  {t.label}
                </a>
              ))}
            </nav>
          </div>
        </div>
      </div>

      {/* Tab content */}
      <main className="mx-auto max-w-7xl px-4 sm:px-6 py-6">
        {activeTab === 'inbox' && <InboxTab />}
        {activeTab === 'events' && <EventsTab />}
        {activeTab === 'sessions' && <SessionsTab />}
        {activeTab === 'graph' && <GraphTab />}
        {activeTab === 'tools' && <ToolsTab />}
        {activeTab === 'settings' && <SettingsTab />}
      </main>
    </div>
  );
}
