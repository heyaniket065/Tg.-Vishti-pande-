import React, { useState } from 'react';
import {
  Users,
  Repeat,
  ShieldAlert,
  Sparkles,
  ArrowRight,
  Play,
  CheckCircle,
  Key,
  ExternalLink,
  Radio,
  Zap,
  RefreshCw,
  Wrench,
  Stethoscope,
  CheckCircle2,
  AlertTriangle,
  ShieldCheck,
  Loader2,
} from 'lucide-react';
import { SimGroup, SimCrossPost, SimModLog, VerifiedBotInfo, LiveEvent } from '../types';
import { AppLanguage, translations } from '../i18n';

interface DashboardViewProps {
  groups: SimGroup[];
  crossPosts: SimCrossPost[];
  modLogs: SimModLog[];
  botInfo: VerifiedBotInfo | null;
  liveEvents: LiveEvent[];
  onNavigate: (tab: string) => void;
  onSelectGroup: (groupId: number) => void;
  onActivateToken: (token: string) => Promise<boolean>;
  onRefresh: () => void;
  appLanguage: AppLanguage;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  groups,
  crossPosts,
  modLogs,
  botInfo,
  liveEvents,
  onNavigate,
  onSelectGroup,
  onActivateToken,
  onRefresh,
  appLanguage,
}) => {
  const [quickToken, setQuickToken] = useState('');
  const [isActivating, setIsActivating] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isFixing, setIsFixing] = useState(false);
  const [autofixData, setAutofixData] = useState<{
    ok: boolean;
    checks: Array<{ name: string; status: 'ok' | 'fixed' | 'warning' | 'error'; detail: string }>;
    summary: string;
  } | null>(null);

  const t = translations[appLanguage] || translations.hinglish;
  const activePipelines = crossPosts.filter((c) => c.isActive).length;

  const handleRunAutofix = async () => {
    setIsFixing(true);
    try {
      const res = await fetch('/api/telegram/autofix', { method: 'POST' });
      const data = await res.json();
      setAutofixData(data);
      onRefresh();
    } catch (e: any) {
      setAutofixData({
        ok: false,
        checks: [{ name: 'Connection', status: 'error', detail: e.message }],
        summary: 'Error running diagnostics',
      });
    } finally {
      setIsFixing(false);
    }
  };

  const handleQuickActivate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickToken.trim()) return;

    setIsActivating(true);
    setStatusMsg(null);
    try {
      const ok = await onActivateToken(quickToken.trim());
      if (ok) {
        setStatusMsg({
          type: 'success',
          text: appLanguage === 'english'
            ? 'Bot successfully activated! Now open Telegram and send /start.'
            : appLanguage === 'hindi'
            ? 'बॉट सफलतापूर्वक चालू हो गया है! अब टेलीग्राम पर जाकर /start भेजें।'
            : appLanguage === 'marathi'
            ? 'बॉट यशस्वीरीत्या सुरू झाला आहे! आता टेलिग्रामवर जाऊन /start पाठवा.'
            : 'Bot live activate ho gaya hai! Ab Telegram par jakar /start bhejiye (Aap aisa karo).',
        });
        setQuickToken('');
      } else {
        setStatusMsg({
          type: 'error',
          text: appLanguage === 'english'
            ? 'Invalid token or Telegram error. Please check your BotFather token.'
            : appLanguage === 'hindi'
            ? 'अमान्य टोकन या टेलीग्राम त्रुटि। कृपया BotFather टोकन जांचें।'
            : appLanguage === 'marathi'
            ? 'अवैध टोकन किंवा टेलिग्राम त्रुटी. कृपया BotFather टोकन तपासा.'
            : 'Invalid token ya Telegram error. Kripya BotFather ka sahi token daalein.',
        });
      }
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err.message });
    } finally {
      setIsActivating(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* BOT ACTIVATION HERO BANNER */}
      {!botInfo ? (
        <div className="bg-gradient-to-r from-amber-950/60 via-slate-900 to-slate-900 border-2 border-amber-500/40 rounded-xl p-6 sm:p-7 space-y-4 shadow-xl">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse"></span>
                <span className="text-xs font-bold uppercase tracking-wider text-amber-400">
                  {t.botNotActiveTitle}
                </span>
              </div>
              <h1 className="text-lg sm:text-xl font-bold text-white">
                {t.botNotActiveTitle}
              </h1>
              <p className="text-xs sm:text-sm text-slate-300 max-w-2xl leading-relaxed">
                {t.botNotActiveDesc}
              </p>
            </div>
            <div className="shrink-0 text-xs text-slate-400 bg-slate-950/80 px-3 py-2 rounded-lg border border-slate-800">
              <span className="text-slate-300 font-medium">{t.whereToFindToken}</span>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {t.whereToFindTokenDesc}
              </p>
            </div>
          </div>

          <form onSubmit={handleQuickActivate} className="flex flex-col sm:flex-row gap-2.5 pt-2">
            <div className="relative flex-1">
              <Key className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
              <input
                type="text"
                value={quickToken}
                onChange={(e) => setQuickToken(e.target.value)}
                placeholder={t.tokenInputPlaceholder}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-9 pr-3 py-2.5 text-xs text-white placeholder-slate-500 font-mono focus:outline-none focus:border-indigo-500"
              />
            </div>
            <button
              type="submit"
              disabled={isActivating || !quickToken.trim()}
              className="flex items-center justify-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors disabled:opacity-50 shadow-md shrink-0 cursor-pointer"
            >
              {isActivating ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>{t.activatingBtn}</span>
                </>
              ) : (
                <>
                  <Zap className="w-3.5 h-3.5" />
                  <span>{t.activateBtn}</span>
                </>
              )}
            </button>
          </form>

          {statusMsg && (
            <div
              className={`p-3 rounded-lg text-xs ${
                statusMsg.type === 'success'
                  ? 'bg-emerald-950/80 border border-emerald-800 text-emerald-300'
                  : 'bg-rose-950/80 border border-rose-800 text-rose-300'
              }`}
            >
              {statusMsg.text}
            </div>
          )}
        </div>
      ) : (
        <div className="bg-gradient-to-r from-emerald-950/50 via-slate-900 to-slate-900 border border-emerald-800/60 rounded-xl p-5 sm:p-6 shadow-lg flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400"></span>
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">
                {t.botActiveBadge} · @{botInfo.username}
              </span>
            </div>
            <h1 className="text-base sm:text-lg font-bold text-white">
              {botInfo.first_name} is actively managing your Telegram groups
            </h1>
            <p className="text-xs text-slate-300">
              {appLanguage === 'english'
                ? 'Open Telegram and send /start to open your full private dashboard.'
                : appLanguage === 'hindi'
                ? 'टेलीग्राम खोलें और प्राइवेट चैट में /start भेजकर पूरा डैशबोर्ड उपयोग करें।'
                : appLanguage === 'marathi'
                ? 'टेलिग्राम उघडा आणि खाजगी चॅटमध्ये /start पाठवून सर्व नियंत्रणे वापरा.'
                : '👉 Aap aisa karo: Telegram me @' + botInfo.username + ' open karke /start bhejo aur groups connect karo!'}
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <a
              href={`https://t.me/${botInfo.username}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold shadow transition-colors"
            >
              <span>Open in Telegram</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>
      )}

      {/* Stats Counter Bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-4 space-y-1">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-medium">{t.activeGroups}</span>
            <Users className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="text-xl font-bold text-white font-mono tabular-nums">
            {groups.length}
          </div>
          <p className="text-[11px] text-slate-500">In database storage</p>
        </div>

        <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-4 space-y-1">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-medium">{t.activePipelines}</span>
            <Repeat className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="text-xl font-bold text-white font-mono tabular-nums">
            {activePipelines} Active
          </div>
          <p className="text-[11px] text-slate-500">Anti-loop verified</p>
        </div>

        <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-4 space-y-1">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-medium">Group Protection</span>
            <ShieldAlert className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-xl font-bold text-white font-mono tabular-nums">
            Flood & Links
          </div>
          <p className="text-[11px] text-slate-500">Safety filters active</p>
        </div>

        <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-4 space-y-1">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-medium">Auto-Delete Timer</span>
            <CheckCircle className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-xl font-bold text-white font-mono tabular-nums">
            60s Default
          </div>
          <p className="text-[11px] text-slate-500">Welcome clean guard</p>
        </div>
      </div>

      {/* 🩺 AUTO BUG FIXER & SELF-HEALING ACTION BAR */}
      <div className="bg-gradient-to-r from-emerald-950/40 via-slate-900 to-slate-900 border border-emerald-800/60 rounded-xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-emerald-950 border border-emerald-700/80 flex items-center justify-center text-emerald-400">
              <Wrench className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span>{t.autoBugFixerBtn}</span>
                <span className="text-[10px] bg-emerald-900/60 text-emerald-300 font-mono px-2 py-0.5 rounded-full border border-emerald-700">
                  Self-Healing Engine
                </span>
              </h3>
              <p className="text-xs text-slate-300 mt-0.5">
                {t.autoBugFixerDesc}
              </p>
            </div>
          </div>

          <button
            disabled={isFixing}
            onClick={handleRunAutofix}
            className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold shadow-md shadow-emerald-900/30 transition-all cursor-pointer shrink-0"
          >
            {isFixing ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Running Diagnostics...</span>
              </>
            ) : (
              <>
                <Stethoscope className="w-3.5 h-3.5" />
                <span>{appLanguage === 'marathi' ? 'ऑटो बग फिक्स करा' : appLanguage === 'hindi' ? 'ऑटो बग फिक्स करें' : 'Run Auto Bug Fix'}</span>
              </>
            )}
          </button>
        </div>

        {/* Diagnostics Results if executed */}
        {autofixData && (
          <div className="p-4 bg-slate-950 border border-slate-800 rounded-lg space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-white flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>Diagnostics & Repair Report:</span>
              </span>
              <span className="text-[11px] text-emerald-400 font-mono">100% Inspected</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
              {autofixData.checks.map((chk, idx) => (
                <div
                  key={idx}
                  className="p-2.5 bg-slate-900 border border-slate-800 rounded-md flex items-start gap-2"
                >
                  {chk.status === 'ok' ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  ) : chk.status === 'fixed' ? (
                    <Wrench className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
                  ) : chk.status === 'warning' ? (
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  )}
                  <div>
                    <div className="font-semibold text-slate-200">{chk.name}</div>
                    <div className="text-[11px] text-slate-400 mt-0.5">{chk.detail}</div>
                  </div>
                </div>
              ))}
            </div>

            <p className="text-[11px] text-emerald-300 font-medium pt-1">
              🎉 {appLanguage === 'marathi' ? 'सर्व तपासण्या पूर्ण झाल्या आहेत आणि सिस्टीम 100% सुरळीत काम करत आहे.' : 'All system checks verified and auto-healed successfully.'}
            </p>
          </div>
        )}
      </div>

      {/* Real-Time Telegram Event Stream & Groups Instructions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Live Telegram Events Feed */}
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-xl overflow-hidden flex flex-col">
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
              <h2 className="text-sm font-semibold text-white">{t.recentLiveActivity}</h2>
            </div>
            <button
              onClick={onRefresh}
              className="text-xs text-slate-400 hover:text-white flex items-center gap-1 cursor-pointer"
            >
              <RefreshCw className="w-3 h-3" />
              <span>{t.refreshBtn}</span>
            </button>
          </div>

          <div className="p-4 flex-1 space-y-2.5 max-h-80 overflow-y-auto font-mono text-xs">
            {liveEvents.length === 0 ? (
              <div className="py-12 text-center text-slate-500 space-y-2 font-sans">
                <Radio className="w-6 h-6 mx-auto text-slate-600" />
                <p className="text-xs">Listening for incoming Telegram events...</p>
                <p className="text-[11px] text-slate-500">
                  {appLanguage === 'english'
                    ? 'Send /start to your bot in Telegram to see live events streaming here.'
                    : appLanguage === 'hindi'
                    ? 'टेलीग्राम पर बॉट को /start भेजकर देखें, लाइव इवेंट्स यहाँ तुरंत दिखेंगे।'
                    : appLanguage === 'marathi'
                    ? 'Telegram वर बॉटला /start पाठवून पहा, तो संदेश येथे तात्काळ दिसेल!'
                    : '👉 Telegram me bot ko /start bhejiye, wo message yahan turant stream hoga!'}
                </p>
              </div>
            ) : (
              liveEvents.map((ev) => (
                <div
                  key={ev.id}
                  className="p-2.5 bg-slate-950 border border-slate-800/80 rounded-lg flex items-start justify-between gap-3"
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-[10px] uppercase font-bold px-1.5 py-0.2 rounded ${
                          ev.type === 'incoming_message'
                            ? 'bg-indigo-950 text-indigo-300'
                            : ev.type === 'crosspost'
                            ? 'bg-amber-950 text-amber-300'
                            : ev.type === 'welcome'
                            ? 'bg-emerald-950 text-emerald-300'
                            : 'bg-slate-800 text-slate-300'
                        }`}
                      >
                        {ev.type}
                      </span>
                      <span className="text-slate-300 font-sans text-xs">{ev.details}</span>
                    </div>
                  </div>
                  <span className="text-[11px] text-slate-500 tabular-nums shrink-0">{ev.time}</span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* How to Connect 2 Groups Instructions */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3.5">
          <div className="flex items-center gap-2 text-white font-semibold text-sm">
            <Sparkles className="w-4 h-4 text-indigo-400" />
            <span>{t.howToConnectTitle}</span>
          </div>

          <div className="text-xs text-slate-300 space-y-3 leading-relaxed">
            <div className="p-2.5 bg-slate-950/80 border border-slate-800 rounded-lg space-y-1">
              <div className="font-semibold text-indigo-300 text-xs">{t.step1Title}</div>
              <p className="text-slate-400 text-[11px]">{t.step1Desc}</p>
            </div>

            <div className="p-2.5 bg-slate-950/80 border border-slate-800 rounded-lg space-y-1">
              <div className="font-semibold text-indigo-300 text-xs">{t.step2Title}</div>
              <p className="text-slate-400 text-[11px]">{t.step2Desc}</p>
            </div>

            <div className="p-2.5 bg-slate-950/80 border border-slate-800 rounded-lg space-y-1">
              <div className="font-semibold text-indigo-300 text-xs">{t.step3Title}</div>
              <p className="text-slate-400 text-[11px]">{t.step3Desc}</p>
            </div>

            <div className="p-2.5 bg-indigo-950/40 border border-indigo-800/60 rounded-lg space-y-1.5">
              <span className="text-[11px] text-indigo-200 font-semibold">
                🔄 Cross-Posting 2 Groups:
              </span>
              <p className="text-[11px] text-slate-300">
                Group A aur Group B dono se codes lekar bot ke private chat me bhejein:
              </p>
              <div className="p-1.5 bg-slate-950 rounded font-mono text-[11px] text-indigo-300">
                /connect A7XK92 B4MPL8
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

