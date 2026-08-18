import React, { useState, useEffect } from 'react';

const getApiServer = () => {
  if (typeof window === 'undefined') return 'http://127.0.0.1:5000';
  const saved = localStorage.getItem('api_server_url');
  if (saved && saved.trim()) return saved.trim().replace(/\/+$/, '');
  
  const protocol = window.location.protocol;
  const hostname = window.location.hostname || '127.0.0.1';

  // If running in Electron via file:// protocol or origin is 'null'
  if (protocol === 'file:' || !window.location.origin || window.location.origin === 'null') {
    return 'http://127.0.0.1:5000';
  }
  if (window.location.port === '5173') {
    return `${protocol}//${hostname}:5000`;
  }
  if (hostname.endsWith('.vercel.app') || hostname.endsWith('.netlify.app')) {
    return 'http://127.0.0.1:5000';
  }
  return window.location.origin;
};

const API_BASE = `${getApiServer()}/api`;

export default function SessionManager({ token, onSelectSession, activeSessionName }) {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showQrModal, setShowQrModal] = useState(false);
  const [selectedSessionName, setSelectedSessionName] = useState(null);
  const [newSessionName, setNewSessionName] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const fetchSessions = async (showLoadingSpinner = false) => {
    try {
      if (showLoadingSpinner) {
        setLoading(true);
      }
      const res = await fetch(`${API_BASE}/automation/sessions`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      const text = await res.text();
      let data = [];
      if (text) {
        try { data = JSON.parse(text); } catch (_e) {}
      }
      if (Array.isArray(data)) {
        setSessions(data);
      } else {
        setSessions([]);
      }
    } catch (err) {
      console.error('Error fetching sessions:', err);
      setSessions([]);
    } finally {
      if (showLoadingSpinner) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    fetchSessions(true);
    // Background polling should be silent to eliminate 4-second loading flicker
    const interval = setInterval(() => {
      fetchSessions(false);
    }, 4000);
    return () => clearInterval(interval);
  }, [token]);

  const selectedSession = (Array.isArray(sessions) ? sessions : []).find(s => s && s.session_name === selectedSessionName) || null;

  useEffect(() => {
    if (selectedSession && (selectedSession.connected || selectedSession.status === 'Connected')) {
      setShowQrModal(false);
    }
  }, [sessions, selectedSessionName]);

  const handleCreateSession = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    try {
      const res = await fetch(`${API_BASE}/automation/sessions/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ session_name: newSessionName, engine: 'whatsapp-web.js' })
      });
      const text = await res.text();
      let data = {};
      if (text) {
        try { data = JSON.parse(text); } catch (_e) {}
      }
      if (!res.ok) {
        throw new Error(data.error || 'Failed to create session');
      }
      setNewSessionName('');
      fetchSessions(false);
    } catch (err) {
      setErrorMsg(err.message || 'Error creating session profile');
    }
  };

  const handleConnect = async (sess) => {
    setErrorMsg('');
    setSelectedSessionName(sess.session_name);
    if (sess.connected || sess.status === 'Connected') {
      if (onSelectSession) onSelectSession(sess.session_name);
      return;
    }
    setShowQrModal(true);
    try {
      const res = await fetch(`${API_BASE}/automation/session/connect`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ session: sess.session_name, engine: 'whatsapp-web.js' })
      });
      const text = await res.text();
      let data = {};
      if (text) {
        try { data = JSON.parse(text); } catch (_e) {}
      }
      if (!res.ok) {
        throw new Error(data.error || `Failed to connect session (${res.status})`);
      }
      fetchSessions(false);
    } catch (err) {
      console.error('Error connecting session:', err);
      setErrorMsg(err.message || 'Error connecting WhatsApp profile. Please verify node backend is active.');
    }
  };

  const handleLogout = async (sess) => {
    setErrorMsg('');
    try {
      const res = await fetch(`${API_BASE}/automation/logout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ session: sess.session_name })
      });
      const text = await res.text();
      let data = {};
      if (text) {
        try { data = JSON.parse(text); } catch (_e) {}
      }
      if (!res.ok) {
        throw new Error(data.error || `Failed to disconnect session (${res.status})`);
      }
      fetchSessions(false);
    } catch (err) {
      console.error('Error logging out session:', err);
      setErrorMsg(err.message || 'Failed to disconnect session profile');
    }
  };

  const handleDelete = async (id, sessionName) => {
    setErrorMsg('');
    const displayName = sessionName || id || 'WhatsApp profile';
    if (!window.confirm(`Are you sure you want to completely delete and unlink WhatsApp profile '${displayName}'? This will disconnect the session and remove its local credentials.`)) {
      return;
    }
    try {
      const target = id || sessionName;
      const res = await fetch(`${API_BASE}/automation/sessions/${encodeURIComponent(target)}`, {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      const text = await res.text();
      let data = {};
      if (text) {
        try { data = JSON.parse(text); } catch (_e) {}
      }
      if (!res.ok) {
        throw new Error(data.error || `Failed to delete session (${res.status})`);
      }
      fetchSessions(false);
    } catch (err) {
      console.error('Error deleting session profile:', err);
      setErrorMsg(err.message || 'Failed to delete session profile');
    }
  };

  return (
    <div className="bg-slate-900/80 backdrop-blur-md border border-slate-800 rounded-2xl p-6 shadow-xl mb-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <span>📱</span> OpenWA Multi-Session Manager
          </h2>
          <p className="text-sm text-slate-400">
            Powered by OpenWA <span className="text-emerald-400 font-mono text-xs px-2 py-0.5 bg-emerald-950/60 border border-emerald-800 rounded-md">whatsapp-web.js engine</span>
          </p>
        </div>
        <button
          onClick={() => fetchSessions(true)}
          className="text-xs px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition flex items-center gap-1.5"
        >
          <span>🔄</span> Refresh Status
        </button>
      </div>

      {errorMsg && (
        <div className="bg-rose-950/60 border border-rose-800 text-rose-300 text-sm p-3 rounded-lg mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span>⚠️</span>
            <span>{errorMsg}</span>
          </div>
          <button onClick={() => setErrorMsg('')} className="text-xs text-rose-400 hover:text-white">✕</button>
        </div>
      )}

      {/* Empty State when no sessions configured */}
      {sessions.length === 0 && !loading && (
        <div className="text-center py-8 px-4 bg-slate-950/50 border border-dashed border-slate-800 rounded-xl mb-6">
          <span className="text-3xl block mb-2">📱</span>
          <p className="text-sm font-semibold text-slate-200">No WhatsApp Profiles Configured</p>
          <p className="text-xs text-slate-400 mt-1">Add a new WhatsApp account name below to link a profile.</p>
        </div>
      )}

      {/* Session Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        {sessions.map((sess) => {
          const isSelected = activeSessionName === sess.session_name;
          const isConnected = sess.connected || sess.status === 'Connected';
          const needsQr = sess.qrImageUrl || sess.status === 'Scan QR Required';

          return (
            <div
              key={sess.id || sess.session_name}
              className={`p-4 rounded-xl border transition-all ${
                isSelected
                  ? 'bg-emerald-950/30 border-emerald-500 shadow-lg shadow-emerald-950/50'
                  : 'bg-slate-800/50 border-slate-700/60 hover:border-slate-600'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="font-semibold text-white truncate max-w-[160px]">
                  {sess.session_name}
                </span>
                <span
                  className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                    isConnected
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      : needsQr
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30 animate-pulse'
                      : 'bg-slate-700 text-slate-400'
                  }`}
                >
                  {isConnected ? '🟢 Connected' : needsQr ? '🟡 Scan QR' : '⚪ Disconnected'}
                </span>
              </div>

              <div className="text-xs text-slate-400 mb-3 space-y-1">
                <div>Phone: <span className="text-slate-200 font-mono">{sess.phone_number || 'Not Linked'}</span></div>
                <div>Engine: <span className="text-emerald-400 font-mono">whatsapp-web.js</span></div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2 pt-2 border-t border-slate-700/50">
                {isConnected ? (
                  <>
                    <button
                      onClick={() => onSelectSession && onSelectSession(sess.session_name)}
                      className={`flex-1 text-xs py-1.5 rounded-lg font-medium transition ${
                        isSelected
                          ? 'bg-emerald-600 text-white'
                          : 'bg-slate-700 hover:bg-slate-600 text-slate-200'
                      }`}
                    >
                      {isSelected ? '✓ Active Session' : 'Select for Campaign'}
                    </button>
                    <button
                      onClick={() => handleLogout(sess)}
                      className="text-xs px-2.5 py-1.5 bg-rose-900/40 hover:bg-rose-800/60 text-rose-300 rounded-lg transition"
                      title="Disconnect Session"
                    >
                      Disconnect
                    </button>
                    <button
                      onClick={() => handleDelete(sess.id, sess.session_name)}
                      className="text-xs px-2.5 py-1.5 bg-slate-800 hover:bg-rose-900/50 text-slate-400 hover:text-rose-300 rounded-lg transition border border-slate-700"
                      title="Delete & Unlink Profile"
                    >
                      🗑️
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => handleConnect(sess)}
                      className="flex-1 text-xs py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-medium transition"
                    >
                      {needsQr ? '📷 View QR Code' : '⚡ Connect WhatsApp'}
                    </button>
                    <button
                      onClick={() => handleDelete(sess.id, sess.session_name)}
                      className="text-xs px-2.5 py-1.5 bg-slate-800 hover:bg-rose-900/50 text-slate-400 hover:text-rose-300 rounded-lg transition border border-slate-700"
                      title="Delete Profile"
                    >
                      🗑️
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Add New Session Form */}
      <form onSubmit={handleCreateSession} className="flex gap-3">
        <input
          type="text"
          placeholder="New WhatsApp Number / Account Name..."
          value={newSessionName}
          onChange={(e) => setNewSessionName(e.target.value)}
          className="flex-1 bg-slate-800 border border-slate-700 text-white text-sm rounded-xl px-4 py-2 focus:outline-none focus:border-emerald-500"
        />
        <button
          type="submit"
          disabled={!newSessionName.trim()}
          className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-xl transition"
        >
          + Add Account
        </button>
      </form>

      {/* QR Code Modal */}
      {showQrModal && selectedSession && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-sm w-full shadow-2xl text-center">
            <h3 className="text-lg font-bold text-white mb-1">
              Link WhatsApp Account
            </h3>
            <p className="text-xs text-slate-400 mb-4">
              Session: <span className="text-emerald-400 font-mono">{selectedSession.session_name}</span> (whatsapp-web.js)
            </p>

            {errorMsg && (
              <div className="bg-rose-950/80 border border-rose-800 text-rose-300 text-xs p-2.5 rounded-lg mb-3">
                ⚠️ {errorMsg}
              </div>
            )}

            <div className="bg-white p-4 rounded-xl inline-block mb-4 shadow-inner">
              {selectedSession.qrImageUrl ? (
                <img
                  src={selectedSession.qrImageUrl}
                  alt="WhatsApp QR Code"
                  className="w-56 h-56 object-contain"
                />
              ) : (
                <div className="w-56 h-56 flex flex-col items-center justify-center text-slate-600 gap-2 p-2 text-center">
                  <div className="animate-spin text-2xl">⏳</div>
                  <span className="text-xs font-semibold text-slate-700">
                    {selectedSession.status === 'Connecting' || selectedSession.status === 'Initializing' || selectedSession.status === 'CONNECTED'
                      ? 'Restoring saved session from mobile device...'
                      : 'Generating QR Code via OpenWA...'}
                  </span>
                  <span className="text-[10px] text-slate-400">
                    If already logged in, this window will close automatically.
                  </span>
                </div>
              )}
            </div>

            <p className="text-xs text-slate-400 mb-6">
              Open WhatsApp on your phone &gt; Linked Devices &gt; Link a Device and scan the QR code above.
            </p>

            <button
              onClick={() => setShowQrModal(false)}
              className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm rounded-xl transition"
            >
              Close Window
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
