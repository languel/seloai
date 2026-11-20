import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  BookOpen,
  Database,
  Download,
  Eye,
  Network,
  Radio,
  Search,
  Sparkles,
} from 'lucide-react';
import { brainRouter } from '../ai/brainRouter';
import type { PaletteName } from '../art/looks';
import LoomView from './LoomView';
import PsychohistoryView from './PsychohistoryView';
import { useAutoScrollToBottom } from '../hooks/useAutoScrollToBottom';
import { buildNarratorConfig } from '../data/defaultData';
import {
  buildWorldDatabase,
  queryWorldDatabase,
  type WorldRecordKind,
} from '../engine/observatory';
import type { VillageSimulation } from '../engine/simulation';
import type { ModelSettings, VillagerConfig } from '../engine/types';

interface ObservatoryViewProps {
  sim: VillageSimulation;
  /** The art look the Loom is woven in. */
  look: PaletteName;
  villagers: VillagerConfig[];
  settings: ModelSettings;
  onJumpToVillage: (villagerId?: string) => void;
}

type ObservatorySubTab = 'weave' | 'graph' | 'database' | 'loom';

function formatTimeAgo(ts: number): string {
  const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

export const ObservatoryView: React.FC<ObservatoryViewProps> = ({
  sim,
  look,
  villagers,
  settings,
  onJumpToVillage,
}) => {
  const [subTab, setSubTab] = useState<ObservatorySubTab>('weave');
  // Psychohistory under the Loom, both on the same probe. Remembered on this device.
  const [webBeside, setWebBeside] = useState(() => {
    try {
      return localStorage.getItem('seloai.loom.web') === 'on';
    } catch {
      return false;
    }
  });
  const toggleWeb = () =>
    setWebBeside((on) => {
      try {
        localStorage.setItem('seloai.loom.web', on ? 'off' : 'on');
      } catch {
        // no storage
      }
      return !on;
    });
  const [, setTick] = useState(0);


  // Database & Query controls
  const [queryText, setQueryText] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [kindFilter, setKindFilter] = useState<WorldRecordKind | 'all'>('all');
  const [actorFilter, setActorFilter] = useState<string>('all');
  const [timeFilter, setTimeFilter] = useState<'all' | '24h' | '1h'>('all');
  const [synthesizing, setSynthesizing] = useState(false);
  const [scribeSynthesis, setScribeSynthesis] = useState<string | null>(null);

  // Narrative Loom controls
  const [loomWorldline, setLoomWorldline] = useState<string>('all');
  const [loomIncludeThoughts, setLoomIncludeThoughts] = useState(true);
  const [weaving, setWeaving] = useState(false);
  const [chronicleText, setChronicleText] = useState<string>('');

  useEffect(() => {
    const unsub = sim.subscribe(() => setTick((t) => t + 1));
    return () => unsub();
  }, [sim]);

  const allRecords = useMemo(() => buildWorldDatabase(sim), [sim, sim.tickCount, sim.conversations.length]);

  const queryResult = useMemo(
    () => (activeQuery.trim() ? queryWorldDatabase(sim, activeQuery) : null),
    [sim, activeQuery, sim.conversations.length, sim.tickCount],
  );

  const filteredDbRecords = useMemo(() => {
    const base = queryResult ? queryResult.matchingRecords : allRecords;
    const now = Date.now();
    return base.filter((r) => {
      if (kindFilter !== 'all' && r.kind !== kindFilter) return false;
      if (actorFilter !== 'all' && r.actorId !== actorFilter) return false;
      if (timeFilter === '1h' && now - r.timestamp > 3_600_000) return false;
      if (timeFilter === '24h' && now - r.timestamp > 86_400_000) return false;
      return true;
    });
  }, [allRecords, queryResult, kindFilter, actorFilter, timeFilter]);

  const loomRecords = useMemo(() => {
    return allRecords
      .filter((r) => {
        if (!loomIncludeThoughts && (r.kind === 'thought' || r.kind === 'reasoning')) return false;
        if (loomWorldline !== 'all') {
          return r.actorId === loomWorldline || r.partnerIds.includes(loomWorldline);
        }
        return true;
      })
      .slice(0, 40)
      .reverse();
  }, [allRecords, loomWorldline, loomIncludeThoughts]);

  const loomScrollTrigger = `${loomRecords.length}:${loomRecords[loomRecords.length - 1]?.id ?? ''}`;
  const loomScroll = useAutoScrollToBottom(loomScrollTrigger, {
    resetKey: `${subTab}:${loomWorldline}:${loomIncludeThoughts}`,
  });

  const listener = sim.getListenerPosition();

  const handleRunQuery = (e: React.FormEvent) => {
    e.preventDefault();
    setScribeSynthesis(null);
    setActiveQuery(queryText.trim());
  };

  const handleAskScribeSynthesize = async () => {
    if (!queryResult || synthesizing) return;
    setSynthesizing(true);
    try {
      const evidence = queryResult.matchingRecords
        .slice(0, 12)
        .map((r) => `[${r.kind}] ${r.actorName} (@${r.locationLabel}): ${r.text}`)
        .join('\n');
      const prompt = [
        `Control Room Query: "${queryResult.query}"`,
        `Summary: ${queryResult.answerSummary}`,
        evidence ? `Evidence rows:\n${evidence}` : 'No matching rows yet.',
        'Synthesize a concise, perceptive Westworld-style diagnostic answer.',
      ].join('\n\n');
      const res = await brainRouter.generateNarratorReply({
        prompt,
        sceneContext: `Worldline POV: ${listener.label}`,
        history: [],
        settings,
      });
      setScribeSynthesis(res.text);
    } finally {
      setSynthesizing(false);
    }
  };

  const handleWeaveChronicle = async () => {
    if (weaving) return;
    setWeaving(true);
    try {
      const povLabel =
        loomWorldline === 'all'
          ? 'All Worldlines'
          : sim.configs.get(loomWorldline)?.name ?? loomWorldline;
      const beats = loomRecords
        .slice(-16)
        .map((r) => `- (${r.kind}) ${r.actorName} near ${r.locationLabel}: ${r.text}`)
        .join('\n');
      const res = await brainRouter.generateNarratorReply({
        prompt: `Assemble a cohesive literary chronicle from the ${povLabel} worldline based on these recorded beats:\n${beats || '(Quiet village — weave an atmospheric opening.)'}`,
        sceneContext: `Active POV: ${listener.label} · Records: ${loomRecords.length}`,
        history: [],
        settings,
      });
      setChronicleText(res.text);
      if (settings.narratorEnabled) {
        void brainRouter.speakLine(res.text, buildNarratorConfig(settings), settings);
      }
    } finally {
      setWeaving(false);
    }
  };

  const handleDownloadChronicle = () => {
    const body =
      chronicleText ||
      loomRecords
        .map((r) => `- **${r.actorName}** (${r.kind}, ${r.locationLabel}): ${r.text}`)
        .join('\n');
    const blob = new Blob([`# Scribe Chronicle\n\n${body}\n`], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `selo-chronicle-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exampleQueries = [
    villagers[0]
      ? `Who has ${villagers[0].name} talked to in the past day and what do they think about the lantern?`
      : 'Who has talked in the past day?',
    villagers[1] ? `What is ${villagers[1].name} thinking near #Plaza?` : 'Thoughts near #Plaza',
    'Show all conversations about the well or #LamiaWell',
  ];

  return (
    <div className="flex h-full flex-col overflow-hidden bg-surface">
      {/* Top Worldline POV & Sub-tab Header */}
      <div className="border-b border-borderFolk bg-card px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-ink mr-1">
            <Radio className="h-4 w-4 text-crimson" />
            <span>Worldline POV:</span>
          </div>
          <button
            type="button"
            onClick={() => sim.setFocalWorldline('traveler')}
            aria-pressed={sim.focalWorldlineId === 'traveler'}
            className={`rounded-sm border px-2.5 py-0.5 text-xs font-medium transition ${
              sim.focalWorldlineId === 'traveler'
                ? 'border-indigoFolk bg-indigoFolk text-white'
                : 'border-borderFolk bg-surface text-ink hover:border-indigoFolk'
            }`}
          >
            {sim.player.name} (Free)
          </button>
          {villagers.map((v) => {
            const active = sim.focalWorldlineId === v.id;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => sim.setFocalWorldline(v.id)}
                aria-pressed={active}
                className={`inline-flex items-center gap-1 rounded-sm border px-2.5 py-0.5 text-xs font-medium transition ${
                  active
                    ? 'border-crimson bg-crimson text-white'
                    : 'border-borderFolk bg-surface text-ink hover:border-crimson/60'
                }`}
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: active ? '#fff' : v.accentColor }}
                />
                <span>{v.name}</span>
              </button>
            );
          })}
          <span className="text-[11px] text-muted hidden md:inline">
            (Audio &amp; Scribe follow <strong>{listener.label}</strong>)
          </span>
        </div>

        {/* Sub-navigation */}
        <div className="flex items-center gap-1 rounded-sm border border-borderFolk bg-surface p-0.5">
          {(
            [
              ['weave', Sparkles, 'The Loom'],
              ['graph', Network, 'Psychohistory'],
              ['database', Database, 'World DB & Query'],
              ['loom', BookOpen, 'Scribe Loom'],
            ] as const
          ).map(([id, Icon, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setSubTab(id)}
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition ${
                subTab === id ? 'bg-card text-ink shadow-sm' : 'text-muted hover:text-ink'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* The Loom */}
      {subTab === 'weave' && (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className={webBeside ? 'min-h-0 basis-[58%]' : 'min-h-0 flex-1'}>
            <LoomView sim={sim} look={look} onJumpToVillage={onJumpToVillage} webBeside={webBeside} onToggleWeb={toggleWeb} />
          </div>
          {webBeside && (
            <div className="min-h-0 flex-1 border-t border-dashed border-borderFolk">
              <PsychohistoryView sim={sim} look={look} onJumpToVillage={onJumpToVillage} compact />
            </div>
          )}
        </div>
      )}

      {subTab === 'graph' && (
        <div className="min-h-0 flex-1">
          <PsychohistoryView sim={sim} look={look} onJumpToVillage={onJumpToVillage} />
        </div>
      )}

      {/* Mode 2: World DB & Query */}
      {subTab === 'database' && (
        <div className="flex flex-1 flex-col overflow-hidden p-2.5 gap-3">
          <form onSubmit={handleRunQuery} className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[260px]">
              <Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-muted" />
              <input
                type="text"
                value={queryText}
                onChange={(e) => setQueryText(e.target.value)}
                placeholder='Query the world (e.g. "Who has Mara talked to in the past day and what do they think about the lantern?")'
                className="w-full rounded-md border border-borderFolk bg-card pl-8 pr-3 py-1.5 text-xs"
              />
            </div>
            <button
              type="submit"
              className="rounded-md bg-crimson px-3 py-1.5 text-xs font-semibold text-white hover:opacity-95"
            >
              Query DB
            </button>
            {activeQuery && (
              <button
                type="button"
                onClick={() => {
                  setQueryText('');
                  setActiveQuery('');
                  setScribeSynthesis(null);
                }}
                className="rounded-md border border-borderFolk bg-card px-2.5 py-1.5 text-xs"
              >
                Clear
              </button>
            )}
          </form>

          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="text-muted">Examples:</span>
            {exampleQueries.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => {
                  setQueryText(q);
                  setActiveQuery(q);
                  setScribeSynthesis(null);
                }}
                className="rounded-sm border border-borderFolk bg-card px-2.5 py-0.5 hover:border-indigoFolk truncate max-w-xs"
              >
                {q}
              </button>
            ))}
          </div>

          {queryResult && (
            <div className="rounded-sm border border-indigoFolk/40 bg-card p-3 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-semibold text-ink">{queryResult.answerSummary}</div>
                <button
                  type="button"
                  onClick={handleAskScribeSynthesize}
                  disabled={synthesizing}
                  className="inline-flex items-center gap-1 rounded bg-indigoFolk px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-50"
                >
                  <Sparkles className="h-3 w-3" />
                  <span>{synthesizing ? 'Synthesizing…' : 'Ask Scribe to Synthesize'}</span>
                </button>
              </div>
              {scribeSynthesis && (
                <p className="rounded border border-ochre/30 bg-ochre/10 px-2.5 py-2 text-xs italic">
                  {scribeSynthesis}
                </p>
              )}
            </div>
          )}

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <select
              aria-label="Filter by actor"
              value={actorFilter}
              onChange={(e) => setActorFilter(e.target.value)}
              className="rounded border border-borderFolk bg-card px-2 py-1 text-xs"
            >
              <option value="all">All Characters</option>
              {villagers.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
              <option value="narrator">{settings.narratorName || 'Scribe'}</option>
              <option value={sim.player.id}>{sim.player.name}</option>
            </select>

            <select
              aria-label="Filter by record kind"
              value={kindFilter}
              onChange={(e) => setKindFilter(e.target.value as WorldRecordKind | 'all')}
              className="rounded border border-borderFolk bg-card px-2 py-1 text-xs"
            >
              <option value="all">All Record Kinds</option>
              <option value="speech">Speech</option>
              <option value="thought">Inner Thought</option>
              <option value="reasoning">&lt;think&gt; Reasoning</option>
              <option value="narration">Scribe Narration</option>
              <option value="observation">Memory: Observation</option>
              <option value="conversation">Memory: Conversation</option>
              <option value="reflection">Memory: Reflection</option>
            </select>

            <select
              aria-label="Filter by timeframe"
              value={timeFilter}
              onChange={(e) => setTimeFilter(e.target.value as 'all' | '24h' | '1h')}
              className="rounded border border-borderFolk bg-card px-2 py-1 text-xs"
            >
              <option value="all">All Time</option>
              <option value="24h">Past 24h (Past Day)</option>
              <option value="1h">Past Hour</option>
            </select>

            <span className="ml-auto font-mono text-[11px] text-muted">
              {filteredDbRecords.length} records
            </span>
          </div>

          {/* Raw Table */}
          <div className="flex-1 overflow-auto rounded-sm border border-borderFolk bg-card thin-scroll">
            <table className="w-full border-collapse text-left text-xs">
              <thead className="sticky top-0 bg-surface border-b border-borderFolk text-[11px] uppercase tracking-wider text-muted">
                <tr>
                  <th className="px-3 py-2">Time</th>
                  <th className="px-3 py-2">Kind</th>
                  <th className="px-3 py-2">Actor</th>
                  <th className="px-3 py-2">With</th>
                  <th className="px-3 py-2">Location</th>
                  <th className="px-3 py-2">Content</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-borderFolk/50">
                {filteredDbRecords.slice(0, 200).map((r) => (
                  <tr key={r.id} className="hover:bg-surface/60 align-top">
                    <td className="px-3 py-2 font-mono text-[10px] text-muted whitespace-nowrap">
                      {formatTimeAgo(r.timestamp)}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className="rounded bg-surface border border-borderFolk px-1.5 py-0.5 font-mono text-[10px]">
                        {r.kind}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-semibold whitespace-nowrap">{r.actorName}</td>
                    <td className="px-3 py-2 text-muted whitespace-nowrap">
                      {r.partnerNames.join(', ') || '—'}
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px] text-amberFolk whitespace-nowrap">
                      {r.locationLabel}
                    </td>
                    <td className="px-3 py-2 max-w-xl">{r.text}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Mode 3: Scribe Narrative Loom */}
      {subTab === 'loom' && (
        <div className="grid flex-1 grid-cols-1 lg:grid-cols-[1fr_400px] overflow-hidden">
          <div className="flex flex-col overflow-hidden p-2.5 gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs">
                <label htmlFor="loom-worldline" className="font-semibold text-muted">
                  Thread Worldline:
                </label>
                <select
                  id="loom-worldline"
                  value={loomWorldline}
                  onChange={(e) => setLoomWorldline(e.target.value)}
                  className="rounded border border-borderFolk bg-card px-2 py-1 text-xs"
                >
                  <option value="all">All Worldlines</option>
                  {villagers.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}&apos;s Perspective
                    </option>
                  ))}
                </select>
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={loomIncludeThoughts}
                    onChange={(e) => setLoomIncludeThoughts(e.target.checked)}
                  />
                  <span>Include Inner Thoughts</span>
                </label>
              </div>
              <button
                type="button"
                onClick={handleWeaveChronicle}
                disabled={weaving}
                className="inline-flex items-center gap-1.5 rounded bg-crimson px-3 py-1.5 text-xs font-semibold text-white hover:opacity-95 disabled:opacity-50"
              >
                <Sparkles className="h-3.5 w-3.5" />
                <span>{weaving ? 'Weaving…' : 'Assemble Chronicle with Scribe'}</span>
              </button>
            </div>

            <div
              ref={loomScroll.containerRef}
              onScroll={loomScroll.handleScroll}
              className="relative flex-1 overflow-y-auto space-y-2 thin-scroll pr-1"
            >
              {loomRecords.map((r) => (
                <div
                  key={r.id}
                  className="rounded-sm border border-borderFolk bg-card px-3 py-2 text-xs"
                >
                  <div className="flex items-center justify-between text-[11px] text-muted mb-0.5">
                    <span>
                      <strong className="text-ink">{r.actorName}</strong> · {r.kind} ·{' '}
                      <span className="font-mono">{r.locationLabel}</span>
                    </span>
                    <span className="font-mono">{formatTimeAgo(r.timestamp)}</span>
                  </div>
                  <p className={r.kind === 'thought' ? 'italic text-muted' : 'text-ink'}>{r.text}</p>
                </div>
              ))}
              {!loomScroll.isFollowing && loomRecords.length > 0 && (
                <div className="sticky bottom-2 flex justify-center pt-1">
                  <button
                    type="button"
                    onClick={loomScroll.jumpToBottom}
                    className="inline-flex items-center gap-1 rounded-full border border-borderFolk bg-card/95 px-2.5 py-1 text-[11px] font-medium text-ink shadow-md backdrop-blur hover:bg-surface"
                  >
                    <ArrowDown className="h-3 w-3 text-indigoFolk" />
                    <span>Jump to Latest</span>
                  </button>
                </div>
              )}
            </div>
          </div>

          <aside className="flex flex-col border-l border-borderFolk bg-card p-2.5 gap-3 overflow-y-auto thin-scroll">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Eye className="h-4 w-4 text-ochre" />
                <h3 className="text-sm font-bold">Assembled Chronicle</h3>
              </div>
              <button
                type="button"
                onClick={handleDownloadChronicle}
                className="inline-flex items-center gap-1 rounded border border-borderFolk bg-surface px-2 py-1 text-xs hover:bg-card"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Export .md</span>
              </button>
            </div>
            {chronicleText ? (
              <div className="rounded-sm border border-ochre/30 bg-surface p-3 text-xs leading-relaxed whitespace-pre-wrap">
                {chronicleText}
              </div>
            ) : (
              <p className="text-xs text-muted">
                Click <strong>Assemble Chronicle with Scribe</strong> to weave the selected
                worldline&apos;s beats into a single cohesive story.
              </p>
            )}
          </aside>
        </div>
      )}
    </div>
  );
};
