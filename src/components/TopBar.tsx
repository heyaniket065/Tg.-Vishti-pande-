import React from 'react';
import { ShieldCheck, Key, Globe } from 'lucide-react';
import { VerifiedBotInfo } from '../types';
import { AppLanguage, translations } from '../i18n';

interface TopBarProps {
  currentTab: string;
  setCurrentTab: (tab: string) => void;
  botInfo: VerifiedBotInfo | null;
  onOpenTokenModal: () => void;
  appLanguage: AppLanguage;
  setAppLanguage: (lang: AppLanguage) => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  currentTab,
  setCurrentTab,
  botInfo,
  onOpenTokenModal,
  appLanguage,
  setAppLanguage,
}) => {
  const t = translations[appLanguage] || translations.hinglish;

  const navItems = [
    { id: 'dashboard', label: t.navDashboard },
    { id: 'botsquad', label: t.navBotSquad },
    { id: 'transcribe', label: t.navTranscribe },
    { id: 'crosspost', label: t.navCrossPost },
    { id: 'moderation', label: t.navModeration },
    { id: 'welcome', label: t.navWelcome },
    { id: 'simulator', label: t.navSimulator },
    { id: 'deployment', label: t.navDeployment },
  ];

  return (
    <header className="flex items-center justify-between gap-4 px-6 py-3.5 border-b border-slate-800 bg-slate-950/95 sticky top-0 z-40 backdrop-blur">
      {/* Zone 1: Brand wordmark */}
      <div className="flex items-center gap-3 shrink-0">
        <a
          href="#dashboard"
          onClick={(e) => {
            e.preventDefault();
            setCurrentTab('dashboard');
          }}
          className="text-base font-semibold tracking-tight text-white whitespace-nowrap shrink-0 hover:text-indigo-400 transition-colors"
        >
          TeleGroup Studio
        </a>
        <span className="text-xs text-slate-500 font-mono hidden sm:inline">aiogram 3.15</span>
      </div>

      {/* Zone 2: clean single-line nav links */}
      <nav className="hidden lg:flex items-center gap-5 text-xs font-medium text-slate-400">
        {navItems.map((item) => {
          const isActive = currentTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setCurrentTab(item.id)}
              className={`whitespace-nowrap shrink-0 transition-colors pb-0.5 ${
                isActive
                  ? 'text-white border-b border-indigo-400 font-semibold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </nav>

      {/* Zone 3: Language Selector + Token Action */}
      <div className="flex items-center gap-2.5 shrink-0">
        {/* Language Select Dropdown */}
        <div className="flex items-center gap-1 bg-slate-900 border border-slate-700/80 rounded-md px-2 py-1 text-xs text-slate-200">
          <Globe className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
          <select
            value={appLanguage}
            onChange={(e) => setAppLanguage(e.target.value as AppLanguage)}
            className="bg-transparent text-xs text-slate-200 focus:outline-none cursor-pointer pr-1"
          >
            <option value="hinglish" className="bg-slate-900 text-white">🇮🇳 Hinglish (Aap aisa karo)</option>
            <option value="english" className="bg-slate-900 text-white">🇬🇧 English</option>
            <option value="hindi" className="bg-slate-900 text-white">🇮🇳 हिन्दी (Hindi)</option>
            <option value="marathi" className="bg-slate-900 text-white">🚩 मराठी (Marathi)</option>
          </select>
        </div>

        {botInfo ? (
          <button
            onClick={onOpenTokenModal}
            className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-emerald-300 bg-emerald-950/70 border border-emerald-800 rounded-md hover:bg-emerald-900/50 transition-colors whitespace-nowrap shrink-0"
          >
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>@{botInfo.username}</span>
          </button>
        ) : (
          <button
            onClick={onOpenTokenModal}
            className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-500 transition-colors whitespace-nowrap shrink-0 shadow-sm"
          >
            <Key className="w-3.5 h-3.5" />
            <span>Configure Bot Token</span>
          </button>
        )}
      </div>
    </header>
  );
};
