/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { TopBar } from './components/TopBar';
import { DashboardView } from './components/DashboardView';
import { TelegramSimulator } from './components/TelegramSimulator';
import { CrossPostingView } from './components/CrossPostingView';
import { WelcomeView } from './components/WelcomeView';
import { ModerationView } from './components/ModerationView';
import { CodeDeploymentView } from './components/CodeDeploymentView';
import { BotTokenModal } from './components/BotTokenModal';
import { AppLanguage } from './i18n';
import {
  SimGroup,
  SimCrossPost,
  SimWelcomeConfig,
  SimChatMessage,
  SimWarnRecord,
  SimModLog,
  SimLinkCode,
  VerifiedBotInfo,
} from './types';

export default function App() {
  const [currentTab, setCurrentTab] = useState<string>('dashboard');
  const [isTokenModalOpen, setIsTokenModalOpen] = useState(false);
  const [botInfo, setBotInfo] = useState<VerifiedBotInfo | null>(null);

  // App Language State (Default: Hinglish as requested!)
  const [appLanguage, setAppLanguageState] = useState<AppLanguage>(() => {
    try {
      const saved = localStorage.getItem('telegroup_lang');
      if (saved && ['hinglish', 'english', 'hindi', 'marathi'].includes(saved)) {
        return saved as AppLanguage;
      }
    } catch {}
    return 'hinglish';
  });

  const setAppLanguage = (lang: AppLanguage) => {
    setAppLanguageState(lang);
    try {
      localStorage.setItem('telegroup_lang', lang);
    } catch {}
    // Also inform backend of default language preference
    fetch('/api/telegram/language', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language: lang }),
    }).catch(() => {});
  };

  // Simulation State
  const [groups, setGroups] = useState<SimGroup[]>([]);
  const [linkCodes, setLinkCodes] = useState<SimLinkCode[]>([]);
  const [crossPosts, setCrossPosts] = useState<SimCrossPost[]>([]);
  const [welcomeConfigs, setWelcomeConfigs] = useState<Record<number, SimWelcomeConfig>>({});
  const [messages, setMessages] = useState<SimChatMessage[]>([]);
  const [warnings, setWarnings] = useState<SimWarnRecord[]>([]);
  const [modLogs, setModLogs] = useState<SimModLog[]>([]);
  const [liveEvents, setLiveEvents] = useState<any[]>([]);

  const [selectedGroupId, setSelectedGroupId] = useState<number>(1);
  const [isLoading, setIsLoading] = useState(true);

  // Fetch initial state & bot status
  const loadState = async () => {
    try {
      const res = await fetch('/api/simulation/state');
      if (res.ok) {
        const data = await res.json();
        setGroups(data.groups || []);
        setLinkCodes(data.linkCodes || []);
        setCrossPosts(data.crossPosts || []);
        setWelcomeConfigs(data.welcomeConfigs || {});
        setMessages(data.messages || []);
        setWarnings(data.warnings || []);
        setModLogs(data.modLogs || []);
        if (data.liveEvents) setLiveEvents(data.liveEvents);
      }

      // Check telegram status
      const statusRes = await fetch('/api/telegram/status');
      if (statusRes.ok) {
        const statusData = await statusRes.json();
        if (statusData.botInfo) {
          setBotInfo(statusData.botInfo);
        }
        if (statusData.liveEvents) {
          setLiveEvents(statusData.liveEvents);
        }
      }
    } catch (e) {
      console.error('Failed to load simulation state:', e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadState();
    // Live poll status every 3 seconds for real-time Telegram event feed
    const interval = setInterval(() => {
      fetch('/api/telegram/status')
        .then((r) => r.json())
        .then((data) => {
          if (data.botInfo) setBotInfo(data.botInfo);
          if (data.liveEvents) setLiveEvents(data.liveEvents);
        })
        .catch(() => {});
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  const handleActivateToken = async (token: string): Promise<boolean> => {
    try {
      const res = await fetch('/api/telegram/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setBotInfo(data.bot);
        await loadState();
        return true;
      }
      return false;
    } catch (e) {
      console.error('Activation error:', e);
      return false;
    }
  };

  const handleDispatch = async (action: string, payload: any) => {
    try {
      if (action === 'reset_simulation') {
        await fetch('/api/simulation/reset', { method: 'POST' });
      } else {
        await fetch('/api/simulation/dispatch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, payload }),
        });
      }
      await loadState();
    } catch (e) {
      console.error('Dispatch error:', e);
    }
  };

  // Cross-post updates
  const handleToggleCrossPostActive = async (id: number) => {
    setCrossPosts((prev) =>
      prev.map((cp) => (cp.id === id ? { ...cp, isActive: !cp.isActive } : cp))
    );
    try {
      await fetch('/api/crosspost/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      await loadState();
    } catch (e) {
      console.error('Failed to toggle cross-post:', e);
    }
  };

  const handleChangeDirection = async (
    id: number,
    direction: 'A_TO_B' | 'B_TO_A' | 'BIDIRECTIONAL'
  ) => {
    setCrossPosts((prev) =>
      prev.map((cp) => (cp.id === id ? { ...cp, direction } : cp))
    );
    try {
      await fetch('/api/crosspost/direction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, direction }),
      });
      await loadState();
    } catch (e) {
      console.error('Failed to change cross-post direction:', e);
    }
  };

  const handleChangeMode = async (id: number, mode: 'COPY' | 'FORWARD') => {
    setCrossPosts((prev) => prev.map((cp) => (cp.id === id ? { ...cp, mode } : cp)));
    try {
      await fetch('/api/crosspost/mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, mode }),
      });
      await loadState();
    } catch (e) {
      console.error('Failed to change cross-post mode:', e);
    }
  };

  // Welcome updates
  const handleUpdateWelcomeConfig = async (
    groupId: number,
    newConfig: Partial<SimWelcomeConfig>
  ) => {
    setWelcomeConfigs((prev) => ({
      ...prev,
      [groupId]: {
        ...(prev[groupId] || {
          groupId,
          isEnabled: true,
          templateText: '👋 Welcome to {group_name}, {first_name}!',
          mediaUrl: null,
          deleteAfterSeconds: 60,
          buttons: [],
        }),
        ...newConfig,
      },
    }));
    try {
      await fetch('/api/welcome/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          groupId,
          welcomeEnabled: newConfig.isEnabled,
          welcomeDeleteSeconds: newConfig.deleteAfterSeconds,
        }),
      });
      await loadState();
    } catch (e) {
      console.error('Failed to update welcome config:', e);
    }
  };

  // Group updates
  const handleUpdateGroup = (groupId: number, updates: Partial<SimGroup>) => {
    setGroups((prev) =>
      prev.map((g) => (g.id === groupId ? { ...g, ...updates } : g))
    );
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-indigo-500/30 selection:text-indigo-200">
      <TopBar
        currentTab={currentTab}
        setCurrentTab={setCurrentTab}
        botInfo={botInfo}
        onOpenTokenModal={() => setIsTokenModalOpen(true)}
        appLanguage={appLanguage}
        setAppLanguage={setAppLanguage}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8">
        {isLoading ? (
          <div className="h-96 flex items-center justify-center text-xs text-slate-500 font-mono">
            Loading TeleGroup Workspace...
          </div>
        ) : (
          <>
            {currentTab === 'dashboard' && (
              <DashboardView
                groups={groups}
                crossPosts={crossPosts}
                modLogs={modLogs}
                botInfo={botInfo}
                liveEvents={liveEvents}
                onNavigate={setCurrentTab}
                onSelectGroup={setSelectedGroupId}
                onActivateToken={handleActivateToken}
                onRefresh={loadState}
                appLanguage={appLanguage}
              />
            )}

            {currentTab === 'simulator' && (
              <TelegramSimulator
                groups={groups}
                messages={messages}
                linkCodes={linkCodes}
                crossPosts={crossPosts}
                onDispatch={handleDispatch}
                onRefresh={loadState}
              />
            )}

            {currentTab === 'crosspost' && (
              <CrossPostingView
                crossPosts={crossPosts}
                groups={groups}
                onToggleActive={handleToggleCrossPostActive}
                onChangeDirection={handleChangeDirection}
                onChangeMode={handleChangeMode}
              />
            )}

            {currentTab === 'welcome' && (
              <WelcomeView
                groups={groups}
                welcomeConfigs={welcomeConfigs}
                selectedGroupId={selectedGroupId}
                onSelectGroup={setSelectedGroupId}
                onUpdateConfig={handleUpdateWelcomeConfig}
              />
            )}

            {currentTab === 'moderation' && (
              <ModerationView
                groups={groups}
                selectedGroupId={selectedGroupId}
                onSelectGroup={setSelectedGroupId}
                onUpdateGroup={handleUpdateGroup}
                modLogs={modLogs}
                warnings={warnings}
              />
            )}

            {currentTab === 'deployment' && <CodeDeploymentView />}
          </>
        )}
      </main>

      <BotTokenModal
        isOpen={isTokenModalOpen}
        onClose={() => setIsTokenModalOpen(false)}
        botInfo={botInfo}
        onVerified={(info) => {
          setBotInfo(info);
        }}
      />
    </div>
  );
}
