import React from 'react';
import { Repeat, ArrowRight, ArrowLeftRight, Check, Pause, Play, ShieldCheck, Plus, Trash2 } from 'lucide-react';
import { SimCrossPost, SimGroup } from '../types';

interface CrossPostingViewProps {
  crossPosts: SimCrossPost[];
  groups: SimGroup[];
  onToggleActive: (id: number) => void;
  onChangeDirection: (id: number, direction: 'A_TO_B' | 'B_TO_A' | 'BIDIRECTIONAL') => void;
  onChangeMode: (id: number, mode: 'COPY' | 'FORWARD') => void;
}

export const CrossPostingView: React.FC<CrossPostingViewProps> = ({
  crossPosts,
  groups,
  onToggleActive,
  onChangeDirection,
  onChangeMode,
}) => {
  return (
    <div className="space-y-6">
      {/* Overview Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-3">
        <div className="flex items-center gap-2.5">
          <Repeat className="w-5 h-5 text-indigo-400" />
          <h2 className="text-base font-semibold text-white">Cross-Posting Pipeline Architecture</h2>
        </div>
        <p className="text-xs text-slate-300 leading-relaxed max-w-3xl">
          The cross-posting engine transfers messages, photos, videos, and documents between connected groups in real-time. Built with strict anti-loop safeguards: messages mirrored by the bot are fingerprinted in the database and never echoed back to the source.
        </p>
      </div>

      {/* Pipelines List */}
      <div className="space-y-4">
        {crossPosts.length === 0 ? (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-indigo-950/60 border border-indigo-800/80 flex items-center justify-center mx-auto text-indigo-400">
              <Repeat className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-white">No Active Cross-Posting Pipelines</h3>
              <p className="text-xs text-slate-400 max-w-md mx-auto">
                Connect two groups to mirror messages automatically between them with loop protection.
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
                        direction: 'BIDIRECTIONAL',
                        mode: 'COPY',
                      }),
                    });
                    window.location.reload();
                  }}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold shadow-lg shadow-indigo-600/30 transition-all cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>1-Click Connect: {groups[0].title} ⇄ {groups[1].title}</span>
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
          const groupA = groups.find((g) => g.id === cp.groupAId) || groups[0];
          const groupB = groups.find((g) => g.id === cp.groupBId) || groups[1];

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
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
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
                    Source Node
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
                    Destination Node
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
                      className={`p-2 rounded-lg text-xs font-medium border text-center transition-colors ${
                        cp.direction === 'A_TO_B'
                          ? 'bg-indigo-600/30 border-indigo-500 text-white'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      A ➔ B
                    </button>
                    <button
                      onClick={() => onChangeDirection(cp.id, 'B_TO_A')}
                      className={`p-2 rounded-lg text-xs font-medium border text-center transition-colors ${
                        cp.direction === 'B_TO_A'
                          ? 'bg-indigo-600/30 border-indigo-500 text-white'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      B ➔ A
                    </button>
                    <button
                      onClick={() => onChangeDirection(cp.id, 'BIDIRECTIONAL')}
                      className={`p-2 rounded-lg text-xs font-medium border text-center transition-colors ${
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
                      className={`p-2 rounded-lg text-xs font-medium border text-center transition-colors ${
                        cp.mode === 'COPY'
                          ? 'bg-indigo-600/30 border-indigo-500 text-white'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      Clean Copy (No attribution)
                    </button>
                    <button
                      onClick={() => onChangeMode(cp.id, 'FORWARD')}
                      className={`p-2 rounded-lg text-xs font-medium border text-center transition-colors ${
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

              {/* Safeguards Footer */}
              <div className="flex items-center gap-2 pt-2 text-[11px] text-slate-400 border-t border-slate-800/80">
                <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>
                  Anti-Loop Verification: Bot ignores its own outgoing messages, checks incoming forward origins, and matches against <code className="text-slate-300">CrossPostMessageMap</code> before delivery.
                </span>
              </div>
            </div>
          );
        }))}
      </div>
    </div>
  );
};
