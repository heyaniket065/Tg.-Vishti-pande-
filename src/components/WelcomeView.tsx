import React, { useState } from 'react';
import { UserCheck, Clock, Plus, Trash2, ExternalLink, Sparkles, Check } from 'lucide-react';
import { SimGroup, SimWelcomeConfig } from '../types';

interface WelcomeViewProps {
  groups: SimGroup[];
  welcomeConfigs: Record<number, SimWelcomeConfig>;
  selectedGroupId: number;
  onSelectGroup: (groupId: number) => void;
  onUpdateConfig: (groupId: number, newConfig: Partial<SimWelcomeConfig>) => void;
}

export const WelcomeView: React.FC<WelcomeViewProps> = ({
  groups,
  welcomeConfigs,
  selectedGroupId,
  onSelectGroup,
  onUpdateConfig,
}) => {
  const currentConfig = welcomeConfigs[selectedGroupId] || {
    groupId: selectedGroupId,
    isEnabled: true,
    templateText: '👋 Welcome to {group_name}, {first_name}!\nPlease read our group rules.',
    mediaUrl: null,
    deleteAfterSeconds: 60,
    buttons: [{ text: '📜 Read Rules', url: 'https://t.me/rules' }],
  };

  const [newBtnText, setNewBtnText] = useState('');
  const [newBtnUrl, setNewBtnUrl] = useState('');

  const selectedGroup = groups.find((g) => g.id === selectedGroupId) || groups[0];

  const handleAddButton = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBtnText.trim() || !newBtnUrl.trim()) return;

    const updatedButtons = [
      ...currentConfig.buttons,
      { text: newBtnText.trim(), url: newBtnUrl.trim() },
    ];
    onUpdateConfig(selectedGroupId, { buttons: updatedButtons });
    setNewBtnText('');
    setNewBtnUrl('');
  };

  const handleRemoveButton = (idx: number) => {
    const updatedButtons = currentConfig.buttons.filter((_, i) => i !== idx);
    onUpdateConfig(selectedGroupId, { buttons: updatedButtons });
  };

  // Preview formatted text
  const previewFormatted = currentConfig.templateText
    .replace('{first_name}', 'Alex')
    .replace('{last_name}', 'Morgan')
    .replace('{full_name}', 'Alex Morgan')
    .replace('{username}', '@alexmorgan')
    .replace('{group_name}', selectedGroup.title)
    .replace('{user_id}', '987654321');

  return (
    <div className="space-y-6">
      {/* Header & Group Selector */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <UserCheck className="w-5 h-5 text-indigo-400" />
            <h2 className="text-base font-semibold text-white">Welcome & Goodbye System</h2>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Greet new members automatically with dynamic placeholders, custom inline buttons, and auto-delete timers.
          </p>
        </div>

        {/* Group Selector */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">Configuring:</span>
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Editor Form */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-5">
          {/* Status Toggle */}
          <div className="flex items-center justify-between pb-4 border-b border-slate-800">
            <div>
              <span className="text-xs font-semibold text-white">Automated Welcome Messages</span>
              <p className="text-[11px] text-slate-400">Trigger on new user join event</p>
            </div>
            <button
              onClick={() => onUpdateConfig(selectedGroupId, { isEnabled: !currentConfig.isEnabled })}
              className={`px-3 py-1 text-xs font-medium rounded-lg transition-colors ${
                currentConfig.isEnabled
                  ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                  : 'bg-slate-800 text-slate-400'
              }`}
            >
              {currentConfig.isEnabled ? '🟢 Enabled' : '🔴 Disabled'}
            </button>
          </div>

          {/* Template Text Area */}
          <div className="space-y-2">
            <label className="block text-xs font-medium text-slate-300">
              Welcome Message Template
            </label>
            <textarea
              rows={4}
              value={currentConfig.templateText}
              onChange={(e) => onUpdateConfig(selectedGroupId, { templateText: e.target.value })}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg p-3 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
            />
            {/* Placeholder Pills */}
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              <span className="text-slate-500">Insert tags:</span>
              {['{first_name}', '{username}', '{group_name}', '{full_name}', '{user_id}'].map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() =>
                    onUpdateConfig(selectedGroupId, {
                      templateText: currentConfig.templateText + ` ${tag}`,
                    })
                  }
                  className="px-1.5 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded font-mono transition-colors"
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>

          {/* Auto-Delete Delay Selector */}
          <div className="space-y-2">
            <label className="block text-xs font-medium text-slate-300 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-indigo-400" />
                <span>Auto-Delete Countdown (Clean Chat Guard)</span>
              </span>
              <span className="text-[11px] text-indigo-400 font-mono">
                {currentConfig.deleteAfterSeconds > 0
                  ? `${currentConfig.deleteAfterSeconds} seconds`
                  : 'Never delete'}
              </span>
            </label>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              {[10, 30, 60, 120, 300, 0].map((sec) => (
                <button
                  key={sec}
                  type="button"
                  onClick={() => onUpdateConfig(selectedGroupId, { deleteAfterSeconds: sec })}
                  className={`py-1.5 text-xs font-mono rounded-lg border text-center transition-colors ${
                    currentConfig.deleteAfterSeconds === sec
                      ? 'bg-indigo-600/30 border-indigo-500 text-white font-semibold'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  {sec === 0 ? 'Never' : `${sec}s`}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-slate-500">
              Default is 60s. Prevents long-term clutter in high-activity discussion groups.
            </p>
          </div>

          {/* Inline Buttons Builder */}
          <div className="space-y-3 pt-2">
            <label className="block text-xs font-medium text-slate-300">
              Custom Inline URL Buttons
            </label>

            {/* Existing buttons */}
            <div className="space-y-2">
              {currentConfig.buttons.map((btn, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between p-2.5 bg-slate-950 border border-slate-800 rounded-lg text-xs"
                >
                  <div className="flex items-center gap-2 truncate">
                    <span className="font-medium text-white">{btn.text}</span>
                    <span className="text-slate-500 font-mono text-[11px] truncate">({btn.url})</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveButton(idx)}
                    className="text-slate-500 hover:text-red-400 p-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>

            {/* Add Button Form */}
            <form onSubmit={handleAddButton} className="grid grid-cols-1 sm:grid-cols-5 gap-2 pt-1">
              <input
                type="text"
                placeholder="Button Label (e.g. 📖 Rules)"
                value={newBtnText}
                onChange={(e) => setNewBtnText(e.target.value)}
                className="sm:col-span-2 bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
              />
              <input
                type="text"
                placeholder="URL (https://t.me/...)"
                value={newBtnUrl}
                onChange={(e) => setNewBtnUrl(e.target.value)}
                className="sm:col-span-2 bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 font-mono"
              />
              <button
                type="submit"
                disabled={!newBtnText.trim() || !newBtnUrl.trim()}
                className="sm:col-span-1 flex items-center justify-center gap-1 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-medium transition-colors disabled:opacity-50 py-1.5"
              >
                <Plus className="w-3 h-3" />
                <span>Add</span>
              </button>
            </form>
          </div>
        </div>

        {/* Live Telegram Preview */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-white">Telegram In-Chat Appearance</span>
            <span className="text-[11px] font-mono text-slate-400">
              Auto-delete: {currentConfig.deleteAfterSeconds}s
            </span>
          </div>

          <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 space-y-3">
            <div className="flex items-center gap-2 text-[11px] text-slate-400 font-mono">
              <span className="font-semibold text-emerald-400">TeleGroup Bot</span>
              <span>·</span>
              <span>Just now</span>
            </div>

            <div className="text-xs text-slate-200 leading-relaxed whitespace-pre-wrap">
              {previewFormatted}
            </div>

            {/* Buttons preview */}
            {currentConfig.buttons.length > 0 && (
              <div className="space-y-1.5 pt-2 border-t border-slate-800">
                {currentConfig.buttons.map((btn, idx) => (
                  <div
                    key={idx}
                    className="w-full py-2 px-3 text-center bg-slate-800/80 hover:bg-slate-700 border border-slate-700 rounded-md text-xs font-medium text-indigo-300 flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <span>{btn.text}</span>
                    <ExternalLink className="w-3 h-3 opacity-70" />
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="p-3 bg-slate-950/60 border border-slate-800/80 rounded-lg text-xs text-slate-400 space-y-1">
            <div className="font-medium text-slate-300 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
              <span>Auto-Deletion Lifecycle</span>
            </div>
            <p className="text-[11px] leading-relaxed">
              When a user joins, the bot dispatches this card, tracks its Telegram message ID, and schedules an asynchronous deletion task that fires after the selected timer delay without blocking other operations.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
