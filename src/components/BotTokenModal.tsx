import React, { useState } from 'react';
import { Key, Eye, EyeOff, CheckCircle2, AlertCircle, X, Shield, ExternalLink, RefreshCw } from 'lucide-react';
import { VerifiedBotInfo } from '../types';

interface BotTokenModalProps {
  isOpen: boolean;
  onClose: () => void;
  botInfo: VerifiedBotInfo | null;
  onVerified: (info: VerifiedBotInfo) => void;
}

export const BotTokenModal: React.FC<BotTokenModalProps> = ({
  isOpen,
  onClose,
  botInfo,
  onVerified,
}) => {
  const [tokenInput, setTokenInput] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    const token = tokenInput.trim();
    if (!token) {
      setErrorMessage('Please enter your existing Telegram bot token.');
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch('/api/telegram/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });

      const data = await res.json();
      if (res.ok && data.ok) {
        onVerified(data.bot);
        setSuccessMessage(`✅ Bot @${data.bot.username} successfully connected and is now LIVE on Telegram! You can now send /start to the bot.`);
      } else {
        setErrorMessage(data.error || 'Failed to authenticate token with Telegram API.');
      }
    } catch (err: any) {
      setErrorMessage(`Network request failed: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/60">
          <div className="flex items-center gap-2.5">
            <Shield className="w-5 h-5 text-indigo-400" />
            <h2 className="text-base font-semibold text-white">Telegram Bot Token Configuration</h2>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors p-1 rounded-md"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5">
          <p className="text-xs text-slate-300 leading-relaxed">
            Connect your existing bot created with{' '}
            <a
              href="https://t.me/BotFather"
              target="_blank"
              rel="noreferrer"
              className="text-indigo-400 hover:underline inline-flex items-center gap-1"
            >
              @BotFather <ExternalLink className="w-3 h-3" />
            </a>
            . Your token is verified securely against the Telegram <code className="text-slate-200">getMe</code> API and never saved to public repositories or shared in chat.
          </p>

          <form onSubmit={handleVerify} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Telegram Bot Token
              </label>
              <div className="relative">
                <input
                  type={showToken ? 'text' : 'password'}
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  placeholder="e.g. 7123456789:AAEjW3..."
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3.5 py-2.5 text-xs text-white placeholder-slate-500 font-mono focus:outline-none focus:border-indigo-500"
                />
                <button
                  type="button"
                  onClick={() => setShowToken(!showToken)}
                  className="absolute right-3 top-2.5 text-slate-400 hover:text-white"
                >
                  {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                Format: <span className="font-mono text-slate-400">123456789:ABCdefGHIjklMNOpqrsTUVwxyz</span>
              </p>
            </div>

            {errorMessage && (
              <div className="p-3 bg-red-950/40 border border-red-800/80 rounded-lg text-xs text-red-200 flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <span>{errorMessage}</span>
              </div>
            )}

            {successMessage && (
              <div className="p-3 bg-emerald-950/40 border border-emerald-800/80 rounded-lg text-xs text-emerald-200 flex items-start gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span>{successMessage}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
              >
                Close
              </button>
              <button
                type="submit"
                disabled={isLoading}
                className="flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors disabled:opacity-50"
              >
                {isLoading ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Verifying getMe API...</span>
                  </>
                ) : (
                  <>
                    <Key className="w-3.5 h-3.5" />
                    <span>Verify & Authenticate</span>
                  </>
                )}
              </button>
            </div>
          </form>

          {/* Active Bot Status */}
          {botInfo && (
            <div className="pt-4 border-t border-slate-800">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-medium text-slate-400">Verified Bot Profile</span>
                <span className="text-xs text-emerald-400 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Active & Authorized
                </span>
              </div>
              <div className="bg-slate-950 rounded-lg p-3 text-xs space-y-1.5 font-mono text-slate-300">
                <div className="flex justify-between">
                  <span className="text-slate-500">Username:</span>
                  <span className="text-indigo-400 font-semibold">@{botInfo.username}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Bot Name:</span>
                  <span>{botInfo.first_name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Bot ID:</span>
                  <span className="tabular-nums">{botInfo.id}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Join Groups:</span>
                  <span className={botInfo.can_join_groups ? 'text-emerald-400' : 'text-amber-400'}>
                    {botInfo.can_join_groups ? 'Allowed' : 'Restricted'}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
