import React, { useState, useRef, useEffect } from 'react';
import {
  Mic,
  Square,
  Play,
  RotateCcw,
  Copy,
  Check,
  Send,
  Upload,
  Sparkles,
  Volume2,
  FileAudio,
  Radio,
  Layers,
  ArrowRight,
} from 'lucide-react';
import { SimGroup, ManagedBot } from '../types';

interface TranscribeAudioViewProps {
  groups: SimGroup[];
  onNavigateToSquad?: () => void;
}

export const TranscribeAudioView: React.FC<TranscribeAudioViewProps> = ({
  groups,
  onNavigateToSquad,
}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcript, setTranscript] = useState<string>('');
  const [selectedChatId, setSelectedChatId] = useState<number>(() => {
    return groups.length > 0 ? groups[0].tgChatId : -1004315910637;
  });
  const [selectedBotId, setSelectedBotId] = useState<string>('vrishti');
  const [bots, setBots] = useState<ManagedBot[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<any>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Load bot squad for sender selection
  useEffect(() => {
    fetch('/api/botsquad')
      .then((res) => res.json())
      .then((data) => {
        if (data.ok && Array.isArray(data.squad)) {
          setBots(data.squad);
        }
      })
      .catch(() => {});
  }, []);

  // Update selectedChatId when groups load
  useEffect(() => {
    if (groups.length > 0 && selectedChatId === -1004315910637) {
      setSelectedChatId(groups[0].tgChatId);
    }
  }, [groups]);

  // Handle Recording Timer
  useEffect(() => {
    if (isRecording) {
      setRecordingDuration(0);
      timerRef.current = setInterval(() => {
        setRecordingDuration((prev) => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isRecording]);

  const startRecording = async () => {
    try {
      setStatusMessage(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];

      let mimeType = 'audio/webm';
      if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
        mimeType = 'audio/webm;codecs=opus';
      } else if (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) {
        mimeType = 'audio/ogg;codecs=opus';
      } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
        mimeType = 'audio/mp4';
      }

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        setAudioBlob(audioBlob);
        const url = URL.createObjectURL(audioBlob);
        setAudioUrl(url);
        // Stop stream tracks
        stream.getTracks().forEach((track) => track.stop());
        // Automatically start transcribing
        transcribeBlob(audioBlob, mimeType);
      };

      recorder.start(250); // Slice every 250ms
      setIsRecording(true);
    } catch (err: any) {
      console.error('Microphone access failed:', err);
      setStatusMessage({
        type: 'error',
        text: `Microphone permission denied or not available: ${err.message}`,
      });
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const transcribeBlob = async (blob: Blob, mimeType: string) => {
    setIsTranscribing(true);
    setStatusMessage(null);
    try {
      const reader = new FileReader();
      reader.readAsDataURL(blob);
      reader.onloadend = async () => {
        const base64Audio = reader.result as string;
        const res = await fetch('/api/transcribe-audio', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            audioData: base64Audio,
            mimeType: blob.type || mimeType || 'audio/webm',
          }),
        });

        const data = await res.json();
        if (data.ok && typeof data.transcript === 'string') {
          setTranscript(data.transcript);
          setStatusMessage({
            type: 'success',
            text: `Audio transcribed successfully via gemini-3.5-transcribe!`,
          });
        } else {
          throw new Error(data.error || 'Failed to transcribe');
        }
        setIsTranscribing(false);
      };
    } catch (err: any) {
      console.error('Transcription error:', err);
      setStatusMessage({
        type: 'error',
        text: `Transcription error: ${err.message || 'Unknown error'}`,
      });
      setIsTranscribing(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setStatusMessage(null);
    setAudioBlob(file);
    const url = URL.createObjectURL(file);
    setAudioUrl(url);
    transcribeBlob(file, file.type || 'audio/wav');
  };

  const handleCopyTranscript = () => {
    if (!transcript) return;
    navigator.clipboard.writeText(transcript);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSendToTelegram = async () => {
    if (!transcript.trim()) {
      setStatusMessage({ type: 'error', text: 'No transcript text to send' });
      return;
    }

    setIsSending(true);
    setStatusMessage(null);
    try {
      const selectedBot = bots.find((b) => b.id === selectedBotId);
      const res = await fetch('/api/transcribe-audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audioData: 'dummy', // Already transcribed
          transcriptOverride: transcript,
          sendToChatId: selectedChatId,
          botId: selectedBotId,
        }),
      });

      // If backend direct endpoint didn't handle transcriptOverride, use custom activity endpoint
      const actRes = await fetch('/api/botsquad/post-activity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          botId: selectedBotId,
          chatId: selectedChatId,
          activityType: 'meme_banter',
          customCaption: `🎙️ **Voice Note Transcript (${selectedBot?.name || 'Bot'}):**\n\n"${transcript}"\n\n💬 _Sent via TeleGroup Audio Transcribe Studio_`,
          force: true,
          autoDeleteHours: selectedBot?.autoDeleteHours || 0,
        }),
      });

      const actData = await actRes.json();
      if (actData.ok) {
        setStatusMessage({
          type: 'success',
          text: `Sent to ${actData.targetTitle || 'Telegram'} via ${selectedBot?.name || 'Bot'}!`,
        });
      } else {
        throw new Error(actData.error || 'Failed to dispatch to Telegram');
      }
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: `Error sending to Telegram: ${err.message}`,
      });
    } finally {
      setIsSending(false);
    }
  };

  const resetAll = () => {
    setAudioBlob(null);
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(null);
    setTranscript('');
    setRecordingDuration(0);
    setStatusMessage(null);
  };

  const formatSeconds = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const remaining = sec % 60;
    return `${mins.toString().padStart(2, '0')}:${remaining.toString().padStart(2, '0')}`;
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-semibold bg-purple-500/10 text-purple-400 border border-purple-500/20">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Powered by Gemini 3.5 Transcribe</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white flex items-center gap-2.5">
              <span>🎙️ Voice Input & Audio Transcription</span>
            </h1>
            <p className="text-xs sm:text-sm text-slate-400 max-w-2xl">
              Microphone वापरून आवाज रेकॉर्ड करा किंवा ऑडिओ फाईल अपलोड करा. 
              <strong> gemini-3.5-transcribe</strong> मॉडेलद्वारे मराठी, हिंदी, Hinglish आणि इंग्रजी आवाज अचूक टेक्स्टमध्ये रूपांतरित करा आणि थेट Telegram ग्रुप/चॅनेलवर पाठवा.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={resetAll}
              className="px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800/80 hover:bg-slate-800 text-slate-300 text-xs font-medium flex items-center gap-1.5 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Dual Grid: Voice Recorder & Transcript Result */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Voice Recording Console (5 cols) */}
        <div className="lg:col-span-5 space-y-5">
          {/* Microphone Card */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-6 flex flex-col items-center text-center">
            <div className="space-y-1">
              <h2 className="text-sm font-semibold text-white">Live Microphone Record</h2>
              <p className="text-xs text-slate-400">
                माईक सुरू करण्यासाठी खालील बटनावर क्लिक करा आणि बोला
              </p>
            </div>

            {/* Circular Mic Button */}
            <div className="relative flex items-center justify-center my-3">
              {isRecording && (
                <div className="absolute w-36 h-36 rounded-full bg-rose-500/20 animate-ping pointer-events-none" />
              )}
              <button
                onClick={isRecording ? stopRecording : startRecording}
                disabled={isTranscribing}
                className={`relative z-10 w-28 h-28 rounded-full flex flex-col items-center justify-center gap-1.5 transition-all shadow-xl active:scale-95 ${
                  isRecording
                    ? 'bg-rose-600 hover:bg-rose-500 text-white ring-4 ring-rose-500/30'
                    : 'bg-gradient-to-tr from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white shadow-purple-600/20'
                }`}
              >
                {isRecording ? (
                  <>
                    <Square className="w-8 h-8 fill-current" />
                    <span className="text-[10px] font-bold tracking-wider uppercase">Stop</span>
                  </>
                ) : (
                  <>
                    <Mic className="w-8 h-8" />
                    <span className="text-[10px] font-bold tracking-wider uppercase">Record</span>
                  </>
                )}
              </button>
            </div>

            {/* Recording Timer & Wave Status */}
            <div className="space-y-2">
              <div className="text-2xl font-mono font-bold tracking-wider text-slate-100">
                {formatSeconds(recordingDuration)}
              </div>
              <div className="flex items-center justify-center gap-2">
                <span
                  className={`w-2.5 h-2.5 rounded-full ${
                    isRecording ? 'bg-rose-500 animate-pulse' : 'bg-slate-600'
                  }`}
                />
                <span className="text-xs font-medium text-slate-400">
                  {isRecording
                    ? 'Recording audio... Speak clearly'
                    : audioBlob
                    ? 'Audio recorded & ready'
                    : 'Ready to record'}
                </span>
              </div>
            </div>

            {/* Audio Playback Player */}
            {audioUrl && (
              <div className="w-full pt-4 border-t border-slate-800 space-y-2">
                <div className="text-xs text-slate-400 font-medium flex items-center justify-between">
                  <span>Recorded Audio Playback:</span>
                  <span className="font-mono text-purple-400 text-[11px]">
                    {audioBlob ? `${(audioBlob.size / 1024).toFixed(1)} KB` : ''}
                  </span>
                </div>
                <audio controls src={audioUrl} className="w-full h-9 rounded bg-slate-950" />
              </div>
            )}

            {/* Alternative: Upload Audio File */}
            <div className="w-full pt-4 border-t border-slate-800">
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*"
                onChange={handleFileUpload}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isRecording || isTranscribing}
                className="w-full py-2 px-3 rounded-lg border border-slate-700 bg-slate-950/80 hover:bg-slate-800 text-slate-300 text-xs font-medium flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
              >
                <Upload className="w-3.5 h-3.5 text-slate-400" />
                <span>Upload Audio File (.mp3, .wav, .ogg, .m4a)</span>
              </button>
            </div>
          </div>
        </div>

        {/* Right Column: Transcription Output & Telegram Actions (7 cols) */}
        <div className="lg:col-span-7 space-y-5">
          {/* Transcript Display Box */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileAudio className="w-4 h-4 text-purple-400" />
                <h3 className="text-sm font-semibold text-white">Transcribed Output (लिखित मजकूर)</h3>
              </div>

              {transcript && (
                <button
                  onClick={handleCopyTranscript}
                  className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium flex items-center gap-1.5 transition-colors"
                >
                  {copied ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-emerald-400">Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              )}
            </div>

            {/* Transcript Textarea or Loading State */}
            {isTranscribing ? (
              <div className="h-44 flex flex-col items-center justify-center gap-3 bg-slate-950/80 rounded-lg border border-purple-500/20 p-6">
                <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
                <div className="text-center space-y-1">
                  <div className="text-xs font-semibold text-purple-300">
                    Transcribing with gemini-3.5-transcribe...
                  </div>
                  <div className="text-[11px] text-slate-400">
                    आवाजाचे विश्लेषण आणि मजकूर तयार करणे चालू आहे...
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <textarea
                  value={transcript}
                  onChange={(e) => setTranscript(e.target.value)}
                  placeholder="तुमचा रेकॉर्ड केलेला आवाज येथे आपोआप ट्रान्सक्राइब होईल (मराठी, हिंदी किंवा इंग्रजी). किंवा थेट टाईप करा..."
                  rows={6}
                  className="w-full bg-slate-950/90 border border-slate-800 focus:border-purple-500 rounded-lg p-3 text-sm text-slate-100 placeholder-slate-500 focus:outline-none transition-colors resize-y leading-relaxed font-sans"
                />
                <div className="flex items-center justify-between text-[11px] text-slate-500 px-1">
                  <span>Character count: {transcript.length} | Words: {transcript.trim() ? transcript.trim().split(/\s+/).length : 0}</span>
                  <span>Model: <strong>gemini-3.5-transcribe</strong></span>
                </div>
              </div>
            )}

            {/* Status Message */}
            {statusMessage && (
              <div
                className={`p-3 rounded-lg text-xs flex items-center gap-2 ${
                  statusMessage.type === 'success'
                    ? 'bg-emerald-950/70 border border-emerald-800 text-emerald-200'
                    : 'bg-rose-950/70 border border-rose-800 text-rose-200'
                }`}
              >
                <span>{statusMessage.text}</span>
              </div>
            )}
          </div>

          {/* Quick Telegram Dispatch & Bot Squad Integration */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
            <div className="flex items-center gap-2">
              <Radio className="w-4 h-4 text-pink-400" />
              <h3 className="text-sm font-semibold text-white">
                Telegram ग्रुप किंवा चॅनेलवर थेट पोस्ट करा
              </h3>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Target Chat Selector */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300">Target Chat:</label>
                <select
                  value={selectedChatId}
                  onChange={(e) => setSelectedChatId(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-700 text-white rounded-lg px-3 py-2 text-xs font-medium focus:outline-none focus:border-purple-500"
                >
                  {groups.length > 0 ? (
                    groups.map((g) => (
                      <option key={g.id} value={g.tgChatId}>
                        {g.title} ({g.type || 'Group'})
                      </option>
                    ))
                  ) : (
                    <option value="-1004315910637">Strip club 🍷 (-1004315910637)</option>
                  )}
                </select>
              </div>

              {/* Sender Bot Selector */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300">Sender Bot:</label>
                <select
                  value={selectedBotId}
                  onChange={(e) => setSelectedBotId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 text-white rounded-lg px-3 py-2 text-xs font-medium focus:outline-none focus:border-purple-500"
                >
                  {bots.length > 0 ? (
                    bots.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.avatarEmoji} {b.name} ({b.persona})
                      </option>
                    ))
                  ) : (
                    <>
                      <option value="vrishti">👑 Vrishti Pande</option>
                      <option value="shanaya">💋 Shanaya Gill</option>
                      <option value="kiara">🎮 Kiara Singhania</option>
                      <option value="myra">💀 Myra Oberoi</option>
                    </>
                  )}
                </select>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="pt-2 flex flex-col sm:flex-row items-center gap-3">
              <button
                type="button"
                onClick={handleSendToTelegram}
                disabled={!transcript.trim() || isSending || isTranscribing}
                className="w-full sm:flex-1 py-2.5 px-4 rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-xs font-semibold flex items-center justify-center gap-2 shadow-lg shadow-purple-600/20 transition-all disabled:opacity-50"
              >
                {isSending ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Sending to Telegram...</span>
                  </>
                ) : (
                  <>
                    <Send className="w-3.5 h-3.5" />
                    <span>Send Transcript to Telegram</span>
                  </>
                )}
              </button>

              {onNavigateToSquad && (
                <button
                  type="button"
                  onClick={onNavigateToSquad}
                  className="w-full sm:w-auto py-2.5 px-4 rounded-lg border border-slate-700 bg-slate-950 hover:bg-slate-800 text-slate-300 text-xs font-medium flex items-center justify-center gap-2 transition-colors"
                >
                  <Layers className="w-3.5 h-3.5 text-pink-400" />
                  <span>Open Bot Squad (4 Bots)</span>
                  <ArrowRight className="w-3 h-3 text-slate-500" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
