import {
  Check,
  ChevronRight,
  Copy,
  Download,
  FileText,
  History,
  MessageSquareQuote,
  Pencil,
  Search,
  Star,
  Trash2,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { i18n } from '#imports';
import { createSnapshot, duplicateGuide } from '@/core/guides/service';
import { logger } from '@/lib/logger';
import { useFullview } from '@/stores/fullview';
import { Button } from '@/ui/components/ui/button';
import MascotIcon from '@/ui/shared/MascotIcon';
import ExportPreviewModal from './ExportPreviewModal';
import type { Route } from './router';
import { navigate } from './router';

interface TopNavProps {
  route: Route;
}

// Long enough to swallow the tail of a fast multi-click, short enough that deliberately forking a
// copy again is never blocked for a noticeable moment.
const DUPLICATE_SETTLE_MS = 700;

const navItems = [
  { key: 'all' as const, labelKey: 'fullview_allGuides' as const, icon: FileText },
  { key: 'starred' as const, labelKey: 'fullview_starred' as const, icon: Star },
  { key: 'trash' as const, labelKey: 'fullview_trash' as const, icon: Trash2 },
];

const NAV_CONTROL = 'h-8 rounded-lg border border-border bg-card text-foreground hover:bg-secondary hover:text-accent';

export default function TopNav({ route }: TopNavProps) {
  const {
    counts,
    guideTitle,
    guideStepCount,
    guideExportData: exportData,
    setSearchOpen,
    editing,
    setEditing,
    historyOpen,
    setHistoryOpen,
    bumpHistoryRefresh,
    transcriptOpen,
    setTranscriptOpen,
    hasTranscript,
  } = useFullview((s) => ({
    counts: s.counts,
    guideTitle: s.guideTitle,
    guideStepCount: s.guideStepCount,
    guideExportData: s.guideExportData,
    setSearchOpen: s.setSearchOpen,
    editing: s.editing,
    setEditing: s.setEditing,
    historyOpen: s.historyOpen,
    setHistoryOpen: s.setHistoryOpen,
    bumpHistoryRefresh: s.bumpHistoryRefresh,
    transcriptOpen: s.transcriptOpen,
    setTranscriptOpen: s.setTranscriptOpen,
    hasTranscript: s.hasTranscript,
  }));
  const [exportOpen, setExportOpen] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => clearTimeout(settleTimer.current ?? undefined), []);

  // Straight into the copy: the reason to duplicate a guide is to trim it down into a shorter one,
  // and that work happens in the copy, not the original.
  const handleDuplicate = async (guideId: string) => {
    if (duplicating) return;
    setDuplicating(true);
    try {
      const copyId = await duplicateGuide(guideId);
      if (copyId) {
        navigate({ page: 'guide', guideId: copyId });
        // Hold the button disabled across the navigation. Copying takes a few milliseconds, so an
        // in-flight guard alone is no guard at all: the button keeps its place while the page under
        // it becomes the copy, and a second click of a fast double-click lands on the copy and forks
        // *it*, chaining "Copy of Copy of…" for as long as the user keeps clicking.
        settleTimer.current = setTimeout(() => setDuplicating(false), DUPLICATE_SETTLE_MS);
        return;
      }
    } catch (err) {
      logger.error(' Duplicate guide failed', err);
    }
    setDuplicating(false);
  };

  const toggleEditing = (guideId: string) => {
    if (editing) {
      setEditing(false);
      return;
    }
    setEditing(true);
    createSnapshot(guideId)
      .then((snapshot) => {
        if (snapshot) bumpHistoryRefresh();
      })
      .catch((err) => logger.error(' Snapshot before editing failed', err));
  };

  return (
    <header className="flex items-center gap-5 px-7 h-16 shrink-0 bg-card border-b border-border">
      {/* Brand */}
      <button
        onClick={() => navigate({ page: 'library', category: 'all' })}
        className="flex items-center gap-2 mr-4 cursor-pointer h-full"
      >
        <div className="mb-1">
          <MascotIcon size={22} />
        </div>
        <span className="text-[15px] font-bold tracking-tight text-foreground">{i18n.t('app_name')}</span>
      </button>

      {route.page === 'guide'
        ? guideTitle && (
            <>
              <ChevronRight size={14} className="text-foreground opacity-25" />
              {guideTitle === i18n.t('fullview_untitledGuide') && guideStepCount > 0 ? (
                <span className="flex items-center gap-1">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="w-[5px] h-[5px] rounded-full bg-foreground animate-bounce"
                      style={{ animationDelay: `${i * 150}ms`, animationDuration: '1.2s' }}
                    />
                  ))}
                </span>
              ) : (
                <span className="text-[13px] font-medium truncate max-w-sm text-foreground">{guideTitle}</span>
              )}
            </>
          )
        : navItems.map((item) => {
            const active = route.page === 'library' && route.category === item.key;
            const count = counts[item.key];
            return (
              <button
                key={item.key}
                onClick={() => navigate({ page: 'library', category: item.key })}
                className={`flex items-center gap-1.5 text-[13px] h-8 px-3 rounded-md transition-all
                ${active ? 'bg-primary text-primary-foreground font-semibold' : 'text-foreground font-medium hover:bg-secondary'}`}
              >
                <item.icon size={13.5} />
                {i18n.t(item.labelKey)}
                {count > 0 && (
                  <span
                    className={`text-[11px] ml-0.5 ${active ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}

      {/* Right side */}
      <div className="ml-auto flex items-center gap-3">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setSearchOpen(true)}
          className={`w-52 justify-start ${NAV_CONTROL}`}
        >
          <Search size={14} className="shrink-0 text-muted-foreground" />
          <span className="flex-1 text-left text-muted-foreground">{i18n.t('fullview_searchPlaceholder')}</span>
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-secondary text-muted-foreground">
            ⌘K
          </span>
        </Button>
        {route.page === 'guide' && exportData && (
          <>
            <Button size="sm" variant="ghost" onClick={() => toggleEditing(exportData.guideId)} className={NAV_CONTROL}>
              {editing ? <Check size={14} /> : <Pencil size={14} />}
              {editing ? i18n.t('editor.done') : i18n.t('editor.edit')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setHistoryOpen(!historyOpen)} className={NAV_CONTROL}>
              <History size={14} />
              {i18n.t('editor.versionHistory')}
            </Button>
            {hasTranscript && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setTranscriptOpen(!transcriptOpen)}
                className={NAV_CONTROL}
              >
                <MessageSquareQuote size={14} />
                {i18n.t('transcript.title')}
              </Button>
            )}
            {!editing && (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={duplicating}
                  onClick={() => handleDuplicate(exportData.guideId)}
                  className={NAV_CONTROL}
                >
                  <Copy size={14} />
                  {i18n.t('library.duplicate')}
                </Button>
                <Button size="sm" onClick={() => setExportOpen(true)} className="h-8 rounded-lg">
                  <Download size={14} />
                  {i18n.t('common.export')}
                </Button>
              </>
            )}
            <ExportPreviewModal
              open={exportOpen}
              onOpenChange={setExportOpen}
              guide={exportData.guide}
              steps={exportData.steps}
              screenshots={exportData.screenshots}
            />
          </>
        )}
      </div>
    </header>
  );
}
