import React, { useState, useEffect } from 'react';
import {
  Users,
  Send,
  Clock,
  Trash2,
  Sparkles,
  Gamepad2,
  MessageSquare,
  Flame,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  ExternalLink,
  Shield,
  Zap,
} from 'lucide-react';
import { ManagedBot, SimGroup } from '../types';
import { AppLanguage } from '../i18n';

interface BotSquadViewProps {
  groups: SimGroup[];
  appLanguage: AppLanguage;
}

export const BotSquadView: React.FC<BotSquadViewProps> = ({ groups, appLanguage }) => {
  const [squad, setSquad] = useState<ManagedBot[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedChatId, setSelectedChatId] = useState<number>(() => {
    return groups[0]?.id || -1004315910637;
  });

  // Action status notification
  const [actionStatus, setActionStatus] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [isSending, setIsSending] = useState(false);

  // Poll Customizer state
  const [pollQuestion, setPollQuestion] = useState('🔥 पुढचं काय अपलोड करू? / What should we post next? 💋');
  const [pollOptions, setPollOptions] = useState<string[]>([
    '📸 Exclusive Photos',
    '🎬 Short Video Clips / Reels',
    '💋 Both / दोन्हीही पाहिजेत!',
  ]);

  // Meme Customizer state
  const [memeCaption, setMemeCaption] = useState(
    '💀 **Myra\'s Late Night Lounge & Memes** 🍷\n\nरात्री 12 नंतरचा मूड काही वेगळाच असतो... 🍷🔥 कोणाकोणाचा स्लीप सायकल खराब झालाय? खाली तुमचे इमोजी रिअॅक्शन द्या! 💋💦'
  );

  const loadSquad = async () => {
    try {
      const res = await fetch('/api/botsquad');
      if (res.ok) {
        const data = await res.json();
        setSquad(data.squad || []);
      }
    } catch (err: any) {
      console.error('Failed to load bot squad:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadSquad();
    const interval = setInterval(loadSquad, 15000);
    return () => clearInterval(interval);
  }, []);

  const handleUpdateBotSettings = async (botId: string, updates: { cooldownMinutes?: number; autoDeleteHours?: number }) => {
    try {
      const res = await fetch('/api/botsquad/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botId, ...updates }),
      });
      if (res.ok) {
        await loadSquad();
        setActionStatus({ type: 'success', text: 'Bot settings updated successfully!' });
      }
    } catch (err: any) {
      setActionStatus({ type: 'error', text: err.message });
    }
  };

  const handlePostActivity = async (botId: string, activityType: 'poll' | 'game' | 'meme', force = false) => {
    if (!selectedChatId) {
      setActionStatus({ type: 'error', text: 'Please select a target group or channel first.' });
      return;
    }

    setIsSending(true);
    setActionStatus(null);
    try {
      const payload: any = {
        botId,
        chatId: selectedChatId,
        activityType,
        force,
      };

      if (activityType === 'poll') {
        payload.customQuestion = pollQuestion;
        payload.pollOptions = pollOptions.filter((o) => o.trim().length > 0);
      } else if (activityType === 'meme') {
        payload.customCaption = memeCaption;
      }

      const res = await fetch('/api/botsquad/post-activity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (res.ok && data.ok) {
        setActionStatus({
          type: 'success',
          text: `🎉 ${data.botName} successfully posted ${activityType.toUpperCase()} to "${data.chatTitle}"! ${
            data.deleteHours > 0 ? `(Auto-deletes in ${data.deleteHours} hours)` : ''
          }`,
        });
        await loadSquad();
      } else {
        setActionStatus({
          type: 'error',
          text: data.error || 'Failed to dispatch activity.',
        });
      }
    } catch (err: any) {
      setActionStatus({ type: 'error', text: err.message });
    } finally {
      setIsSending(false);
    }
  };

  const availableGroups = groups.filter((g) => g.id !== 1 && g.id !== 2);

  return (
    <div className="space-y-6">
      {/* Hero Header */}
      <div className="bg-gradient-to-r from-purple-950/60 via-slate-900 to-slate-900 border border-purple-800/60 rounded-xl p-6 sm:p-7 shadow-xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-pink-400 animate-pulse"></span>
              <span className="text-xs font-bold uppercase tracking-wider text-pink-400">
                4-Bot Autonomous Community Squad
              </span>
            </div>
            <h1 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-2">
              <span>TeleGroup 4-Bot Squad & Community Hub</span>
              <span className="text-xs font-mono bg-purple-900/60 text-purple-300 px-2 py-0.5 rounded-full border border-purple-700">
                24/7 Active
              </span>
            </h1>
            <p className="text-xs sm:text-sm text-slate-300 max-w-3xl leading-relaxed">
              {appLanguage === 'marathi'
                ? 'प्रत्येक बॉटची स्वतंत्र भूमिका आहे: वृष्टी पांडे (मुख्य ॲडमिन व क्रॉस-पोस्टिंग), शनाया गिल (पोल्स व व्होटिंग), कियारा सिंघानिया (गेम्स व ट्रुथ/डेअर), आणि मायरा ओबेरॉय (अडल्ट मीम्स, गिफ्स व रिअॅक्शन बोर्ड). मुख्य चॅनेल स्वच्छ ठेवण्यासाठी सर्व ऍक्टिव्हिटी मेसेज ठराविक तासांनंतर आपोआप ऑटो-डिलीट होतात.'
                : 'Each bot operates with a distinct personality and role: Vrishti Pande (Master Admin & Cross-Posting), Shanaya Gill (Polls & Voting), Kiara Singhania (Party Games & Truth/Dare), and Myra Oberoi (Memes, GIFs & Live Reaction Boards). Messages automatically auto-destruct to keep channels clean.'}
            </p>
          </div>

          <button
            onClick={loadSquad}
            className="flex items-center gap-2 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold shrink-0 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Refresh Status</span>
          </button>
        </div>

        {/* Global Target Chat Selector */}
        <div className="mt-5 pt-4 border-t border-slate-800/80 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-slate-950/60 p-3.5 rounded-lg border border-slate-800">
          <div className="flex items-center gap-2">
            <Send className="w-4 h-4 text-pink-400 shrink-0" />
            <span className="text-xs font-medium text-slate-200">Target Group / Channel for Activity:</span>
          </div>

          <select
            value={selectedChatId}
            onChange={(e) => setSelectedChatId(Number(e.target.value))}
            className="w-full sm:w-auto bg-slate-900 border border-slate-700 text-white rounded-md px-3 py-1.5 text-xs font-semibold focus:outline-none focus:border-pink-500"
          >
            {availableGroups.length > 0 ? (
              availableGroups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.title} ({g.type === 'channel' ? 'Channel' : 'Group'}) · ID: {g.tgChatId}
                </option>
              ))
            ) : (
              <option value="-1004315910637">Strip club 🍷 (-1004315910637)</option>
            )}
          </select>
        </div>
      </div>

      {/* Action Notification */}
      {actionStatus && (
        <div
          className={`p-4 rounded-xl text-xs flex items-center justify-between gap-3 ${
            actionStatus.type === 'success'
              ? 'bg-emerald-950/80 border border-emerald-800 text-emerald-200'
              : 'bg-rose-950/80 border border-rose-800 text-rose-200'
          }`}
        >
          <div className="flex items-center gap-2">
            {actionStatus.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            )}
            <span>{actionStatus.text}</span>
          </div>
          <button
            onClick={() => setActionStatus(null)}
            className="text-[11px] underline opacity-80 hover:opacity-100 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* 4 Bots Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {squad.map((bot) => {
          const isMaster = bot.id === 'vrishti';
          const isShanaya = bot.id === 'shanaya';
          const isKiara = bot.id === 'kiara';
          const isMyra = bot.id === 'myra';

          return (
            <div
              key={bot.id}
              className="bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-xl p-5 sm:p-6 space-y-5 transition-all shadow-lg flex flex-col justify-between"
            >
              <div className="space-y-4">
                {/* Bot Profile Header */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-slate-800 to-slate-950 border border-slate-700 flex items-center justify-center text-2xl shadow-inner shrink-0">
                      {bot.avatarEmoji}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-base font-bold text-white">{bot.name}</h3>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-slate-300">
                          {bot.persona}
                        </span>
                      </div>
                      <div className="text-xs text-slate-400 flex items-center gap-2 mt-0.5">
                        <a
                          href={`https://t.me/${bot.username}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-pink-400 hover:text-pink-300 font-mono flex items-center gap-1"
                        >
                          <span>@{bot.username || bot.id}</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                        <span>·</span>
                        <span className="text-emerald-400 font-mono text-[11px]">🟢 Online (Polling)</span>
                      </div>
                    </div>
                  </div>

                  <span className="text-xs font-mono text-slate-500">
                    ID: {bot.botId || 'Verified'}
                  </span>
                </div>

                {/* Role Description */}
                <div className="p-3 bg-slate-950 border border-slate-800/80 rounded-lg space-y-1">
                  <div className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider">
                    Role & Specialty / भूमिका:
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    {appLanguage === 'marathi' ? bot.roleMarathi : bot.role}
                  </p>
                </div>

                {/* Automation Rules: Cooldown & Auto-Delete Timer */}
                {!isMaster && (
                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-2.5 space-y-1">
                      <div className="flex items-center justify-between text-xs text-slate-400">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5 text-amber-400" />
                          <span>Cooldown</span>
                        </span>
                        <span className="font-mono text-white text-[11px]">
                          {bot.cooldownMinutes > 0 ? `${bot.cooldownMinutes} min` : 'None'}
                        </span>
                      </div>
                      <select
                        value={bot.cooldownMinutes}
                        onChange={(e) =>
                          handleUpdateBotSettings(bot.id, { cooldownMinutes: Number(e.target.value) })
                        }
                        className="w-full bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded px-2 py-1 focus:outline-none"
                      >
                        <option value="0">0m (No Cooldown)</option>
                        <option value="15">15 Minutes</option>
                        <option value="30">30 Minutes (Recommended)</option>
                        <option value="60">1 Hour</option>
                        <option value="120">2 Hours</option>
                      </select>
                    </div>

                    <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-2.5 space-y-1">
                      <div className="flex items-center justify-between text-xs text-slate-400">
                        <span className="flex items-center gap-1">
                          <Trash2 className="w-3.5 h-3.5 text-pink-400" />
                          <span>Auto-Delete</span>
                        </span>
                        <span className="font-mono text-pink-300 text-[11px]">
                          {bot.autoDeleteHours > 0 ? `${bot.autoDeleteHours}h Destruct` : 'Never'}
                        </span>
                      </div>
                      <select
                        value={bot.autoDeleteHours}
                        onChange={(e) =>
                          handleUpdateBotSettings(bot.id, { autoDeleteHours: Number(e.target.value) })
                        }
                        className="w-full bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded px-2 py-1 focus:outline-none"
                      >
                        <option value="1">1 Hour</option>
                        <option value="2">2 Hours (Default)</option>
                        <option value="6">6 Hours</option>
                        <option value="12">12 Hours</option>
                        <option value="24">24 Hours</option>
                        <option value="0">Never (Stay in Chat)</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>

              {/* Bot-Specific Action Launchers */}
              <div className="pt-4 border-t border-slate-800 space-y-2">
                {isMaster && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-xs text-emerald-400">
                      <Shield className="w-4 h-4" />
                      <span>Controls Group Rules, Moderation, Cross-Posting & /autofix</span>
                    </div>
                    <a
                      href={`https://t.me/${bot.username}?start=menu`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-colors"
                    >
                      <span>Open Master Dashboard in Telegram</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                )}

                {isShanaya && (
                  <div className="space-y-2">
                    <button
                      disabled={isSending}
                      onClick={() => handlePostActivity('shanaya', 'poll', true)}
                      className="w-full py-2.5 bg-gradient-to-r from-pink-600 to-rose-600 hover:from-pink-500 hover:to-rose-500 disabled:opacity-50 text-white rounded-lg text-xs font-bold flex items-center justify-center gap-2 shadow-md shadow-pink-900/40 transition-all cursor-pointer"
                    >
                      <Sparkles className="w-4 h-4" />
                      <span>1-Click Post Poll: "🔥 पुढचं काय अपलोड करू? (Photo/Video)"</span>
                    </button>
                    <div className="text-[11px] text-slate-400 text-center">
                      Auto-deletes from main chat in <strong>{bot.autoDeleteHours} hours</strong> to prevent clutter.
                    </div>
                  </div>
                )}

                {isKiara && (
                  <div className="space-y-2">
                    <button
                      disabled={isSending}
                      onClick={() => handlePostActivity('kiara', 'game', true)}
                      className="w-full py-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 disabled:opacity-50 text-white rounded-lg text-xs font-bold flex items-center justify-center gap-2 shadow-md shadow-purple-900/40 transition-all cursor-pointer"
                    >
                      <Gamepad2 className="w-4 h-4" />
                      <span>1-Click Start Truth or Dare (Adult/Spicy Edition) 🎲</span>
                    </button>
                    <div className="text-[11px] text-slate-400 text-center">
                      Interactive inline buttons: [🍷 Truth] [💋 Dare] [🔥 Spicy] with instant response!
                    </div>
                  </div>
                )}

                {isMyra && (
                  <div className="space-y-2">
                    <button
                      disabled={isSending}
                      onClick={() => handlePostActivity('myra', 'meme', true)}
                      className="w-full py-2.5 bg-gradient-to-r from-red-600 to-amber-600 hover:from-red-500 hover:to-amber-500 disabled:opacity-50 text-white rounded-lg text-xs font-bold flex items-center justify-center gap-2 shadow-md shadow-red-900/40 transition-all cursor-pointer"
                    >
                      <Flame className="w-4 h-4" />
                      <span>1-Click Post Meme & Reaction Board (💋🔥💀🍷🩷💯💦)</span>
                    </button>
                    <div className="text-[11px] text-slate-400 text-center">
                      Features clickable emoji counters that update live when members react!
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Preset Customizer Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pt-2">
        {/* Shanaya's Poll Customizer */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-pink-400" />
            <h3 className="text-sm font-semibold text-white">Shanaya's Community Polls</h3>
          </div>
          <div className="space-y-2">
            <label className="block text-xs font-medium text-slate-300">Poll Question / प्रश्न:</label>
            <input
              type="text"
              value={pollQuestion}
              onChange={(e) => setPollQuestion(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-xs text-white focus:outline-none focus:border-pink-500"
            />
          </div>
          <div className="space-y-2">
            <label className="block text-xs font-medium text-slate-300">Poll Options / पर्याय:</label>
            {pollOptions.map((opt, idx) => (
              <input
                key={idx}
                type="text"
                value={opt}
                onChange={(e) => {
                  const copy = [...pollOptions];
                  copy[idx] = e.target.value;
                  setPollOptions(copy);
                }}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-xs text-white focus:outline-none focus:border-pink-500"
              />
            ))}
          </div>
          <button
            disabled={isSending}
            onClick={() => handlePostActivity('shanaya', 'poll', true)}
            className="w-full py-2 bg-pink-700 hover:bg-pink-600 disabled:opacity-50 text-white rounded-lg text-xs font-semibold cursor-pointer transition-colors"
          >
            Dispatch Custom Poll to Group / Channel
          </button>
        </div>

        {/* Myra's Meme & Banter Customizer */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Flame className="w-4 h-4 text-red-400" />
            <h3 className="text-sm font-semibold text-white">Myra's Late Night Lounge & Memes</h3>
          </div>
          <div className="space-y-2">
            <label className="block text-xs font-medium text-slate-300">Meme / Banter Caption:</label>
            <textarea
              rows={5}
              value={memeCaption}
              onChange={(e) => setMemeCaption(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg p-3 text-xs text-white focus:outline-none focus:border-red-500 font-mono"
            />
          </div>
          <button
            disabled={isSending}
            onClick={() => handlePostActivity('myra', 'meme', true)}
            className="w-full py-2 bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white rounded-lg text-xs font-semibold cursor-pointer transition-colors"
          >
            Dispatch Reaction Board to Group / Channel
          </button>
        </div>
      </div>
    </div>
  );
};
