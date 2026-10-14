import React from 'react';
import { Shield, AlertTriangle, Ban, Clock, Filter, FileText, CheckCircle2, Camera, Trash2 } from 'lucide-react';
import { SimGroup, SimModLog, SimWarnRecord } from '../types';

interface ModerationViewProps {
  groups: SimGroup[];
  selectedGroupId: number;
  onSelectGroup: (groupId: number) => void;
  onUpdateGroup: (groupId: number, updates: Partial<SimGroup>) => void;
  modLogs: SimModLog[];
  warnings: SimWarnRecord[];
}

export const ModerationView: React.FC<ModerationViewProps> = ({
  groups,
  selectedGroupId,
  onSelectGroup,
  onUpdateGroup,
  modLogs,
  warnings,
}) => {
  const currentGroup = groups.find((g) => g.id === selectedGroupId) || groups[0];

  return (
    <div className="space-y-6">
      {/* Top Header & Group Selector */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-indigo-400" />
            <h2 className="text-base font-semibold text-white">Group Moderation & Anti-Spam Safety</h2>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Configure automated warning thresholds, punishment triggers, flood limits, link blockers, and group rules.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">Managing:</span>
          <select
            value={selectedGroupId}
            onChange={(e) => onSelectGroup(Number(e.target.value))}
            className="bg-slate-950 border border-slate-700 text-xs text-white rounded-lg px-3 py-1.5 focus:outline-none focus:border-indigo-500 font-medium"
          >
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.title}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Grid: Moderation Thresholds & Anti-Spam */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Module A: Warnings & Punishment Threshold */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-5">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <h3 className="text-xs font-semibold text-white">Warning System Parameters</h3>
            <span className="text-[11px] font-mono text-slate-400">/warn & /resetwarn</span>
          </div>

          {/* Warn Limit Slider */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-slate-300">Warning Threshold</span>
              <span className="font-mono text-indigo-400 font-bold tabular-nums">
                {currentGroup.warnLimit} Warnings
              </span>
            </div>
            <input
              type="range"
              min={1}
              max={5}
              value={currentGroup.warnLimit}
              onChange={(e) => onUpdateGroup(selectedGroupId, { warnLimit: Number(e.target.value) })}
              className="w-full accent-indigo-500 cursor-pointer"
            />
            <p className="text-[11px] text-slate-500">
              When a member accumulates {currentGroup.warnLimit} warnings, the bot automatically executes the configured punishment.
            </p>
          </div>

          {/* Action on Threshold */}
          <div className="space-y-2">
            <label className="block text-xs font-medium text-slate-300">
              Threshold Punishment Action
            </label>
            <div className="grid grid-cols-3 gap-2">
              {['mute', 'kick', 'ban'].map((act) => (
                <button
                  key={act}
                  type="button"
                  onClick={() => onUpdateGroup(selectedGroupId, { warnAction: act })}
                  className={`py-2 text-xs font-medium rounded-lg border uppercase transition-colors ${
                    currentGroup.warnAction === act
                      ? 'bg-indigo-600/30 border-indigo-500 text-white font-semibold'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  {act}
                </button>
              ))}
            </div>
          </div>

          {/* Mute Duration */}
          <div className="space-y-2">
            <label className="block text-xs font-medium text-slate-300">
              Default Mute Duration (minutes)
            </label>
            <div className="grid grid-cols-4 gap-2">
              {[15, 60, 120, 1440].map((mins) => (
                <button
                  key={mins}
                  type="button"
                  onClick={() => onUpdateGroup(selectedGroupId, { muteDurationMinutes: mins })}
                  className={`py-1.5 text-xs font-mono rounded-lg border transition-colors ${
                    currentGroup.muteDurationMinutes === mins
                      ? 'bg-indigo-600/30 border-indigo-500 text-white'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  {mins === 1440 ? '24h' : `${mins}m`}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Module B: Anti-Spam & Automated Protections */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-5">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <h3 className="text-xs font-semibold text-white">Automated Group Defenses</h3>
            <span className="text-[11px] font-mono text-emerald-400">24/7 Active Filter</span>
          </div>

          {/* Block External Links Toggle */}
          <div className="flex items-center justify-between p-3 bg-slate-950 border border-slate-800 rounded-lg">
            <div>
              <span className="text-xs font-medium text-white">Block External Links</span>
              <p className="text-[11px] text-slate-400">
                Deletes messages with <code className="text-slate-300">http://</code>, <code className="text-slate-300">https://</code>, and <code className="text-slate-300">t.me/</code>
              </p>
            </div>
            <button
              onClick={() => onUpdateGroup(selectedGroupId, { blockLinks: !currentGroup.blockLinks })}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                currentGroup.blockLinks
                  ? 'bg-red-950 text-red-300 border border-red-800'
                  : 'bg-slate-800 text-slate-400'
              }`}
            >
              {currentGroup.blockLinks ? 'Blocked' : 'Allowed'}
            </button>
          </div>

          {/* Flood Limit */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-slate-300">Flood Control Rate</span>
              <span className="font-mono text-indigo-400 tabular-nums">
                Max {currentGroup.floodLimit} msgs / 5 sec
              </span>
            </div>
            <input
              type="range"
              min={2}
              max={10}
              value={currentGroup.floodLimit}
              onChange={(e) => onUpdateGroup(selectedGroupId, { floodLimit: Number(e.target.value) })}
              className="w-full accent-indigo-500 cursor-pointer"
            />
          </div>

          {/* Blocked Words Filter */}
          <div className="space-y-2">
            <label className="block text-xs font-medium text-slate-300">
              Blocked Phrases & Words (comma-separated)
            </label>
            <input
              type="text"
              value={currentGroup.blockedWords}
              onChange={(e) => onUpdateGroup(selectedGroupId, { blockedWords: e.target.value })}
              placeholder="e.g. scam, free crypto, airdrop"
              className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-xs text-white focus:outline-none focus:border-indigo-500 font-mono"
            />
          </div>
        </div>
      </div>

      {/* Module C: Photo & Media Auto-Delete (आपला फोटो डिलीट सिस्टीम) */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-pink-950/60 border border-pink-800/80 flex items-center justify-center text-pink-400">
              <Camera className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs font-semibold text-white flex items-center gap-2">
                <span>Photo & Media Auto-Delete / फोटो ऑटो-डिलीट</span>
                <span className="text-[10px] bg-pink-950 text-pink-300 font-mono px-2 py-0.5 rounded-full border border-pink-800">
                  Auto-Destruct
                </span>
              </h3>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Automatically deletes uploaded photos, videos, and media after a configured countdown to keep group clean and private.
              </p>
            </div>
          </div>

          <button
            onClick={() =>
              onUpdateGroup(selectedGroupId, {
                photoAutoDeleteEnabled: !currentGroup.photoAutoDeleteEnabled,
                photoAutoDeleteSeconds: currentGroup.photoAutoDeleteSeconds || 60,
              })
            }
            className={`px-4 py-1.5 text-xs font-medium rounded-lg transition-colors cursor-pointer shrink-0 ${
              currentGroup.photoAutoDeleteEnabled
                ? 'bg-pink-950 text-pink-300 border border-pink-800 hover:bg-pink-900/60'
                : 'bg-slate-800 text-slate-400 hover:text-white'
            }`}
          >
            {currentGroup.photoAutoDeleteEnabled ? '🟢 Auto-Delete Enabled' : '⚪ Auto-Delete Disabled'}
          </button>
        </div>

        {currentGroup.photoAutoDeleteEnabled && (
          <div className="space-y-3 pt-1">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-slate-300">Auto-Destruct Timer (Sec / Min)</span>
              <span className="font-mono text-pink-400">
                {currentGroup.photoAutoDeleteSeconds && currentGroup.photoAutoDeleteSeconds >= 60
                  ? `${Math.round(currentGroup.photoAutoDeleteSeconds / 60)} min (${currentGroup.photoAutoDeleteSeconds}s)`
                  : `${currentGroup.photoAutoDeleteSeconds || 60} seconds`}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {[
                { label: '30s (Instant)', sec: 30 },
                { label: '60s (1 Min)', sec: 60 },
                { label: '5 Minutes', sec: 300 },
                { label: '15 Minutes', sec: 900 },
                { label: '1 Hour', sec: 3600 },
              ].map((opt) => (
                <button
                  key={opt.sec}
                  type="button"
                  onClick={() => onUpdateGroup(selectedGroupId, { photoAutoDeleteSeconds: opt.sec })}
                  className={`py-2 text-xs font-mono rounded-lg border transition-colors cursor-pointer ${
                    (currentGroup.photoAutoDeleteSeconds || 60) === opt.sec
                      ? 'bg-pink-950/80 border-pink-600 text-pink-200 font-bold'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 text-[11px] text-slate-400 bg-slate-950 p-3 rounded-lg border border-slate-800">
              <Trash2 className="w-4 h-4 text-pink-400 shrink-0" />
              <span>
                <strong>Quick Commands in Group:</strong> Admins can also reply to any photo or message with <code className="text-pink-300">/del</code> to delete it instantly, or use <code className="text-pink-300">/purge 10</code> to bulk delete recent messages.
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Group Rules Editor */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-indigo-400" />
            <h3 className="text-xs font-semibold text-white">Group Rules (Served via /rules command)</h3>
          </div>
          <span className="text-[11px] text-slate-500 font-mono">Markdown supported</span>
        </div>
        <textarea
          rows={3}
          value={currentGroup.rulesText}
          onChange={(e) => onUpdateGroup(selectedGroupId, { rulesText: e.target.value })}
          className="w-full bg-slate-950 border border-slate-700 rounded-lg p-3 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
        />
      </div>

      {/* Active Warnings Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
          <div>
            <h3 className="text-xs font-semibold text-white">Active Member Warnings</h3>
            <p className="text-[11px] text-slate-400">Current warning strikes accumulated by members</p>
          </div>
          <span className="text-xs font-mono text-slate-400 tabular-nums">
            Total records: {warnings.length}
          </span>
        </div>

        {warnings.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">
            No active warning strikes in this group. Use <code className="text-slate-400">/warn</code> in chat to issue strikes.
          </div>
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950 text-slate-400 border-b border-slate-800">
              <tr>
                <th className="py-2.5 px-6 font-medium">Member</th>
                <th className="py-2.5 px-4 font-medium">Reason</th>
                <th className="py-2.5 px-4 font-medium">Warned By</th>
                <th className="py-2.5 px-6 font-medium">Timestamp</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 font-mono text-slate-300">
              {warnings.map((w) => (
                <tr key={w.id} className="hover:bg-slate-850/40">
                  <td className="py-3 px-6 text-white font-sans font-medium">{w.userName}</td>
                  <td className="py-3 px-4 font-sans text-slate-300">{w.reason}</td>
                  <td className="py-3 px-4 text-slate-400">{w.warnedBy}</td>
                  <td className="py-3 px-6 text-slate-500 tabular-nums">{w.timestamp}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
