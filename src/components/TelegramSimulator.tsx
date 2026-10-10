import React, { useState, useEffect, useRef } from 'react';
import {
  Send,
  RotateCcw,
  Bot,
  User,
  Shield,
  Layers,
  Sparkles,
  Link,
  Clock,
  ExternalLink,
  ChevronRight,
  Info,
} from 'lucide-react';
import { SimChatMessage, SimGroup, SimLinkCode, SimCrossPost } from '../types';

interface TelegramSimulatorProps {
  groups: SimGroup[];
  messages: SimChatMessage[];
  linkCodes: SimLinkCode[];
  crossPosts: SimCrossPost[];
  onDispatch: (action: string, payload: any) => Promise<void>;
  onRefresh: () => void;
}

export const TelegramSimulator: React.FC<TelegramSimulatorProps> = ({
  groups,
  messages,
  linkCodes,
  crossPosts,
  onDispatch,
  onRefresh,
}) => {
  const [privateInput, setPrivateInput] = useState('');
  const [groupInput, setGroupInput] = useState('');
  const [activeGroupTab, setActiveGroupTab] = useState<1 | 2>(1); // 1 = Group A, 2 = Group B
  const [senderRole, setSenderRole] = useState<'admin' | 'member'>('admin');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const privateMessagesEndRef = useRef<HTMLDivElement>(null);
  const groupMessagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom of chats on new message
  useEffect(() => {
    privateMessagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const privateMessages = messages.filter((m) => m.chatType === 'private');
  const groupMessages = messages.filter(
    (m) => m.chatType === (activeGroupTab === 1 ? 'group_a' : 'group_b')
  );

  const activeGroup = groups.find((g) => g.id === activeGroupTab) || groups[0];

  const handleSendPrivate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!privateInput.trim() || isSubmitting) return;

    setIsSubmitting(true);
    try {
      await onDispatch('send_private_message', { text: privateInput.trim() });
      setPrivateInput('');
      onRefresh();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSendGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!groupInput.trim() || isSubmitting) return;

    setIsSubmitting(true);
    try {
      await onDispatch('send_group_message', {
        targetGroup: activeGroupTab,
        sender: senderRole === 'admin' ? 'Alex (Admin)' : 'Sarah (Member)',
        senderRole,
        text: groupInput.trim(),
      });
      setGroupInput('');
      onRefresh();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleInlineClick = async (callbackData: string) => {
    await onDispatch('click_inline_button', { callbackData });
    onRefresh();
  };

  const handleSimulateJoin = async () => {
    const randomNames = ['David Miller', 'Elena Rostova', 'Kenji Sato', 'Maya Patel'];
    const randomName = randomNames[Math.floor(Math.random() * randomNames.length)];
    await onDispatch('simulate_member_join', {
      targetGroup: activeGroupTab,
      newMemberName: randomName,
    });
    onRefresh();
  };

  const handleTestLinkGroup = async () => {
    await onDispatch('send_group_message', {
      targetGroup: activeGroupTab,
      sender: 'Alex (Admin)',
      senderRole: 'admin',
      text: '/linkgroup',
    });
    onRefresh();
  };

  const handleTestCrossPost = async () => {
    const announcements = [
      '🚀 Major Update: TeleGroup Bot v2.0 is deployed with zero-downtime routing!',
      '📣 Notice: Scheduled maintenance will occur tonight at 02:00 UTC.',
      '💡 Tip: Use /rules to view our updated code of conduct.',
    ];
    const text = announcements[Math.floor(Math.random() * announcements.length)];
    await onDispatch('send_group_message', {
      targetGroup: 1, // Sent in Group A
      sender: 'Alex (Admin)',
      senderRole: 'admin',
      text,
    });
    onRefresh();
  };

  const handleResetSimulation = async () => {
    await onDispatch('reset_simulation', {});
    onRefresh();
  };

  return (
    <div className="space-y-4">
      {/* Simulation Control Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 bg-slate-900 border border-slate-800 rounded-xl">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-indigo-400" />
          <span className="text-xs font-semibold text-white">Interactive Bot Sandbox</span>
          <span className="text-xs text-slate-500 hidden sm:inline">
            — Test private chat menus, group linking, cross-posting, and welcome flows in real time
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleResetSimulation}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded transition-colors"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Reset Demo</span>
          </button>
        </div>
      </div>

      {/* Dual Pane Simulator Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* LEFT PANE: Bot Private Chat */}
        <div className="flex flex-col h-[700px] bg-slate-950 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
          {/* Private Chat Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-slate-900 border-b border-slate-800">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-indigo-600/30 border border-indigo-500/40 flex items-center justify-center text-indigo-400 font-bold text-xs">
                <Bot className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-xs font-semibold text-white">TeleGroup Manager Bot</h3>
                <p className="text-[11px] text-slate-400">@TeleGroupManagerBot · Private Dashboard</p>
              </div>
            </div>
            <div className="text-[11px] font-mono text-emerald-400 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
              <span>Bot Online</span>
            </div>
          </div>

          {/* Quick command buttons */}
          <div className="px-3 py-1.5 bg-slate-900/60 border-b border-slate-800/80 flex items-center gap-2 overflow-x-auto text-[11px]">
            <span className="text-slate-500 whitespace-nowrap">Quick Test:</span>
            <button
              onClick={() => {
                setPrivateInput('/start');
              }}
              className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded whitespace-nowrap transition-colors"
            >
              /start
            </button>
            <button
              onClick={() => {
                setPrivateInput('/language');
              }}
              className="px-2 py-0.5 bg-indigo-950/80 border border-indigo-700/60 hover:bg-indigo-900 text-indigo-300 rounded whitespace-nowrap transition-colors"
            >
              🌐 /language
            </button>
            <button
              onClick={() => {
                setPrivateInput('/help');
              }}
              className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded whitespace-nowrap transition-colors"
            >
              /help
            </button>
            {linkCodes.filter((c) => !c.isUsed).length >= 2 && (
              <button
                onClick={() => {
                  const unUsed = linkCodes.filter((c) => !c.isUsed);
                  setPrivateInput(`/connect ${unUsed[0].code} ${unUsed[1].code}`);
                }}
                className="px-2 py-0.5 bg-indigo-900/60 hover:bg-indigo-800 text-indigo-300 rounded whitespace-nowrap font-mono transition-colors"
              >
                Auto-fill /connect
              </button>
            )}
          </div>

          {/* Messages Scroll Area */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3.5 bg-slate-950/90 text-xs">
            {privateMessages.map((msg) => {
              const isBot = msg.senderRole === 'bot';
              return (
                <div
                  key={msg.id}
                  className={`flex flex-col ${isBot ? 'items-start' : 'items-end'}`}
                >
                  <div className="flex items-center gap-1.5 mb-1 px-1 text-[10px] text-slate-400 font-mono">
                    <span>{msg.sender}</span>
                    <span>·</span>
                    <span className="tabular-nums">{msg.timestamp}</span>
                  </div>

                  <div
                    className={`max-w-[85%] rounded-lg p-3 text-xs leading-relaxed whitespace-pre-wrap ${
                      isBot
                        ? 'bg-slate-900 border border-slate-800 text-slate-200'
                        : 'bg-indigo-600 text-white font-medium'
                    }`}
                  >
                    {msg.text}

                    {/* Inline Button Grid */}
                    {msg.inlineButtons && msg.inlineButtons.length > 0 && (
                      <div className="mt-3 pt-2.5 border-t border-slate-800/80 space-y-1.5">
                        {msg.inlineButtons.map((row, rIdx) => (
                          <div key={rIdx} className="flex gap-1.5">
                            {row.map((btn, bIdx) => {
                              if (btn.url) {
                                return (
                                  <a
                                    key={bIdx}
                                    href={btn.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="flex-1 text-center py-1.5 px-2 bg-slate-800/90 hover:bg-slate-700/90 border border-slate-700 rounded text-[11px] text-indigo-300 font-medium transition-colors flex items-center justify-center gap-1"
                                  >
                                    <span>{btn.text}</span>
                                    <ExternalLink className="w-2.5 h-2.5" />
                                  </a>
                                );
                              }
                              return (
                                <button
                                  key={bIdx}
                                  onClick={() => btn.callbackData && handleInlineClick(btn.callbackData)}
                                  className="flex-1 text-center py-1.5 px-2 bg-slate-800 hover:bg-slate-700 border border-slate-700/80 hover:border-indigo-500 rounded text-[11px] text-slate-200 font-medium transition-all active:scale-95"
                                >
                                  {btn.text}
                                </button>
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            <div ref={privateMessagesEndRef} />
          </div>

          {/* Private Chat Input Box */}
          <form
            onSubmit={handleSendPrivate}
            className="p-3 bg-slate-900 border-t border-slate-800 flex items-center gap-2"
          >
            <input
              type="text"
              value={privateInput}
              onChange={(e) => setPrivateInput(e.target.value)}
              placeholder="Type /start, /help, or /connect <A> <B>..."
              className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
            <button
              type="submit"
              disabled={!privateInput.trim() || isSubmitting}
              className="p-2 text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg transition-colors"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </form>
        </div>

        {/* RIGHT PANE: Group Chats (Group A & Group B) */}
        <div className="flex flex-col h-[700px] bg-slate-950 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
          {/* Group Header with Tab Switcher */}
          <div className="px-4 py-2.5 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
            {/* Tabs: Group A vs Group B */}
            <div className="flex items-center gap-1 p-0.5 bg-slate-950 rounded-lg border border-slate-800">
              <button
                onClick={() => setActiveGroupTab(1)}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                  activeGroupTab === 1
                    ? 'bg-slate-800 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Group A (Dev Hub)
              </button>
              <button
                onClick={() => setActiveGroupTab(2)}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                  activeGroupTab === 2
                    ? 'bg-slate-800 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Group B (Announcements)
              </button>
            </div>

            {/* Sender Identity Selector */}
            <div className="flex items-center gap-1.5 text-xs text-slate-400">
              <span className="text-[11px]">Send as:</span>
              <button
                onClick={() => setSenderRole(senderRole === 'admin' ? 'member' : 'admin')}
                className={`px-2 py-0.5 rounded text-[11px] font-mono transition-colors ${
                  senderRole === 'admin'
                    ? 'bg-indigo-950 text-indigo-300 border border-indigo-800'
                    : 'bg-slate-800 text-slate-300'
                }`}
              >
                {senderRole === 'admin' ? '🛡️ Admin Alex' : '👤 Sarah (Member)'}
              </button>
            </div>
          </div>

          {/* Quick Simulation Trigger Bar */}
          <div className="px-3 py-2 bg-slate-900/60 border-b border-slate-800/80 flex flex-wrap items-center gap-2 text-[11px]">
            <button
              onClick={handleTestLinkGroup}
              className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded transition-colors flex items-center gap-1"
            >
              <Link className="w-3 h-3 text-indigo-400" />
              <span>/linkgroup</span>
            </button>
            <button
              onClick={handleSimulateJoin}
              className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded transition-colors flex items-center gap-1"
            >
              <User className="w-3 h-3 text-emerald-400" />
              <span>Simulate Join</span>
            </button>
            <button
              onClick={handleTestCrossPost}
              className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded transition-colors flex items-center gap-1"
            >
              <Layers className="w-3 h-3 text-amber-400" />
              <span>Test Cross-Post</span>
            </button>
            <button
              onClick={() => {
                setGroupInput('/warn Spamming telegram links');
              }}
              className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded transition-colors flex items-center gap-1"
            >
              <Shield className="w-3 h-3 text-red-400" />
              <span>/warn Sarah</span>
            </button>
          </div>

          {/* Group Messages View */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-950/90 text-xs">
            {groupMessages.map((msg) => {
              const isBot = msg.senderRole === 'bot';
              return (
                <div key={msg.id} className="flex flex-col items-start max-w-[90%]">
                  <div className="flex items-center gap-1.5 mb-1 text-[10px] text-slate-400 font-mono">
                    <span
                      className={
                        msg.senderRole === 'admin'
                          ? 'text-indigo-400 font-semibold'
                          : msg.senderRole === 'bot'
                          ? 'text-emerald-400 font-semibold'
                          : 'text-slate-300'
                      }
                    >
                      {msg.sender}
                    </span>
                    <span>·</span>
                    <span className="tabular-nums">{msg.timestamp}</span>
                    {msg.autoDeleteAt && (
                      <span className="text-amber-400 flex items-center gap-0.5">
                        <Clock className="w-2.5 h-2.5" />
                        <span>Auto-deleting</span>
                      </span>
                    )}
                  </div>

                  <div
                    className={`rounded-lg p-3 text-xs leading-relaxed whitespace-pre-wrap ${
                      isBot
                        ? 'bg-slate-900 border border-slate-800 text-slate-200'
                        : 'bg-slate-850 border border-slate-800/80 text-white'
                    }`}
                  >
                    {msg.isForwarded && (
                      <div className="text-[10px] text-slate-400 border-b border-slate-800 pb-1 mb-1.5 flex items-center gap-1">
                        <span>Forwarded from {msg.forwardOrigin || 'Linked Group'}</span>
                      </div>
                    )}

                    {msg.text}

                    {/* Inline Buttons on Group Welcome / Promo Posts */}
                    {msg.inlineButtons && msg.inlineButtons.length > 0 && (
                      <div className="mt-2.5 pt-2 border-t border-slate-800 space-y-1">
                        {msg.inlineButtons.map((row, rIdx) => (
                          <div key={rIdx} className="flex gap-1.5">
                            {row.map((btn, bIdx) => (
                              <a
                                key={bIdx}
                                href={btn.url || '#'}
                                target="_blank"
                                rel="noreferrer"
                                className="flex-1 py-1 px-2 text-center bg-slate-800 hover:bg-slate-700 text-indigo-300 text-[11px] rounded transition-colors flex items-center justify-center gap-1"
                              >
                                <span>{btn.text}</span>
                                <ExternalLink className="w-2.5 h-2.5" />
                              </a>
                            ))}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            <div ref={groupMessagesEndRef} />
          </div>

          {/* Group Chat Input */}
          <form
            onSubmit={handleSendGroup}
            className="p-3 bg-slate-900 border-t border-slate-800 flex items-center gap-2"
          >
            <input
              type="text"
              value={groupInput}
              onChange={(e) => setGroupInput(e.target.value)}
              placeholder={`Send message to ${activeGroup.title}...`}
              className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
            <button
              type="submit"
              disabled={!groupInput.trim() || isSubmitting}
              className="p-2 text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg transition-colors"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
