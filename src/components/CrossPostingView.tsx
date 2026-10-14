import React, { useState, useEffect } from 'react';
import {
  Repeat,
  ArrowRight,
  ArrowLeftRight,
  Pause,
  Play,
  ShieldCheck,
  Plus,
  Package,
  DownloadCloud,
  Loader2,
  CheckCircle2,
  XCircle,
  RefreshCw,
} from 'lucide-react';
import { SimCrossPost, SimGroup } from '../types';

interface CrossPostingViewProps {
  crossPosts: SimCrossPost[];
  groups: SimGroup[];
  onToggleActive: (id: number) => void;
  onChangeDirection: (id: number, direction: 'A_TO_B' | 'B_TO_A' | 'BIDIRECTIONAL') => void;
  onChangeMode: (id: number, mode: 'COPY' | 'FORWARD') => void;
}

interface SyncTaskState {
  pipelineId: number;
  isRunning: boolean;
  startId: number;
  endId: number;
  currentId: number;
  totalCopied: number;
  totalSkipped: number;
  status: 'idle' | 'running' | 'completed' | 'paused' | 'error';
  statusText?: string;
  error?: string;
}

export const CrossPostingView: React.FC<CrossPostingViewProps> = ({
  crossPosts,
  groups,
  onToggleActive,
  onChangeDirection,
  onChangeMode,
}) => {
  const [syncTasks, setSyncTasks] = useState<Record<number, SyncTaskState>>({});
  const [customRange, setCustomRange] = useState<Record<number, { startId: string; endId: string }>>({});
  const [syncMsg, setSyncMsg] = useState<Record<number, string>>({});

  // Poll sync status for any running tasks
  useEffect(() => {
    const hasRunning = Object.values(syncTasks).some((t) => t.isRunning);
    if (!hasRunning) return;

    const interval = setInterval(async () => {
      for (const cp of crossPosts) {
        try {
          const res = await fetch(`/api/crosspost/${cp.id}/sync-status`);
          const data = await res.json();
          if (data.ok && data.syncTask) {
            setSyncTasks((prev) => ({
              ...prev,
              [cp.id]: data.syncTask,
            }));
          }
        } catch {
          // Ignore polling errors
        }
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [syncTasks, crossPosts]);

  const handleStartSync = async (pipelineId: number, options: { limit?: number; startId?: number; endId?: number }) => {
    setSyncMsg((prev) => ({ ...prev, [pipelineId]: 'Initiating history sync...' }));
    try {
      const res = await fetch(`/api/crosspost/${pipelineId}/sync-history`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(options),
      });
      const data = await res.json();
      if (data.ok && data.syncState) {
        setSyncTasks((prev) => ({
          ...prev,
          [pipelineId]: data.syncState,
        }));
        setSyncMsg((prev) => ({ ...prev, [pipelineId]: 'Sync started in background! Transferring posts...' }));
      } else {
        setSyncMsg((prev) => ({ ...prev, [pipelineId]: `Error: ${data.error || 'Failed to start sync'}` }));
      }
    } catch (e: any) {
      setSyncMsg((prev) => ({ ...prev, [pipelineId]: `Error: ${e.message}` }));
    }
  };

  const handleCancelSync = async (pipelineId: number) => {
    try {
      await fetch(`/api/crosspost/${pipelineId}/sync-cancel`, { method: 'POST' });
      setSyncTasks((prev) => {
        const cur = prev[pipelineId];
        if (!cur) return prev;
        return {
          ...prev,
          [pipelineId]: { ...cur, isRunning: false, status: 'paused', statusText: 'Sync cancelled by user.' },
        };
      });
      setSyncMsg((prev) => ({ ...prev, [pipelineId]: 'Sync stopped.' }));
    } catch {
      // Ignore
    }
  };

  return (
    <div className="space-y-6">
      {/* Overview Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-3">
        <div className="flex items-center gap-2.5">
          <Repeat className="w-5 h-5 text-indigo-400" />
          <h2 className="text-base font-semibold text-white">Cross-Posting & History Sync Engine</h2>
        </div>
        <p className="text-xs text-slate-300 leading-relaxed max-w-3xl">
          Real-time cross-posting mirrors new incoming messages between groups. Use the <strong>History Backfill & Sync</strong> controls below to transfer all historical posts, photos, and media from Group A to Group B automatically so no old content is left behind.
        </p>
      </div>

      {/* Pipelines List */}
      <div className="space-y-6">
        {crossPosts.length === 0 ? (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-indigo-950/60 border border-indigo-800/80 flex items-center justify-center mx-auto text-indigo-400">
              <Repeat className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-white">No Cross-Posting Pipelines Configured</h3>
              <p className="text-xs text-slate-400 max-w-md mx-auto">
                Connect two groups or channels to start automatic cross-posting and full history synchronization.
              </p>
            </div>

            {groups.length >= 2 ? (
              <div className="pt-2">
                <button
                  onClick={async () => {
                    await fetch('/api/crosspost/create', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        groupAId: groups[0].id,
                        groupBId: groups[1].id,
                        direction: 'A_TO_B',
                        mode: 'COPY',
                      }),
                    });
                    window.location.reload();
                  }}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold shadow-lg shadow-indigo-600/30 transition-all cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>1-Click Connect: {groups[0].title} ➔ {groups[1].title} (A to B)</span>
                </button>
              </div>
            ) : (
              <p className="text-xs text-amber-400">
                Please connect at least 2 groups via <code className="bg-slate-800 px-1 py-0.5 rounded">/linkgroup</code> to start cross-posting.
              </p>
            )}
          </div>
        ) : (
          crossPosts.map((cp) => {
            const groupA = groups.find((g) => g.id === cp.groupAId) || groups[0] || { id: cp.groupAId, title: `Chat ${cp.groupAId}`, tgChatId: cp.groupAId };
            const groupB = groups.find((g) => g.id === cp.groupBId) || groups[1] || { id: cp.groupBId, title: `Chat ${cp.groupBId}`, tgChatId: cp.groupBId };

            const task = syncTasks[cp.id];
            const isSyncing = task?.isRunning;
            const range = customRange[cp.id] || { startId: '', endId: '' };

            const sourceGroup = cp.direction === 'B_TO_A' ? groupB : groupA;
            const destGroup = cp.direction === 'B_TO_A' ? groupA : groupB;

            return (
              <div
                key={cp.id}
                className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-6"
              >
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
                  <div>
                    <h3 className="text-sm font-semibold text-white">{cp.name}</h3>
                    <div className="flex items-center gap-2 text-xs text-slate-400 mt-1">
                      <span>Pipeline ID: #{cp.id}</span>
                      <span>·</span>
                      <span className="font-mono tabular-nums">Status: {cp.isActive ? 'Active' : 'Paused'}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => onToggleActive(cp.id)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
                        cp.isActive
                          ? 'bg-amber-950/70 text-amber-300 hover:bg-amber-900/60 border border-amber-800/80'
                          : 'bg-emerald-950/70 text-emerald-300 hover:bg-emerald-900/60 border border-emerald-800/80'
                      }`}
                    >
                      {cp.isActive ? (
                        <>
                          <Pause className="w-3.5 h-3.5" />
                          <span>Pause Pipeline</span>
                        </>
                      ) : (
                        <>
                          <Play className="w-3.5 h-3.5" />
                          <span>Resume Pipeline</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* Visual Routing Diagram */}
                <div className="p-5 bg-slate-950 border border-slate-800 rounded-lg flex flex-col md:flex-row items-center justify-between gap-6">
                  {/* Node A */}
                  <div className="flex-1 text-center md:text-left space-y-1">
                    <span className="text-[10px] text-slate-500 uppercase tracking-wider font-mono">
                      Group A
                    </span>
                    <div className="text-sm font-semibold text-white">{groupA.title}</div>
                    <div className="text-xs text-slate-400 font-mono">ID: {groupA.tgChatId}</div>
                  </div>

                  {/* Routing Icon & Direction */}
                  <div className="flex flex-col items-center gap-1 px-4 py-2 bg-slate-900 border border-slate-800 rounded-lg">
                    <div className="flex items-center gap-2 text-indigo-400 font-mono text-xs">
                      {cp.direction === 'A_TO_B' && (
                        <>
                          <span>A</span>
                          <ArrowRight className="w-4 h-4" />
                          <span>B</span>
                        </>
                      )}
                      {cp.direction === 'B_TO_A' && (
                        <>
                          <span>B</span>
                          <ArrowRight className="w-4 h-4" />
                          <span>A</span>
                        </>
                      )}
                      {cp.direction === 'BIDIRECTIONAL' && (
                        <>
                          <ArrowLeftRight className="w-4 h-4" />
                          <span>Bidirectional</span>
                        </>
                      )}
                    </div>
                    <span className="text-[10px] text-slate-400">
                      Mode: {cp.mode === 'COPY' ? 'Clean Copy' : 'Forward Header'}
                    </span>
                  </div>

                  {/* Node B */}
                  <div className="flex-1 text-center md:text-right space-y-1">
                    <span className="text-[10px] text-slate-500 uppercase tracking-wider font-mono">
                      Group B
                    </span>
                    <div className="text-sm font-semibold text-white">{groupB.title}</div>
                    <div className="text-xs text-slate-400 font-mono">ID: {groupB.tgChatId}</div>
                  </div>
                </div>

                {/* Pipeline Controls Form */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-2">
                      Routing Direction
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        onClick={() => onChangeDirection(cp.id, 'A_TO_B')}
                        className={`p-2 rounded-lg text-xs font-medium border text-center transition-colors cursor-pointer ${
                          cp.direction === 'A_TO_B'
                            ? 'bg-indigo-600/30 border-indigo-500 text-white'
                            : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                        }`}
                      >
                        A ➔ B
                      </button>
                      <button
                        onClick={() => onChangeDirection(cp.id, 'B_TO_A')}
                        className={`p-2 rounded-lg text-xs font-medium border text-center transition-colors cursor-pointer ${
                          cp.direction === 'B_TO_A'
                            ? 'bg-indigo-600/30 border-indigo-500 text-white'
                            : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                        }`}
                      >
                        B ➔ A
                      </button>
                      <button
                        onClick={() => onChangeDirection(cp.id, 'BIDIRECTIONAL')}
                        className={`p-2 rounded-lg text-xs font-medium border text-center transition-colors cursor-pointer ${
                          cp.direction === 'BIDIRECTIONAL'
                            ? 'bg-indigo-600/30 border-indigo-500 text-white'
                            : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                        }`}
                      >
                        Bidirectional
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-2">
                      Message Transfer Mode
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => onChangeMode(cp.id, 'COPY')}
                        className={`p-2 rounded-lg text-xs font-medium border text-center transition-colors cursor-pointer ${
                          cp.mode === 'COPY'
                            ? 'bg-indigo-600/30 border-indigo-500 text-white'
                            : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                        }`}
                      >
                        Clean Copy (No attribution)
                      </button>
                      <button
                        onClick={() => onChangeMode(cp.id, 'FORWARD')}
                        className={`p-2 rounded-lg text-xs font-medium border text-center transition-colors cursor-pointer ${
                          cp.mode === 'FORWARD'
                            ? 'bg-indigo-600/30 border-indigo-500 text-white'
                            : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                        }`}
                      >
                        Forward (With attribution)
                      </button>
                    </div>
                  </div>
                </div>

                {/* ================================================================= */}
                {/* 📦 HISTORY BACKFILL & TRANSFER PANEL (Sync all past posts from A to B) */}
                {/* ================================================================= */}
                <div className="bg-gradient-to-br from-indigo-950/40 via-slate-950 to-slate-950 border border-indigo-900/60 rounded-xl p-5 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Package className="w-5 h-5 text-indigo-400 shrink-0" />
                      <div>
                        <h4 className="text-sm font-bold text-white">
                          Sync All Past Posts / मागील जुने मेसेज ट्रान्सफर करा
                        </h4>
                        <p className="text-[11px] text-slate-300 mt-0.5">
                          Source: <strong>{sourceGroup.title}</strong> ➔ Destination: <strong>{destGroup.title}</strong>
                        </p>
                      </div>
                    </div>

                    {isSyncing && (
                      <div className="flex items-center gap-2 bg-indigo-950 px-3 py-1 rounded-full border border-indigo-700">
                        <Loader2 className="w-3.5 h-3.5 text-indigo-400 animate-spin" />
                        <span className="text-[11px] font-medium text-indigo-200">Syncing in background...</span>
                      </div>
                    )}
                  </div>

                  <p className="text-xs text-slate-300 leading-relaxed">
                    Telegram standard bots only receive live incoming messages. Use this feature to clone past historical posts, photos, videos, and media from <strong>{sourceGroup.title}</strong> into <strong>{destGroup.title}</strong> without missing any content.
                  </p>

                  {/* Sync Preset Buttons */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                    <button
                      disabled={isSyncing}
                      onClick={() => handleStartSync(cp.id, { limit: 50 })}
                      className="p-2.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-slate-200 border border-slate-800 hover:border-indigo-500 rounded-lg text-xs font-semibold text-center transition-all cursor-pointer flex flex-col items-center gap-1"
                    >
                      <span>⚡ Last 50 Posts</span>
                      <span className="text-[10px] text-slate-400 font-normal">शेवटचे 50 मेसेज</span>
                    </button>

                    <button
                      disabled={isSyncing}
                      onClick={() => handleStartSync(cp.id, { limit: 200 })}
                      className="p-2.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-slate-200 border border-slate-800 hover:border-indigo-500 rounded-lg text-xs font-semibold text-center transition-all cursor-pointer flex flex-col items-center gap-1"
                    >
                      <span>🚀 Last 200 Posts</span>
                      <span className="text-[10px] text-slate-400 font-normal">शेवटचे 200 मेसेज</span>
                    </button>

                    <button
                      disabled={isSyncing}
                      onClick={() => handleStartSync(cp.id, { limit: 500 })}
                      className="p-2.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-slate-200 border border-slate-800 hover:border-indigo-500 rounded-lg text-xs font-semibold text-center transition-all cursor-pointer flex flex-col items-center gap-1"
                    >
                      <span>📦 Last 500 Posts</span>
                      <span className="text-[10px] text-slate-400 font-normal">शेवटचे 500 मेसेज</span>
                    </button>

                    <button
                      disabled={isSyncing}
                      onClick={() => handleStartSync(cp.id, { startId: 1 })}
                      className="p-2.5 bg-indigo-950/80 hover:bg-indigo-900/80 disabled:opacity-50 text-indigo-200 border border-indigo-700 rounded-lg text-xs font-bold text-center transition-all cursor-pointer flex flex-col items-center gap-1 shadow-sm"
                    >
                      <span>🌟 Full History (From #1)</span>
                      <span className="text-[10px] text-indigo-300 font-normal">सर्व जुने मेसेज</span>
                    </button>
                  </div>

                  {/* Custom ID Range & Manual Start */}
                  <div className="flex flex-col sm:flex-row items-center gap-2 pt-1">
                    <span className="text-xs text-slate-400 shrink-0">Custom Range:</span>
                    <input
                      type="number"
                      placeholder="Start ID (e.g. 1)"
                      value={range.startId}
                      onChange={(e) =>
                        setCustomRange((prev) => ({
                          ...prev,
                          [cp.id]: { ...range, startId: e.target.value },
                        }))
                      }
                      className="w-full sm:w-28 bg-slate-950 border border-slate-700 rounded-md px-2.5 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                    />
                    <span className="text-slate-500 text-xs">➔</span>
                    <input
                      type="number"
                      placeholder="End ID (e.g. 150)"
                      value={range.endId}
                      onChange={(e) =>
                        setCustomRange((prev) => ({
                          ...prev,
                          [cp.id]: { ...range, endId: e.target.value },
                        }))
                      }
                      className="w-full sm:w-28 bg-slate-950 border border-slate-700 rounded-md px-2.5 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                    />
                    <button
                      disabled={isSyncing || (!range.startId && !range.endId)}
                      onClick={() =>
                        handleStartSync(cp.id, {
                          startId: range.startId ? parseInt(range.startId) : undefined,
                          endId: range.endId ? parseInt(range.endId) : undefined,
                        })
                      }
                      className="w-full sm:w-auto px-4 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-white rounded-md text-xs font-semibold cursor-pointer shrink-0 transition-colors"
                    >
                      Transfer Range
                    </button>

                    {isSyncing && (
                      <button
                        onClick={() => handleCancelSync(cp.id)}
                        className="w-full sm:w-auto px-3 py-1.5 bg-red-950/80 text-red-300 hover:bg-red-900 border border-red-800 rounded-md text-xs font-medium cursor-pointer shrink-0 transition-colors"
                      >
                        Stop Sync
                      </button>
                    )}
                  </div>

                  {/* Progress / Status Feedback */}
                  {(task || syncMsg[cp.id]) && (
                    <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-1.5 font-medium text-slate-200">
                          {isSyncing ? (
                            <Loader2 className="w-3.5 h-3.5 text-indigo-400 animate-spin" />
                          ) : task?.status === 'completed' ? (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <Package className="w-3.5 h-3.5 text-slate-400" />
                          )}
                          <span>{task?.statusText || syncMsg[cp.id]}</span>
                        </div>

                        {task && (
                          <span className="font-mono text-[11px] text-slate-400">
                            Copied: <strong className="text-emerald-400">{task.totalCopied}</strong> | Skipped: {task.totalSkipped}
                          </span>
                        )}
                      </div>

                      {task && task.endId > task.startId && (
                        <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                          <div
                            className="bg-indigo-500 h-1.5 rounded-full transition-all duration-300"
                            style={{
                              width: `${Math.min(
                                100,
                                Math.round(((task.currentId - task.startId) / (task.endId - task.startId || 1)) * 100)
                              )}%`,
                            }}
                          ></div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Safeguards Footer */}
                <div className="flex items-center gap-2 pt-2 text-[11px] text-slate-400 border-t border-slate-800/80">
                  <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>
                    Anti-Loop Safeguard Active: Outgoing posts are marked to prevent bounce-back loops. Rate-limited at safe intervals to protect your Telegram bot account from flood limits.
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
