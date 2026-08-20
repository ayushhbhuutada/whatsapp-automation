import React, { useState, useEffect } from 'react';
import { 
  Sparkles, 
  Download, 
  CheckCircle, 
  AlertTriangle, 
  RefreshCw, 
  X, 
  ArrowRight, 
  ShieldCheck, 
  Zap 
} from 'lucide-react';
import axios from 'axios';

export default function AutoUpdateModal({ 
  isOpen, 
  onClose, 
  apiBase, 
  initialMode = 'check', 
  currentVersion = '1.0.0' 
}) {
  const [stage, setStage] = useState('checking'); // 'checking' | 'available' | 'downloading' | 'ready' | 'up_to_date' | 'error'
  const [updateInfo, setUpdateInfo] = useState(null);
  const [progress, setProgress] = useState({ percent: 0, speed: '0 KB/s', transferredBytes: 0, totalBytes: 0 });
  const [errorMsg, setErrorMsg] = useState('');
  const [autoInstallCountdown, setAutoInstallCountdown] = useState(null);

  useEffect(() => {
    if (!isOpen) return;

    // Listen to live Electron IPC progress events if available
    let cleanup = null;
    if (window.electronAPI?.onUpdateProgress) {
      window.electronAPI.onUpdateProgress((data) => {
        if (data) {
          setProgress(data);
          if (data.status === 'downloading') setStage('downloading');
          if (data.status === 'ready' || data.percent >= 100) setStage('ready');
          if (data.status === 'error') {
            setStage('error');
            setErrorMsg(data.error || 'Download failed');
          }
        }
      });
    }

    if (initialMode === 'check') {
      runUpdateCheck();
    }

    return () => {
      if (typeof cleanup === 'function') cleanup();
    };
  }, [isOpen, initialMode]);

  const runUpdateCheck = async () => {
    setStage('checking');
    setErrorMsg('');

    try {
      // 1. Try direct Electron IPC check first
      let resData = null;
      if (window.electronAPI?.checkForUpdates) {
        try {
          resData = await window.electronAPI.checkForUpdates();
        } catch (_e) {}
      }

      // 2. Fall back to backend /api/updates/check
      if (!resData || resData.updateAvailable === undefined) {
        const res = await axios.get(`${apiBase}/updates/check`);
        resData = res.data;
      }

      if (resData && resData.updateAvailable) {
        setUpdateInfo(resData);
        setStage('available');
      } else {
        setUpdateInfo(resData || { currentVersion });
        setStage('up_to_date');
      }
    } catch (err) {
      console.warn('Update check error:', err);
      setStage('error');
      setErrorMsg(err.response?.data?.error || err.message || 'Failed to connect to update server');
    }
  };

  const startDownload = async () => {
    if (!updateInfo || !updateInfo.downloadUrl) return;

    setStage('downloading');
    setProgress({ percent: 5, speed: 'Connecting...', transferredBytes: 0, totalBytes: updateInfo.assetSize || 0 });

    try {
      // 1. Try direct Electron IPC download
      if (window.electronAPI?.downloadUpdate) {
        window.electronAPI.downloadUpdate({
          downloadUrl: updateInfo.downloadUrl,
          version: updateInfo.latestVersion
        }).then((res) => {
          if (res && res.success) {
            setStage('ready');
          }
        }).catch((err) => {
          setStage('error');
          setErrorMsg(err.message || 'Update download failed');
        });
      } else {
        // 2. Fall back to backend API trigger
        await axios.post(`${apiBase}/updates/download`, {
          downloadUrl: updateInfo.downloadUrl,
          version: updateInfo.latestVersion
        });
      }

      // Poll progress fallback if IPC is not streaming
      const interval = setInterval(async () => {
        try {
          const pRes = await axios.get(`${apiBase}/updates/progress`);
          const pData = pRes.data?.progress;
          if (pData) {
            setProgress(pData);
            if (pData.status === 'ready' || pData.percent >= 100) {
              clearInterval(interval);
              setStage('ready');
            } else if (pData.status === 'error') {
              clearInterval(interval);
              setStage('error');
              setErrorMsg(pData.error || 'Download failed');
            }
          }
        } catch (_e) {}
      }, 800);

    } catch (err) {
      setStage('error');
      setErrorMsg(err.response?.data?.error || err.message || 'Failed to start download');
    }
  };

  const installAndRestart = async () => {
    try {
      if (window.electronAPI?.installUpdate) {
        await window.electronAPI.installUpdate({
          installerPath: updateInfo?.installerPath
        });
      } else {
        await axios.post(`${apiBase}/updates/install`, {
          installerPath: updateInfo?.installerPath
        });
      }
    } catch (err) {
      alert('Failed to launch installer: ' + err.message);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fadeIn">
      <div className="relative w-full max-w-md bg-slate-900 border border-slate-800/90 rounded-2xl shadow-2xl overflow-hidden text-slate-100 flex flex-col">
        
        {/* Header decoration bar */}
        <div className="h-1.5 w-full bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-500" />

        {/* Modal Topbar */}
        <div className="p-5 pb-3 flex items-center justify-between border-b border-slate-800/60">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
              <Zap size={18} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white tracking-tight">Software Auto-Updater</h3>
              <p className="text-[11px] text-slate-400">WhatsApp Automation Desktop Suite</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-5">

          {/* Stage 1: Checking for updates */}
          {stage === 'checking' && (
            <div className="py-6 flex flex-col items-center justify-center text-center space-y-4">
              <div className="relative flex items-center justify-center">
                <div className="w-16 h-16 rounded-full border-2 border-emerald-500/30 border-t-emerald-400 animate-spin" />
                <Sparkles size={24} className="absolute text-emerald-400 animate-pulse" />
              </div>
              <div className="space-y-1">
                <h4 className="text-base font-bold text-white">Checking for Updates...</h4>
                <p className="text-xs text-slate-400 max-w-xs">
                  Connecting to GitHub Releases and Vercel cloud channels to check for the latest version.
                </p>
              </div>
            </div>
          )}

          {/* Stage 2: Update Available */}
          {stage === 'available' && updateInfo && (
            <div className="space-y-4">
              <div className="p-3.5 bg-emerald-500/10 border border-emerald-500/30 rounded-xl flex items-start gap-3">
                <Sparkles className="text-emerald-400 shrink-0 mt-0.5" size={20} />
                <div className="space-y-0.5">
                  <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider block">
                    New Update Found!
                  </span>
                  <p className="text-sm font-bold text-white">
                    Version v{updateInfo.latestVersion}
                  </p>
                  <p className="text-[11px] text-slate-300">
                    Current installed: <span className="font-mono text-slate-400">v{updateInfo.currentVersion || currentVersion}</span>
                  </p>
                </div>
              </div>

              {/* Release Notes Preview */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">
                  What's New in this Release:
                </label>
                <div className="p-3 bg-slate-950/70 border border-slate-800 rounded-xl max-h-36 overflow-y-auto text-xs text-slate-300 whitespace-pre-wrap font-sans leading-relaxed">
                  {updateInfo.releaseNotes || 'Includes speed optimizations, latest WhatsApp protocol compatibility, and anti-ban safeguards.'}
                </div>
              </div>

              <div className="pt-2 flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={startDownload}
                  className="flex-1 btn-primary py-2.5 text-xs font-bold shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2"
                >
                  <Download size={15} />
                  <span>Auto-Update Now</span>
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="btn-secondary py-2.5 px-4 text-xs font-semibold"
                >
                  Later
                </button>
              </div>
            </div>
          )}

          {/* Stage 3: Downloading / Auto Updating */}
          {stage === 'downloading' && (
            <div className="py-2 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Download size={16} className="text-emerald-400 animate-bounce" />
                  <span className="text-xs font-bold text-white uppercase tracking-wider">Auto-Updating in Progress...</span>
                </div>
                <span className="text-xs font-bold text-emerald-400 font-mono">{progress.percent || 0}%</span>
              </div>

              {/* Progress bar */}
              <div className="w-full h-3 bg-slate-950 rounded-full overflow-hidden border border-slate-800 relative p-0.5">
                <div 
                  className="h-full bg-gradient-to-r from-emerald-600 via-teal-500 to-emerald-400 rounded-full transition-all duration-300 shadow-sm"
                  style={{ width: `${Math.min(100, Math.max(5, progress.percent || 5))}%` }}
                />
              </div>

              <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
                <span>
                  {progress.transferredBytes > 0 
                    ? `${(progress.transferredBytes / (1024 * 1024)).toFixed(1)} MB`
                    : 'Downloading...'
                  }
                  {progress.totalBytes > 0 && ` / ${(progress.totalBytes / (1024 * 1024)).toFixed(1)} MB`}
                </span>
                <span>Speed: {progress.speed || 'Calculating...'}</span>
              </div>

              <p className="text-[11px] text-slate-500 text-center italic">
                Please wait while the update is securely downloaded and verified...
              </p>
            </div>
          )}

          {/* Stage 4: Update Ready */}
          {stage === 'ready' && (
            <div className="py-3 text-center space-y-4">
              <div className="w-14 h-14 bg-emerald-500/15 border border-emerald-500/30 rounded-2xl flex items-center justify-center mx-auto text-emerald-400">
                <CheckCircle size={32} />
              </div>
              <div className="space-y-1">
                <h4 className="text-base font-bold text-white">Update Download Complete!</h4>
                <p className="text-xs text-slate-400">
                  The latest package is verified and ready. Restart the app to finish applying the update.
                </p>
              </div>

              <button
                type="button"
                onClick={installAndRestart}
                className="w-full btn-primary py-3 text-xs font-bold shadow-lg shadow-emerald-500/25 flex items-center justify-center gap-2"
              >
                <RefreshCw size={15} />
                <span>Restart &amp; Apply Update Now</span>
              </button>
            </div>
          )}

          {/* Stage 5: Up to Date */}
          {stage === 'up_to_date' && (
            <div className="py-4 text-center space-y-4">
              <div className="w-12 h-12 bg-emerald-500/10 border border-emerald-500/25 rounded-2xl flex items-center justify-center mx-auto text-emerald-400">
                <ShieldCheck size={28} />
              </div>
              <div className="space-y-1">
                <h4 className="text-base font-bold text-white">You're on the Latest Version</h4>
                <p className="text-xs text-slate-400 font-mono">
                  WhatsApp Automation Pro v{updateInfo?.currentVersion || currentVersion}
                </p>
                <p className="text-[11px] text-slate-500 pt-1">
                  Your client has all the latest anti-ban protections, engine updates, and features installed.
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="btn-secondary w-full py-2 text-xs font-bold"
              >
                Close
              </button>
            </div>
          )}

          {/* Stage 6: Error */}
          {stage === 'error' && (
            <div className="py-3 text-center space-y-4">
              <div className="w-12 h-12 bg-rose-500/10 border border-rose-500/25 rounded-2xl flex items-center justify-center mx-auto text-rose-400">
                <AlertTriangle size={26} />
              </div>
              <div className="space-y-1">
                <h4 className="text-sm font-bold text-rose-400">Update Check Notice</h4>
                <p className="text-xs text-slate-300 max-w-xs mx-auto">
                  {errorMsg || 'Could not connect to update server. Check your internet connection.'}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={runUpdateCheck}
                  className="flex-1 btn-primary py-2 text-xs font-bold flex items-center justify-center gap-1.5"
                >
                  <RefreshCw size={13} />
                  <span>Retry</span>
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="btn-secondary py-2 px-4 text-xs font-semibold"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}

        </div>

        {/* Modal Footer Info */}
        <div className="p-3 bg-slate-950/60 border-t border-slate-800/60 flex items-center justify-between text-[10px] text-slate-500 px-5">
          <span>Source: GitHub Releases &amp; Vercel Cloud</span>
          <span>Automatic Safety Check</span>
        </div>

      </div>
    </div>
  );
}
