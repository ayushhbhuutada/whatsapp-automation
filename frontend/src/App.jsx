import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { 
  LayoutDashboard, 
  Upload, 
  Users, 
  FileText, 
  Settings as SettingsIcon,
  Play, 
  Pause, 
  Square, 
  RefreshCw, 
  Search, 
  AlertTriangle, 
  CheckCircle, 
  XCircle, 
  Clock, 
  FileSpreadsheet, 
  Plus, 
  Send,
  HelpCircle,
  FolderOpen,
  Sliders,
  UserPlus,
  Tag,
  Trash2,
  Edit3,
  Layers,
  Globe,
  Clipboard,
  QrCode,
  Smartphone,
  LogOut,
  ShieldCheck
} from 'lucide-react';

const getApiServer = () => {
  if (typeof window === 'undefined') return 'http://127.0.0.1:5000';
  const protocol = window.location.protocol;
  const hostname = window.location.hostname || '127.0.0.1';
  // If running via Vite dev server (port 5173), target backend at 5000
  if (window.location.port === '5173') {
    return `${protocol}//${hostname}:5000`;
  }
  return window.location.origin;
};

const API_SERVER = getApiServer();
const API_BASE = `${API_SERVER}/api`;

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [campaigns, setCampaigns] = useState([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState('');
  const [contacts, setContacts] = useState([]);
  const [logs, setLogs] = useState([]);
  const [settings, setSettings] = useState({});
  const [automationStatus, setAutomationStatus] = useState({ status: 'Idle', currentCampaignId: null });
  const [sessionData, setSessionData] = useState({ connected: false, status: 'Not Connected', qrImageUrl: null });
  const [isConnectingSession, setIsConnectingSession] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [systemAlert, setSystemAlert] = useState(null);

  // Authentication State
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem('user');
    return saved ? JSON.parse(saved) : null;
  });
  const [token, setToken] = useState(() => localStorage.getItem('token') || '');
  const [authMode, setAuthMode] = useState('login'); // 'login' or 'register'
  const [authFormData, setAuthFormData] = useState({ name: '', email: '', password: '' });
  const [authError, setAuthError] = useState('');

  // Configure Axios default header and 401 interceptor
  useEffect(() => {
    if (token) {
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    } else {
      delete axios.defaults.headers.common['Authorization'];
    }
  }, [token]);

  // Validate stored token on load
  useEffect(() => {
    if (token) {
      axios.get(`${API_BASE}/auth/me`)
        .then(res => setUser(res.data.user))
        .catch(() => handleLogout());
    }
  }, []);

  // Auth Handlers
  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    setAuthError('');
    try {
      const endpoint = authMode === 'login' ? `${API_BASE}/auth/login` : `${API_BASE}/auth/register`;
      const res = await axios.post(endpoint, authFormData);
      setToken(res.data.token);
      setUser(res.data.user);
      localStorage.setItem('token', res.data.token);
      localStorage.setItem('user', JSON.stringify(res.data.user));
    } catch (err) {
      setAuthError(err.response?.data?.error || 'Authentication failed. Please check your credentials.');
    }
  };

  const handleLogout = () => {
    setToken('');
    setUser(null);
    localStorage.removeItem('token');
    localStorage.removeItem('user');
  };

  // Polling interval reference for campaigns
  const pollRef = useRef(null);

  // Load initial data
  useEffect(() => {
    if (token) {
      fetchSettings();
      fetchCampaigns();
      fetchAutomationStatus();
      fetchSessionData();
    }
  }, [token]);

  // Poll automation status and active campaign details
  useEffect(() => {
    const intervalTime = (automationStatus.status === 'Running' || automationStatus.status === 'Paused') ? 2000 : 4000;
    
    pollRef.current = setInterval(() => {
      fetchAutomationStatus();
      fetchCampaigns();
      fetchSessionData();
      if (selectedCampaignId) {
        fetchContacts(selectedCampaignId);
        fetchLogs(selectedCampaignId);
      }
    }, intervalTime);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [automationStatus.status, selectedCampaignId]);

  // Set selected campaign initially to the latest one
  useEffect(() => {
    if (campaigns.length > 0 && !selectedCampaignId) {
      setSelectedCampaignId(campaigns[0].id.toString());
      fetchContacts(campaigns[0].id);
      fetchLogs(campaigns[0].id);
    }
  }, [campaigns]);

  // Handle selected campaign change
  const handleCampaignChange = (id) => {
    setSelectedCampaignId(id);
    if (id) {
      fetchContacts(id);
      fetchLogs(id);
    } else {
      setContacts([]);
      setLogs([]);
    }
  };

  const fetchSettings = async () => {
    try {
      const res = await axios.get(`${API_BASE}/settings`);
      setSettings(res.data);
    } catch (err) {
      console.error('Error fetching settings:', err);
    }
  };

  const fetchCampaigns = async () => {
    try {
      const res = await axios.get(`${API_BASE}/campaigns`);
      setCampaigns(res.data);
    } catch (err) {
      console.error('Error fetching campaigns:', err);
    }
  };

  const fetchAutomationStatus = async () => {
    try {
      const res = await axios.get(`${API_BASE}/automation/status`);
      setAutomationStatus(res.data);
    } catch (err) {
      console.error('Error fetching automation status:', err);
    }
  };

  const fetchSessionData = async () => {
    try {
      const res = await axios.get(`${API_BASE}/automation/session`);
      setSessionData(res.data);
    } catch (err) {
      console.error('Error fetching session data:', err);
    }
  };

  const handleConnectSession = async () => {
    setIsConnectingSession(true);
    try {
      const res = await axios.post(`${API_BASE}/automation/session/connect`, {}, { timeout: 15000 });
      setSessionData(res.data);
    } catch (err) {
      console.warn('Connect session notice:', err.message);
      // Refresh status immediately as browser launches in background
      await fetchSessionData();
    } finally {
      setIsConnectingSession(false);
    }
  };

  const handleLogoutSession = async () => {
    if (!confirm('Are you sure you want to disconnect your WhatsApp account from this computer?')) return;
    try {
      await axios.post(`${API_BASE}/automation/logout`);
      fetchSessionData();
    } catch (err) {
      alert(`Failed to logout session: ${err.message}`);
    }
  };

  const fetchContacts = async (campaignId, search = '', status = '') => {
    try {
      const res = await axios.get(`${API_BASE}/contacts`, {
        params: { campaignId, search, status }
      });
      setContacts(res.data);
    } catch (err) {
      console.error('Error fetching contacts:', err);
    }
  };

  const fetchLogs = async (campaignId) => {
    try {
      const res = await axios.get(`${API_BASE}/logs`, { params: { campaignId } });
      setLogs(res.data);
      
      // Look for QR scan alert logs to notify the user
      const qrLog = res.data.find(log => log.level === 'warning' && log.message.includes('QR code'));
      if (qrLog) {
        setSystemAlert({
          type: 'warning',
          message: 'WhatsApp Web authentication required! Please scan the QR code in the browser window immediately.'
        });
      } else {
        setSystemAlert(null);
      }
    } catch (err) {
      console.error('Error fetching logs:', err);
    }
  };

  const handleControlAction = async (action, campaignId) => {
    if (!campaignId) return;
    try {
      const res = await axios.post(`${API_BASE}/automation/control`, {
        action,
        campaignId
      });
      setAutomationStatus(res.data);
      fetchCampaigns();
    } catch (err) {
      alert(`Control Action failed: ${err.response?.data?.error || err.message}`);
    }
  };

  const deleteCampaign = async (campaignId) => {
    if (!confirm('Are you sure you want to delete this campaign? All contacts and logs will be deleted.')) return;
    try {
      await axios.delete(`${API_BASE}/campaigns/${campaignId}`);
      if (selectedCampaignId === campaignId.toString()) {
        setSelectedCampaignId('');
      }
      fetchCampaigns();
    } catch (err) {
      alert(`Failed to delete campaign: ${err.message}`);
    }
  };

  const triggerRefresh = async () => {
    setIsRefreshing(true);
    await fetchCampaigns();
    await fetchAutomationStatus();
    if (selectedCampaignId) {
      await fetchContacts(selectedCampaignId);
      await fetchLogs(selectedCampaignId);
    }
    setTimeout(() => setIsRefreshing(false), 800);
  };

  const selectedCampaign = campaigns.find(c => c.id.toString() === selectedCampaignId);

  // Render Authentication Portal if not logged in
  if (!user || !token) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl">
          <div className="flex items-center justify-center gap-3 mb-6">
            <div className="w-12 h-12 bg-emerald-500 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-emerald-500/20">
              <Send size={26} className="rotate-45" />
            </div>
            <div>
              <h1 className="font-heading text-xl font-bold tracking-tight text-white">Whatsapp Automator</h1>
              <span className="text-xs text-emerald-400 font-semibold tracking-widest uppercase">Multi-Tenant SaaS Portal</span>
            </div>
          </div>

          <div className="flex bg-slate-950 p-1 rounded-xl mb-6 border border-slate-800">
            <button
              onClick={() => { setAuthMode('login'); setAuthError(''); }}
              className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all ${
                authMode === 'login' ? 'bg-emerald-500 text-white shadow-md' : 'text-slate-400 hover:text-white'
              }`}
            >
              Sign In
            </button>
            <button
              onClick={() => { setAuthMode('register'); setAuthError(''); }}
              className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all ${
                authMode === 'register' ? 'bg-emerald-500 text-white shadow-md' : 'text-slate-400 hover:text-white'
              }`}
            >
              Register Account
            </button>
          </div>

          {authError && (
            <div className="mb-4 p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400 text-xs font-medium flex items-center gap-2">
              <AlertTriangle size={16} />
              <span>{authError}</span>
            </div>
          )}

          <form onSubmit={handleAuthSubmit} className="space-y-4">
            {authMode === 'register' && (
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  placeholder="John Doe"
                  value={authFormData.name}
                  onChange={(e) => setAuthFormData({ ...authFormData, name: e.target.value })}
                  className="w-full px-4 py-3 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 focus:outline-none focus:border-emerald-500 transition-colors text-sm"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Email Address</label>
              <input
                type="email"
                required
                placeholder="name@company.com"
                value={authFormData.email}
                onChange={(e) => setAuthFormData({ ...authFormData, email: e.target.value })}
                className="w-full px-4 py-3 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 focus:outline-none focus:border-emerald-500 transition-colors text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Password</label>
              <input
                type="password"
                required
                placeholder="••••••••"
                value={authFormData.password}
                onChange={(e) => setAuthFormData({ ...authFormData, password: e.target.value })}
                className="w-full px-4 py-3 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 focus:outline-none focus:border-emerald-500 transition-colors text-sm"
              />
            </div>

            <button
              type="submit"
              className="w-full py-3 bg-emerald-500 hover:bg-emerald-600 font-semibold text-white rounded-xl shadow-lg shadow-emerald-500/20 transition-all text-sm mt-2"
            >
              {authMode === 'login' ? 'Sign In to Dashboard' : 'Create SaaS Account'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      {/* Sidebar Navigation */}
      <aside className="w-64 glass-panel border-r border-slate-800 flex flex-col justify-between p-6">
        <div>
          {/* Brand Header */}
          <div className="flex items-center gap-3 mb-10">
            <div className="w-10 h-10 bg-emerald-500 rounded-xl flex items-center justify-center text-white shadow-lg shadow-emerald-500/20">
              <Send size={22} className="rotate-45" />
            </div>
            <div>
              <h1 className="font-heading text-base font-bold tracking-tight text-white leading-tight">Whatsapp Automator Bot</h1>
              <span className="text-[10px] text-emerald-400 font-semibold tracking-widest uppercase">Automation Suite</span>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="space-y-1">
            <button 
              onClick={() => setActiveTab('dashboard')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 text-sm font-medium ${
                activeTab === 'dashboard' 
                  ? 'bg-slate-800 text-emerald-400 border border-slate-700/50' 
                  : 'text-slate-400 hover:bg-slate-900/50 hover:text-slate-200'
              }`}
            >
              <LayoutDashboard size={18} />
              Dashboard
            </button>
            <button 
              onClick={() => setActiveTab('session')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 text-sm font-medium ${
                activeTab === 'session' 
                  ? 'bg-slate-800 text-emerald-400 border border-slate-700/50' 
                  : 'text-slate-400 hover:bg-slate-900/50 hover:text-slate-200'
              }`}
            >
              <Smartphone size={18} />
              WhatsApp Account
            </button>
            <button 
              onClick={() => setActiveTab('audience')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 text-sm font-medium ${
                activeTab === 'audience' 
                  ? 'bg-slate-800 text-emerald-400 border border-slate-700/50' 
                  : 'text-slate-400 hover:bg-slate-900/50 hover:text-slate-200'
              }`}
            >
              <Users size={18} />
              Audience & Contacts
            </button>
            <button 
              onClick={() => setActiveTab('create')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 text-sm font-medium ${
                activeTab === 'create' 
                  ? 'bg-slate-800 text-emerald-400 border border-slate-700/50' 
                  : 'text-slate-400 hover:bg-slate-900/50 hover:text-slate-200'
              }`}
            >
              <Plus size={18} />
              Create Campaign
            </button>
            <button 
              onClick={() => setActiveTab('contacts')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 text-sm font-medium ${
                activeTab === 'contacts' 
                  ? 'bg-slate-800 text-emerald-400 border border-slate-700/50' 
                  : 'text-slate-400 hover:bg-slate-900/50 hover:text-slate-200'
              }`}
            >
              <Layers size={18} />
              Campaign Queue
            </button>
            <button 
              onClick={() => setActiveTab('logs')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 text-sm font-medium ${
                activeTab === 'logs' 
                  ? 'bg-slate-800 text-emerald-400 border border-slate-700/50' 
                  : 'text-slate-400 hover:bg-slate-900/50 hover:text-slate-200'
              }`}
            >
              <FileText size={18} />
              Live Logs
            </button>
            <button 
              onClick={() => setActiveTab('settings')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 text-sm font-medium ${
                activeTab === 'settings' 
                  ? 'bg-slate-800 text-emerald-400 border border-slate-700/50' 
                  : 'text-slate-400 hover:bg-slate-900/50 hover:text-slate-200'
              }`}
            >
              <SettingsIcon size={18} />
              Settings
            </button>
          </nav>
        </div>

        {/* User Account Profile & Session Profile */}
        <div className="space-y-3">
          <div className="p-4 bg-slate-900/60 border border-slate-800 rounded-xl space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 font-bold flex items-center justify-center text-xs">
                  {user?.name ? user.name.charAt(0).toUpperCase() : 'U'}
                </div>
                <div className="truncate max-w-[110px]">
                  <p className="text-xs font-bold text-slate-200 truncate">{user?.name}</p>
                  <p className="text-[10px] text-slate-400 truncate">{user?.email}</p>
                </div>
              </div>
              <button
                onClick={handleLogout}
                title="Sign Out"
                className="p-1.5 hover:bg-slate-800 text-slate-400 hover:text-rose-400 rounded-lg transition-colors"
              >
                <LogOut size={16} />
              </button>
            </div>
            <div className="flex items-center justify-between text-[11px] pt-2 border-t border-slate-800/60 text-slate-400">
              <span>Login Seats:</span>
              <span className="font-bold text-emerald-400">{user?.max_login_sessions || 1} Active Seat</span>
            </div>
          </div>

          <div className="p-3 bg-slate-900/40 border border-slate-800 rounded-xl">
            <div className="flex items-center gap-2 mb-1">
              <div className={`w-2.5 h-2.5 rounded-full ${automationStatus.status === 'Running' ? 'bg-emerald-500 animate-ping' : 'bg-slate-600'}`}></div>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Automation Mode</span>
            </div>
            <p className="text-xs font-medium text-slate-200">{automationStatus.status}</p>
          </div>
        </div>
      </aside>

      {/* Main Dashboard Container */}
      <main className="flex-1 flex flex-col min-w-0 overflow-y-auto bg-slate-950 p-8">
        {/* Header */}
        <header className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-white font-heading">
              {activeTab === 'dashboard' && 'Dashboard Overview'}
              {activeTab === 'session' && 'WhatsApp Account & Login'}
              {activeTab === 'audience' && 'Audience & Contact Hub'}
              {activeTab === 'create' && 'Initialize Campaign'}
              {activeTab === 'contacts' && 'Recipient Queue'}
              {activeTab === 'logs' && 'Campaign Logs & Audits'}
              {activeTab === 'settings' && 'System Parameters'}
            </h2>
            <p className="text-sm text-slate-400">
              {activeTab === 'dashboard' && 'Monitor and execute local messaging tasks.'}
              {activeTab === 'session' && 'Link and verify your WhatsApp account so campaigns run automatically.'}
              {activeTab === 'audience' && 'Central Address Book, Contact Groups, and Google Sheets Sync.'}
              {activeTab === 'create' && 'Select audience groups, live Google Sheets, or paste text to launch outreach.'}
              {activeTab === 'contacts' && 'Search, filter, and inspect pending message delivery states.'}
              {activeTab === 'logs' && 'Trace Playwright actions and WhatsApp interface states.'}
              {activeTab === 'settings' && 'Customize safety delays, browser profiles, and auth credentials.'}
            </p>
          </div>

          <div className="flex items-center gap-3">
            {campaigns.length > 0 && activeTab !== 'create' && activeTab !== 'settings' && (
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-slate-400">Active Campaign:</span>
                <select
                  value={selectedCampaignId}
                  onChange={(e) => handleCampaignChange(e.target.value)}
                  className="bg-slate-900 border border-slate-800 text-slate-100 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-emerald-500"
                >
                  <option value="">-- Select Campaign --</option>
                  {campaigns.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            )}

            <button 
              onClick={triggerRefresh}
              className={`p-2 rounded-lg bg-slate-900 border border-slate-800 hover:bg-slate-800 hover:text-slate-100 transition-colors text-slate-400 ${
                isRefreshing ? 'animate-spin text-emerald-400' : ''
              }`}
            >
              <RefreshCw size={18} />
            </button>
          </div>
        </header>

        {/* Global Warning Alert Dialog */}
        {systemAlert && (
          <div className="mb-8 p-4 bg-amber-500/10 border border-amber-500/35 rounded-xl flex flex-col sm:flex-row items-start sm:items-center gap-4 animate-pulse">
            <div className="flex items-center gap-3 flex-1">
              <AlertTriangle className="text-amber-500 shrink-0" size={24} />
              <div className="flex-1">
                <h4 className="text-sm font-bold text-amber-400 uppercase tracking-wide">Attention Required</h4>
                <p className="text-sm text-slate-200">{systemAlert.message}</p>
              </div>
            </div>
            {automationStatus.qrImageUrl && (
              <div className="mt-2 sm:mt-0 sm:ml-auto p-2 bg-white rounded-lg flex flex-col items-center shrink-0">
                <img 
                  src={`${API_BASE.replace('/api', '')}${automationStatus.qrImageUrl}?t=${Date.now()}`} 
                  alt="WhatsApp QR Code" 
                  className="w-40 h-40"
                />
                <span className="text-[10px] text-slate-800 font-bold mt-1">Scan to Login</span>
              </div>
            )}
          </div>
        )}

        {/* Tab Views Router */}
        <div className="flex-1">
          {activeTab === 'dashboard' && (
            <DashboardView 
              campaign={selectedCampaign}
              automationStatus={automationStatus}
              handleControl={handleControlAction}
              deleteCampaign={deleteCampaign}
              logs={logs}
              onNavigate={(tab) => setActiveTab(tab)}
            />
          )}

          {activeTab === 'audience' && (
            <AudienceHubView />
          )}

          {activeTab === 'create' && (
            <CreateCampaignView 
              onSuccess={() => {
                fetchCampaigns();
                setActiveTab('dashboard');
              }}
              settings={settings}
            />
          )}

          {activeTab === 'contacts' && (
            <ContactsView 
              campaignId={selectedCampaignId}
              contacts={contacts}
              onFilterChange={(search, status) => fetchContacts(selectedCampaignId, search, status)}
            />
          )}

          {activeTab === 'logs' && (
            <LogsView 
              campaign={selectedCampaign}
              logs={logs}
            />
          )}

          {activeTab === 'settings' && (
            <SettingsView 
              settings={settings}
              onSave={fetchSettings}
            />
          )}

          {activeTab === 'session' && (
            <WhatsAppSessionView 
              sessionData={sessionData}
              isConnecting={isConnectingSession}
              onConnect={handleConnectSession}
              onRefresh={fetchSessionData}
              onLogout={handleLogoutSession}
            />
          )}
        </div>
      </main>
    </div>
  );
}

// ============================================================================
// VIEW COMPONENT 1: DASHBOARD
// ============================================================================
function DashboardView({ campaign, automationStatus, handleControl, deleteCampaign, logs, onNavigate }) {
  if (!campaign) {
    return (
      <div className="glass-panel border border-dashed border-slate-800 rounded-2xl p-12 text-center">
        <FileSpreadsheet size={48} className="mx-auto text-slate-600 mb-4" />
        <h3 className="text-lg font-semibold text-slate-300 mb-1">No Active Campaigns</h3>
        <p className="text-sm text-slate-500 max-w-sm mx-auto mb-6">
          Import contacts from an Excel spreadsheet or link a Google Sheet to launch your first automation run.
        </p>
        <button 
          onClick={() => onNavigate && onNavigate('create')}
          className="btn-primary"
        >
          Create Campaign
        </button>
      </div>
    );
  }

  const { id, name, status, total_contacts, sent_count, failed_count, duration, created_at } = campaign;
  const pending_count = total_contacts - sent_count - failed_count;
  const progressPercent = total_contacts > 0 ? Math.round(((sent_count + failed_count) / total_contacts) * 100) : 0;
  
  // Format seconds to HH:MM:SS
  const formatTime = (secs) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return [h, m, s].map(v => v < 10 ? '0' + v : v).filter((v, i) => v !== '00' || i > 0).join(':');
  };

  const isCampaignRunning = automationStatus.status === 'Running' && automationStatus.currentCampaignId === id;
  const isCampaignPaused = automationStatus.status === 'Paused' && automationStatus.currentCampaignId === id;

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Metrics Row */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
        <div className="glass-card p-5 rounded-2xl">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Contacts</span>
          <div className="text-3xl font-heading font-extrabold text-white mt-2">{total_contacts}</div>
        </div>
        <div className="glass-card p-5 rounded-2xl">
          <span className="text-xs font-semibold text-amber-500/80 uppercase tracking-wider">Pending queue</span>
          <div className="text-3xl font-heading font-extrabold text-amber-400 mt-2">{pending_count}</div>
        </div>
        <div className="glass-card p-5 rounded-2xl">
          <span className="text-xs font-semibold text-emerald-500/80 uppercase tracking-wider">Sent Successfully</span>
          <div className="text-3xl font-heading font-extrabold text-emerald-400 mt-2">{sent_count}</div>
        </div>
        <div className="glass-card p-5 rounded-2xl">
          <span className="text-xs font-semibold text-rose-500/80 uppercase tracking-wider">Failed Deliveries</span>
          <div className="text-3xl font-heading font-extrabold text-rose-400 mt-2">{failed_count}</div>
        </div>
        <div className="glass-card p-5 rounded-2xl">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Elasped Duration</span>
          <div className="text-3xl font-heading font-extrabold text-slate-300 mt-2">{formatTime(duration)}</div>
        </div>
      </div>

      {/* Progress & Campaign Details */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Core Controls */}
        <div className="lg:col-span-2 glass-panel p-6 rounded-2xl flex flex-col justify-between gap-6">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <span className={`status-pill ${
                  status === 'Completed' ? 'status-sent' :
                  status === 'Sending' ? 'status-sending' :
                  status === 'Paused' ? 'status-pending' :
                  status === 'Stopped' ? 'status-failed' : 'status-pending'
                }`}>
                  {status}
                </span>
                <h3 className="text-xl font-bold text-white font-heading mt-2">{name}</h3>
              </div>

              <span className="text-xs text-slate-500">Created: {new Date(created_at).toLocaleDateString()}</span>
            </div>

            {/* Progress Bar */}
            <div className="space-y-2 mt-6">
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-400 font-medium">Campaign Send Progress</span>
                <span className="font-bold text-emerald-400">{progressPercent}%</span>
              </div>
              <div className="w-full h-3 bg-slate-900 rounded-full overflow-hidden border border-slate-800/80">
                <div 
                  className="h-full bg-emerald-500 rounded-full transition-all duration-500 shadow-md shadow-emerald-500/20"
                  style={{ width: `${progressPercent}%` }}
                ></div>
              </div>
            </div>
          </div>

          {/* Action Row Buttons */}
          <div className="flex flex-wrap items-center justify-between gap-4 pt-6 border-t border-slate-800">
            <div className="flex items-center gap-3">
              {/* Idle / Stopped -> Start */}
              {!isCampaignRunning && !isCampaignPaused && status !== 'Completed' && (
                <button 
                  onClick={() => handleControl('start', id)}
                  className="btn-primary px-6"
                >
                  <Play size={16} fill="currentColor" />
                  Start Campaign
                </button>
              )}

              {/* Running -> Pause */}
              {isCampaignRunning && (
                <button 
                  onClick={() => handleControl('pause', id)}
                  className="btn-warning px-6"
                >
                  <Pause size={16} fill="currentColor" />
                  Pause
                </button>
              )}

              {/* Paused -> Resume */}
              {isCampaignPaused && (
                <button 
                  onClick={() => handleControl('resume', id)}
                  className="btn-primary px-6"
                >
                  <Play size={16} fill="currentColor" />
                  Resume
                </button>
              )}

              {/* Running / Paused -> Stop */}
              {(isCampaignRunning || isCampaignPaused) && (
                <button 
                  onClick={() => handleControl('stop', id)}
                  className="btn-danger px-6"
                >
                  <Square size={16} fill="currentColor" />
                  Stop Campaign
                </button>
              )}
            </div>

            <button 
              onClick={() => deleteCampaign(id)}
              className="text-xs text-rose-400 hover:text-rose-300 font-medium px-3 py-1.5 rounded hover:bg-rose-500/10 border border-transparent hover:border-rose-500/25 transition-all"
            >
              Delete Campaign
            </button>
          </div>
        </div>

        {/* Fast Logs overview widget */}
        <div className="glass-panel p-6 rounded-2xl flex flex-col justify-between min-h-[300px]">
          <div>
            <h4 className="font-bold text-white text-sm uppercase tracking-wide mb-4">Live Execution Log</h4>
            <div className="space-y-3 max-h-[220px] overflow-y-auto pr-1">
              {logs.length === 0 ? (
                <p className="text-xs text-slate-500 italic">No logs recorded yet. Press Start to initialize.</p>
              ) : (
                logs.slice(0, 10).map(log => (
                  <div key={log.id} className="text-xs border-b border-slate-900 pb-2">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className={`w-1.5 h-1.5 rounded-full ${
                        log.level === 'error' ? 'bg-rose-500' :
                        log.level === 'warning' ? 'bg-amber-500' : 'bg-emerald-500'
                      }`}></span>
                      <span className="font-semibold text-slate-400">
                        {new Date(log.created_at).toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="text-slate-300 pl-3 leading-relaxed">{log.message}</p>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="pt-4 border-t border-slate-900 text-right">
            <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">Only shows latest 10 logs</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// VIEW COMPONENT 1.5: AUDIENCE HUB & CONTACT MANAGER
// ============================================================================
function AudienceHubView() {
  const [contacts, setContacts] = useState([]);
  const [tags, setTags] = useState([]);
  const [selectedTag, setSelectedTag] = useState('All');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);

  // Modals state
  const [showAddModal, setShowAddModal] = useState(false);
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [showSheetModal, setShowSheetModal] = useState(false);
  const [editingContact, setEditingContact] = useState(null);

  // Form states
  const [formData, setFormData] = useState({ name: '', phone: '', company: '', email: '', tag: 'General' });
  const [bulkText, setBulkText] = useState('');
  const [bulkTag, setBulkTag] = useState('General');
  const [sheetUrl, setSheetUrl] = useState('');
  const [sheetTag, setSheetTag] = useState('Google Sheets');
  const [actionError, setActionError] = useState(null);
  const [actionSuccess, setActionSuccess] = useState(null);

  useEffect(() => {
    fetchAudienceContacts();
    fetchTags();
  }, [selectedTag, search]);

  const fetchAudienceContacts = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API_BASE}/audience/contacts`, {
        params: { search, tag: selectedTag }
      });
      setContacts(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchTags = async () => {
    try {
      const res = await axios.get(`${API_BASE}/audience/tags`);
      setTags(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  const handleSaveSingle = async (e) => {
    e.preventDefault();
    setActionError(null);
    setActionSuccess(null);

    try {
      if (editingContact) {
        await axios.put(`${API_BASE}/audience/contacts/${editingContact.id}`, formData);
        setActionSuccess('Contact updated successfully.');
      } else {
        await axios.post(`${API_BASE}/audience/contacts`, formData);
        setActionSuccess('Contact added to Audience Hub.');
      }
      setShowAddModal(false);
      setEditingContact(null);
      setFormData({ name: '', phone: '', company: '', email: '', tag: 'General' });
      fetchAudienceContacts();
      fetchTags();
    } catch (err) {
      setActionError(err.response?.data?.error || err.message);
    }
  };

  const handleBulkSubmit = async (e) => {
    e.preventDefault();
    setActionError(null);
    if (!bulkText.trim()) return;

    try {
      const res = await axios.post(`${API_BASE}/audience/contacts`, {
        bulk_text: bulkText,
        tag: bulkTag
      });
      setActionSuccess(res.data.message);
      setShowBulkModal(false);
      setBulkText('');
      fetchAudienceContacts();
      fetchTags();
    } catch (err) {
      setActionError(err.response?.data?.error || err.message);
    }
  };

  const handleSheetImport = async (e) => {
    e.preventDefault();
    setActionError(null);
    if (!sheetUrl.trim()) return;

    try {
      const res = await axios.post(`${API_BASE}/audience/import-sheet`, {
        sheetUrl,
        tag: sheetTag
      });
      setActionSuccess(res.data.message);
      setShowSheetModal(false);
      setSheetUrl('');
      fetchAudienceContacts();
      fetchTags();
    } catch (err) {
      setActionError(err.response?.data?.error || err.message);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Are you sure you want to delete this contact?')) return;
    try {
      await axios.delete(`${API_BASE}/audience/contacts/${id}`);
      fetchAudienceContacts();
      fetchTags();
    } catch (err) {
      alert(err.message);
    }
  };

  const openEdit = (contact) => {
    setEditingContact(contact);
    setFormData({
      name: contact.name,
      phone: contact.phone,
      company: contact.company || '',
      email: contact.email || '',
      tag: contact.tag || 'General'
    });
    setShowAddModal(true);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Alert Banners */}
      {actionSuccess && (
        <div className="p-4 bg-emerald-500/10 border border-emerald-500/25 rounded-xl flex items-center justify-between text-emerald-400 text-sm">
          <div className="flex items-center gap-2">
            <CheckCircle size={18} />
            <span>{actionSuccess}</span>
          </div>
          <button onClick={() => setActionSuccess(null)} className="text-xs text-slate-400 hover:text-white">✕</button>
        </div>
      )}
      {actionError && (
        <div className="p-4 bg-rose-500/10 border border-rose-500/25 rounded-xl flex items-center justify-between text-rose-400 text-sm">
          <div className="flex items-center gap-2">
            <XCircle size={18} />
            <span>{actionError}</span>
          </div>
          <button onClick={() => setActionError(null)} className="text-xs text-slate-400 hover:text-white">✕</button>
        </div>
      )}

      {/* Action Header & Filter Controls */}
      <div className="glass-panel p-6 rounded-2xl flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
        {/* Search & Tag Filter */}
        <div className="flex flex-1 items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[220px]">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              placeholder="Search by name, phone, company..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full glass-input rounded-xl pl-9 pr-4 py-2.5 text-sm text-slate-200"
            />
          </div>

          <div className="flex items-center gap-2">
            <Tag size={16} className="text-slate-500" />
            <select
              value={selectedTag}
              onChange={(e) => setSelectedTag(e.target.value)}
              className="bg-slate-900 border border-slate-800 text-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
            >
              <option value="All">All Groups ({contacts.length})</option>
              {tags.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => { setEditingContact(null); setFormData({ name: '', phone: '', company: '', email: '', tag: 'General' }); setShowAddModal(true); }}
            className="btn-primary px-4 py-2.5 text-xs font-semibold"
          >
            <UserPlus size={16} />
            Add Contact
          </button>
          <button
            onClick={() => setShowBulkModal(true)}
            className="btn-secondary px-4 py-2.5 text-xs font-semibold"
          >
            <Clipboard size={16} />
            Quick Bulk Paste
          </button>
          <button
            onClick={() => setShowSheetModal(true)}
            className="px-4 py-2.5 text-xs font-semibold rounded-xl bg-emerald-950/60 hover:bg-emerald-900/80 text-emerald-400 border border-emerald-800/60 transition-colors flex items-center gap-2"
          >
            <Globe size={16} />
            Sync Google Sheet
          </button>
        </div>
      </div>

      {/* Audience Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="glass-card p-5 rounded-2xl">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">Total Saved Contacts</span>
          <span className="text-2xl font-bold font-heading text-white mt-1 block">{contacts.length}</span>
        </div>
        <div className="glass-card p-5 rounded-2xl">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">Audience Groups / Tags</span>
          <span className="text-2xl font-bold font-heading text-emerald-400 mt-1 block">{tags.length}</span>
        </div>
        <div className="glass-card p-5 rounded-2xl">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">Active Filter Tag</span>
          <span className="text-sm font-semibold text-slate-200 mt-2 block bg-slate-900 border border-slate-800 px-3 py-1 rounded-lg w-fit">
            {selectedTag}
          </span>
        </div>
      </div>

      {/* Contacts Table */}
      <div className="glass-panel rounded-2xl overflow-hidden">
        <div className="p-4 border-b border-slate-900 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wide">Audience Address Book</h3>
          <span className="text-xs text-slate-500">Showing {contacts.length} contacts</span>
        </div>

        {loading ? (
          <div className="p-12 text-center text-slate-500">
            <RefreshCw className="animate-spin mx-auto mb-2" size={24} />
            Loading contacts...
          </div>
        ) : contacts.length === 0 ? (
          <div className="p-12 text-center text-slate-500">
            <Users className="mx-auto mb-3 text-slate-600" size={36} />
            <p className="text-base font-semibold text-slate-300">No contacts saved in this view</p>
            <p className="text-xs mt-1">Add contacts manually, quick paste numbers, or sync a Google Sheet above.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-300">
              <thead className="bg-slate-900/60 text-slate-400 text-xs font-semibold uppercase border-b border-slate-900">
                <tr>
                  <th className="px-6 py-3.5">Name</th>
                  <th className="px-6 py-3.5">Phone</th>
                  <th className="px-6 py-3.5">Company</th>
                  <th className="px-6 py-3.5">Group / Tag</th>
                  <th className="px-6 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-900">
                {contacts.map((contact) => (
                  <tr key={contact.id} className="hover:bg-slate-900/40 transition-colors">
                    <td className="px-6 py-4 font-semibold text-slate-100">{contact.name}</td>
                    <td className="px-6 py-4 font-mono text-emerald-400">{contact.phone}</td>
                    <td className="px-6 py-4 text-slate-400">{contact.company || '—'}</td>
                    <td className="px-6 py-4">
                      <span className="text-xs px-2.5 py-1 rounded-md bg-slate-850 text-slate-300 border border-slate-800 font-medium">
                        {contact.tag || 'General'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => openEdit(contact)}
                          className="p-1.5 rounded text-slate-400 hover:text-emerald-400 hover:bg-slate-800 transition-colors"
                          title="Edit Contact"
                        >
                          <Edit3 size={15} />
                        </button>
                        <button
                          onClick={() => handleDelete(contact.id)}
                          className="p-1.5 rounded text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition-colors"
                          title="Delete Contact"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal 1: Add / Edit Single Contact */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="glass-panel p-6 rounded-2xl max-w-md w-full animate-slide-up space-y-4">
            <h3 className="text-lg font-bold text-white font-heading">
              {editingContact ? 'Edit Contact' : 'Add New Contact'}
            </h3>
            <form onSubmit={handleSaveSingle} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">Full Name *</label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g. John Doe"
                  className="w-full glass-input rounded-xl px-3.5 py-2.5 text-sm text-slate-200"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">Phone Number (with Country Code) *</label>
                <input
                  type="text"
                  required
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  placeholder="e.g. +919876543210"
                  className="w-full glass-input rounded-xl px-3.5 py-2.5 text-sm text-slate-200"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">Company / Organization</label>
                <input
                  type="text"
                  value={formData.company}
                  onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                  placeholder="e.g. Acme Corp"
                  className="w-full glass-input rounded-xl px-3.5 py-2.5 text-sm text-slate-200"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">Audience Group / Tag</label>
                <input
                  type="text"
                  value={formData.tag}
                  onChange={(e) => setFormData({ ...formData, tag: e.target.value })}
                  placeholder="e.g. VIP, Leads, Clients"
                  className="w-full glass-input rounded-xl px-3.5 py-2.5 text-sm text-slate-200"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-900">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary px-5 py-2 text-xs">
                  Save Contact
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 2: Bulk Paste Numbers / CSV */}
      {showBulkModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="glass-panel p-6 rounded-2xl max-w-lg w-full animate-slide-up space-y-4">
            <h3 className="text-lg font-bold text-white font-heading">Quick Bulk Paste</h3>
            <p className="text-xs text-slate-400">
              Paste phone numbers (one per line) or CSV formatted data (Name, Phone, Company).
            </p>

            <form onSubmit={handleBulkSubmit} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">Target Group Tag</label>
                <input
                  type="text"
                  value={bulkTag}
                  onChange={(e) => setBulkTag(e.target.value)}
                  placeholder="e.g. Batch 1"
                  className="w-full glass-input rounded-xl px-3.5 py-2 text-sm text-slate-200"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">Paste Numbers or CSV</label>
                <textarea
                  rows={6}
                  required
                  placeholder={`+919876543210\n+919876543211\nAlice, 9876543212, Tech Corp`}
                  value={bulkText}
                  onChange={(e) => setBulkText(e.target.value)}
                  className="w-full glass-input rounded-xl p-3 text-xs font-mono text-slate-200"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-900">
                <button
                  type="button"
                  onClick={() => setShowBulkModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary px-5 py-2 text-xs">
                  Import Numbers
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 3: Sync Google Sheet */}
      {showSheetModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="glass-panel p-6 rounded-2xl max-w-lg w-full animate-slide-up space-y-4">
            <h3 className="text-lg font-bold text-white font-heading">Import from Google Sheet</h3>
            <p className="text-xs text-slate-400">
              Fetch contacts from a Google Sheet shared as &quot;Anyone with the link can view&quot;.
            </p>

            <form onSubmit={handleSheetImport} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">Google Sheet URL</label>
                <input
                  type="url"
                  required
                  placeholder="https://docs.google.com/spreadsheets/d/.../edit"
                  value={sheetUrl}
                  onChange={(e) => setSheetUrl(e.target.value)}
                  className="w-full glass-input rounded-xl px-3.5 py-2.5 text-sm text-slate-200"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">Assign Group / Tag</label>
                <input
                  type="text"
                  value={sheetTag}
                  onChange={(e) => setSheetTag(e.target.value)}
                  placeholder="e.g. Google Sheet Import"
                  className="w-full glass-input rounded-xl px-3.5 py-2 text-sm text-slate-200"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-900">
                <button
                  type="button"
                  onClick={() => setShowSheetModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary px-5 py-2 text-xs">
                  Import Contacts
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// VIEW COMPONENT 2: CREATE CAMPAIGN
// ============================================================================
function CreateCampaignView({ onSuccess, settings }) {
  const [name, setName] = useState('');
  const [template, setTemplate] = useState('');
  const [source, setSource] = useState('group'); // group, all_saved, sheet, raw_text, file
  const [selectedTag, setSelectedTag] = useState('');
  const [tags, setTags] = useState([]);
  const [sheetUrl, setSheetUrl] = useState('');
  const [rawText, setRawText] = useState('');
  const [attachmentPath, setAttachmentPath] = useState('');
  const [attachmentFiles, setAttachmentFiles] = useState([]);
  const [file, setFile] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);

  useEffect(() => {
    if (settings.google_sheet_url) {
      setSheetUrl(settings.google_sheet_url);
    }
    fetchTags();
  }, [settings]);

  const fetchTags = async () => {
    try {
      const res = await axios.get(`${API_BASE}/audience/tags`);
      setTags(res.data);
      if (res.data.length > 0) setSelectedTag(res.data[0]);
    } catch (err) {
      console.error(err);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError(null);

    if (!name.trim()) return setFormError('Campaign name is required.');
    if (source === 'group' && !selectedTag) return setFormError('Please select an Audience Tag / Group.');
    if (source === 'sheet' && !sheetUrl.trim()) return setFormError('Please enter your Google Sheets shared URL.');
    if (source === 'raw_text' && !rawText.trim()) return setFormError('Please enter phone numbers or CSV text.');
    if (source === 'file' && !file) return setFormError('Please select a file to import.');

    setIsSubmitting(true);

    const formData = new FormData();
    formData.append('name', name);
    formData.append('template', template);
    formData.append('source', source);
    formData.append('attachmentPath', attachmentPath);

    if (attachmentFiles && attachmentFiles.length > 0) {
      Array.from(attachmentFiles).forEach(f => formData.append('attachments', f));
    }

    if (source === 'group') formData.append('tag', selectedTag);
    if (source === 'sheet') formData.append('sheetUrl', sheetUrl);
    if (source === 'raw_text') formData.append('rawText', rawText);
    if (source === 'file') formData.append('file', file);

    try {
      await axios.post(`${API_BASE}/campaigns`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      onSuccess();
    } catch (err) {
      console.error(err);
      setFormError(err.response?.data?.error || 'An error occurred while building the campaign.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const insertPlaceholder = (ph) => {
    setTemplate(prev => prev + ` {{${ph}}}`);
  };

  return (
    <div className="max-w-3xl glass-panel p-8 rounded-2xl animate-slide-up">
      <form onSubmit={handleSubmit} className="space-y-6">
        {formError && (
          <div className="p-4 bg-rose-500/10 border border-rose-500/25 rounded-xl flex items-center gap-3 text-rose-400 text-sm">
            <XCircle size={18} />
            <span>{formError}</span>
          </div>
        )}

        {/* Campaign Name */}
        <div className="space-y-1.5">
          <label className="text-sm font-semibold text-slate-300">Campaign Name</label>
          <input
            type="text"
            required
            placeholder="e.g. July 2026 Promotional Campaign"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full glass-input rounded-xl px-4 py-3 text-slate-200 text-sm"
          />
        </div>

        {/* Audience Source Selector Cards */}
        <div className="space-y-3">
          <label className="text-sm font-semibold text-slate-300 block">Select Target Audience Source</label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <button
              type="button"
              onClick={() => setSource('group')}
              className={`p-3.5 rounded-xl border text-center transition-all duration-200 ${
                source === 'group'
                  ? 'bg-slate-800 border-emerald-500 text-emerald-400 shadow-md'
                  : 'bg-slate-900/40 border-slate-800 text-slate-400 hover:bg-slate-900 hover:text-slate-200'
              }`}
            >
              <Tag size={20} className="mx-auto mb-1.5" />
              <span className="text-xs font-semibold block">Saved Group</span>
            </button>

            <button
              type="button"
              onClick={() => setSource('all_saved')}
              className={`p-3.5 rounded-xl border text-center transition-all duration-200 ${
                source === 'all_saved'
                  ? 'bg-slate-800 border-emerald-500 text-emerald-400 shadow-md'
                  : 'bg-slate-900/40 border-slate-800 text-slate-400 hover:bg-slate-900 hover:text-slate-200'
              }`}
            >
              <Users size={20} className="mx-auto mb-1.5" />
              <span className="text-xs font-semibold block">All Contacts</span>
            </button>

            <button
              type="button"
              onClick={() => setSource('sheet')}
              className={`p-3.5 rounded-xl border text-center transition-all duration-200 ${
                source === 'sheet'
                  ? 'bg-slate-800 border-emerald-500 text-emerald-400 shadow-md'
                  : 'bg-slate-900/40 border-slate-800 text-slate-400 hover:bg-slate-900 hover:text-slate-200'
              }`}
            >
              <FileSpreadsheet size={20} className="mx-auto mb-1.5" />
              <span className="text-xs font-semibold block">Google Sheet</span>
            </button>

            <button
              type="button"
              onClick={() => setSource('raw_text')}
              className={`p-3.5 rounded-xl border text-center transition-all duration-200 ${
                source === 'raw_text'
                  ? 'bg-slate-800 border-emerald-500 text-emerald-400 shadow-md'
                  : 'bg-slate-900/40 border-slate-800 text-slate-400 hover:bg-slate-900 hover:text-slate-200'
              }`}
            >
              <Clipboard size={20} className="mx-auto mb-1.5" />
              <span className="text-xs font-semibold block">Quick Paste</span>
            </button>
          </div>
        </div>

        {/* Dynamic Source Inputs */}
        {source === 'group' && (
          <div className="space-y-1.5">
            <label className="text-sm font-semibold text-slate-300">Select Contact Tag / Group</label>
            {tags.length === 0 ? (
              <p className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 p-3 rounded-xl">
                No contact groups created yet. Please create contacts in the Audience & Contacts Hub or choose another source.
              </p>
            ) : (
              <select
                value={selectedTag}
                onChange={(e) => setSelectedTag(e.target.value)}
                className="w-full glass-input rounded-xl px-4 py-3 text-slate-200 text-sm"
              >
                {tags.map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            )}
          </div>
        )}

        {source === 'all_saved' && (
          <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400 text-xs">
            This campaign will target all active contacts saved in your Audience Address Book.
          </div>
        )}

        {source === 'sheet' && (
          <div className="space-y-1.5">
            <label className="text-sm font-semibold text-slate-300">Google Sheets Shared URL</label>
            <input
              type="url"
              required
              placeholder="https://docs.google.com/spreadsheets/d/.../edit"
              value={sheetUrl}
              onChange={(e) => setSheetUrl(e.target.value)}
              className="w-full glass-input rounded-xl px-4 py-3 text-slate-200 text-sm"
            />
            <span className="text-[10px] text-slate-500">Spreadsheet must be shared as &quot;Anyone with link can view&quot;.</span>
          </div>
        )}

        {source === 'raw_text' && (
          <div className="space-y-1.5">
            <label className="text-sm font-semibold text-slate-300">Paste Phone Numbers or CSV Block</label>
            <textarea
              rows={5}
              required
              placeholder={`+919876543210\n+919876543211\nAlice, 9876543212`}
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              className="w-full glass-input rounded-xl p-3 text-xs font-mono text-slate-200"
            />
          </div>
        )}

        {/* Message Template Editor */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-sm font-semibold text-slate-300">Message Template</label>
            <div className="flex gap-2">
              <button 
                type="button" 
                onClick={() => insertPlaceholder('Name')}
                className="text-[10px] bg-slate-850 hover:bg-slate-800 border border-slate-800 text-slate-300 font-semibold px-2 py-1 rounded"
              >
                + Name
              </button>
              <button 
                type="button" 
                onClick={() => insertPlaceholder('Company')}
                className="text-[10px] bg-slate-850 hover:bg-slate-800 border border-slate-800 text-slate-300 font-semibold px-2 py-1 rounded"
              >
                + Company
              </button>
            </div>
          </div>
          <textarea
            rows={5}
            placeholder="Hello {{Name}}, thank you for choosing {{Company}}..."
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            className="w-full glass-input rounded-xl p-4 text-slate-200 text-sm font-sans leading-relaxed"
          />
          <span className="text-[10px] text-slate-500 block">Use double braces like &#123;&#123;Name&#125;&#125; or &#123;&#123;Company&#125;&#125; for automatic recipient variable replacement.</span>
        </div>

        {/* Optional Multiple Attachments */}
        <div className="space-y-3 p-4 bg-slate-900/40 border border-slate-800 rounded-xl">
          <label className="text-sm font-semibold text-slate-300 block">Campaign Attachments (Multiple Images, Videos, or PDFs)</label>

          <div className="space-y-2">
            <span className="text-xs text-slate-400 font-medium block">Option A: Upload Multiple Files from Device</span>
            <input
              type="file"
              multiple
              accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx"
              onChange={(e) => setAttachmentFiles(e.target.files)}
              className="w-full text-xs text-slate-400 file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-emerald-500/20 file:text-emerald-400 hover:file:bg-emerald-500/30 cursor-pointer"
            />
            {attachmentFiles && attachmentFiles.length > 0 && (
              <p className="text-xs text-emerald-400 font-semibold">
                ✓ {attachmentFiles.length} file(s) selected: {Array.from(attachmentFiles).map(f => f.name).join(', ')}
              </p>
            )}
          </div>

          <div className="space-y-1.5 pt-2 border-t border-slate-800/60">
            <span className="text-xs text-slate-400 font-medium block">Option B: Or Enter Comma-Separated Filenames / Paths</span>
            <input
              type="text"
              placeholder="e.g. catalog.pdf, promo.jpg, video.mp4"
              value={attachmentPath}
              onChange={(e) => setAttachmentPath(e.target.value)}
              className="w-full glass-input rounded-xl px-4 py-2.5 text-slate-200 text-xs font-mono"
            />
            <span className="text-[10px] text-slate-500 block">Separate multiple file names or relative paths in the attachments folder using commas.</span>
          </div>
        </div>

        {template.trim() && (
          <div className="p-4 bg-emerald-950/30 border border-emerald-500/20 rounded-xl space-y-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-400 block">Live Sample Preview</span>
            <p className="text-xs text-slate-300 whitespace-pre-wrap font-sans">
              {template
                .replace(/{{\s*name\s*}}/gi, 'John Doe')
                .replace(/{{\s*company\s*}}/gi, 'Acme Corp')
                .replace(/{{\s*phone\s*}}/gi, '+919876543210')}
            </p>
          </div>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={isSubmitting}
          className="btn-primary w-full py-3.5"
        >
          {isSubmitting ? (
            <>
              <RefreshCw className="animate-spin" size={18} />
              Creating Campaign...
            </>
          ) : (
            <>
              <Send size={18} />
              Initialize Campaign
            </>
          )}
        </button>
      </form>
    </div>
  );
}

// ============================================================================
// VIEW COMPONENT 3: CONTACTS QUEUE
// ============================================================================
function ContactsView({ campaignId, contacts, onFilterChange }) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');

  // Handle updates in filter state
  useEffect(() => {
    onFilterChange(search, status);
  }, [search, status, campaignId]);

  if (!campaignId) {
    return (
      <div className="glass-panel p-8 text-center text-slate-500 rounded-2xl italic">
        Select a campaign from the header dropdown to view the recipient queue list.
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Filters Search Bar */}
      <div className="flex flex-col sm:flex-row gap-4 justify-between bg-slate-900/40 p-4 border border-slate-900 rounded-xl">
        <div className="flex-1 relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
          <input
            type="text"
            placeholder="Search by Name, Phone Number, or Company..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full glass-input rounded-lg pl-10 pr-4 py-2 text-sm text-slate-200"
          />
        </div>

        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="bg-slate-900 border border-slate-800 text-slate-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-emerald-500"
        >
          <option value="">All Statuses</option>
          <option value="Pending">Pending</option>
          <option value="Sending">Sending</option>
          <option value="Sent">Sent</option>
          <option value="Failed">Failed</option>
          <option value="Skipped">Skipped</option>
        </select>
      </div>

      {/* Recipient Queue Table */}
      <div className="glass-panel rounded-2xl overflow-hidden border border-slate-900">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-900/50 border-b border-slate-850 text-xs font-semibold uppercase tracking-wider text-slate-400">
                <th className="px-6 py-4">Name</th>
                <th className="px-6 py-4">Phone</th>
                <th className="px-6 py-4">Company</th>
                <th className="px-6 py-4">Attachment</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">Details / Errors</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-900/60 text-sm">
              {contacts.length === 0 ? (
                <tr>
                  <td colSpan="6" className="px-6 py-8 text-center text-slate-500 italic">
                    No matching recipients found in the queue.
                  </td>
                </tr>
              ) : (
                contacts.map(c => (
                  <tr key={c.id} className="hover:bg-slate-900/20 text-slate-300 transition-colors">
                    <td className="px-6 py-3.5 font-medium text-slate-200">{c.name}</td>
                    <td className="px-6 py-3.5 font-mono text-slate-300">{c.phone}</td>
                    <td className="px-6 py-3.5">{c.company || <span className="text-slate-600">-</span>}</td>
                    <td className="px-6 py-3.5 font-mono text-xs max-w-[120px] truncate">
                      {c.attachment_path ? c.attachment_path : <span className="text-slate-600">None</span>}
                    </td>
                    <td className="px-6 py-3.5">
                      <span className={`status-pill ${
                        c.status === 'Sent' ? 'status-sent' :
                        c.status === 'Failed' ? 'status-failed' :
                        c.status === 'Sending' ? 'status-sending' :
                        c.status === 'Skipped' ? 'status-skipped' : 'status-pending'
                      }`}>
                        {c.status}
                      </span>
                    </td>
                    <td className="px-6 py-3.5 text-xs">
                      {c.status === 'Failed' && (
                        <span className="text-rose-400 font-medium flex items-center gap-1.5">
                          <AlertTriangle size={12} />
                          {c.error_reason}
                        </span>
                      )}
                      {c.status === 'Sent' && (
                        <span className="text-slate-500 font-mono">
                          {c.sent_at ? new Date(c.sent_at).toLocaleTimeString() : ''}
                        </span>
                      )}
                      {c.status === 'Pending' && <span className="text-slate-500 italic">In Queue</span>}
                      {c.status === 'Sending' && <span className="text-blue-400 italic">Active sending session...</span>}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// VIEW COMPONENT 4: LIVE LOGS
// ============================================================================
function LogsView({ campaign, logs }) {
  if (!campaign) {
    return (
      <div className="glass-panel p-8 text-center text-slate-500 rounded-2xl italic">
        Select a campaign from the header dropdown to view audit and automation logs.
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in max-w-4xl">
      <div className="glass-panel rounded-2xl p-6">
        <div className="flex items-center justify-between mb-4 border-b border-slate-900 pb-3">
          <h3 className="font-bold text-white text-sm uppercase tracking-wide flex items-center gap-2">
            <Clock size={16} />
            Audit Trace for: {campaign.name}
          </h3>
          <span className="text-xs text-slate-500">Showing last 200 execution logs</span>
        </div>

        <div className="font-mono text-xs space-y-2 bg-slate-950 p-4 border border-slate-900 rounded-xl max-h-[500px] overflow-y-auto">
          {logs.length === 0 ? (
            <p className="text-slate-600 italic">No execution trace recorded yet.</p>
          ) : (
            logs.map(log => (
              <div key={log.id} className="py-1 border-b border-slate-900/40 last:border-0 leading-relaxed flex items-start gap-4">
                <span className="text-slate-600 shrink-0 select-none">
                  [{new Date(log.created_at).toLocaleTimeString()}]
                </span>
                <span className={`shrink-0 uppercase font-bold tracking-wider text-[10px] px-1.5 py-0.5 rounded ${
                  log.level === 'error' ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20' :
                  log.level === 'warning' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 
                  'bg-slate-800 text-slate-400'
                }`}>
                  {log.level}
                </span>
                <p className="text-slate-300 flex-1">{log.message}</p>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// VIEW COMPONENT 5: SETTINGS
// ============================================================================
function SettingsView({ settings, onSave }) {
  const [delay, setDelay] = useState('5');
  const [maxRetries, setMaxRetries] = useState('2');
  const [defaultCountryCode, setDefaultCountryCode] = useState('91');
  const [headless, setHeadless] = useState(false);
  const [attachmentsDir, setAttachmentsDir] = useState('');
  const [enableNotifications, setEnableNotifications] = useState(true);
  const [keepBrowserOpen, setKeepBrowserOpen] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState(null);

  // Sync settings when loaded
  useEffect(() => {
    if (settings.delay_seconds) setDelay(settings.delay_seconds);
    if (settings.max_retries) setMaxRetries(settings.max_retries);
    if (settings.default_country_code) setDefaultCountryCode(settings.default_country_code);
    if (settings.headless !== undefined) setHeadless(settings.headless === 'true');
    if (settings.default_attachments_dir) setAttachmentsDir(settings.default_attachments_dir);
    if (settings.enable_notifications) setEnableNotifications(settings.enable_notifications === 'true');
    if (settings.keep_browser_open_after_campaign !== undefined) setKeepBrowserOpen(settings.keep_browser_open_after_campaign === 'true');
  }, [settings]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSaving(true);
    setStatusMessage(null);

    try {
      await axios.post(`${API_BASE}/settings`, {
        delay_seconds: delay,
        max_retries: maxRetries,
        default_country_code: defaultCountryCode,
        headless: headless ? 'true' : 'false',
        default_attachments_dir: attachmentsDir,
        enable_notifications: enableNotifications ? 'true' : 'false',
        keep_browser_open_after_campaign: keepBrowserOpen ? 'true' : 'false'
      });
      onSave();
      setStatusMessage({ type: 'success', text: 'Configuration saved successfully.' });
    } catch (error) {
      console.error(error);
      setStatusMessage({ type: 'error', text: `Failed to save settings: ${error.message}` });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="max-w-2xl glass-panel p-8 rounded-2xl animate-fade-in">
      <form onSubmit={handleSubmit} className="space-y-6">
        {statusMessage && (
          <div className={`p-4 border rounded-xl flex items-center gap-3 text-sm ${
            statusMessage.type === 'success' 
              ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400' 
              : 'bg-rose-500/10 border-rose-500/25 text-rose-400'
          }`}>
            {statusMessage.type === 'success' ? <CheckCircle size={18} /> : <XCircle size={18} />}
            <span>{statusMessage.text}</span>
          </div>
        )}

        <h3 className="text-lg font-bold border-b border-slate-900 pb-3 text-white flex items-center gap-2 mb-6">
          <Sliders className="text-emerald-400" size={18} />
          Campaign Dispatch Properties
        </h3>

        {/* Delay Selection */}
        <div className="space-y-1.5">
          <label className="text-sm font-semibold text-slate-300">Message Interstitial Delay (Seconds)</label>
          <input
            type="number"
            min="1"
            max="120"
            required
            value={delay}
            onChange={(e) => setDelay(e.target.value)}
            className="w-full glass-input rounded-xl px-4 py-3 text-slate-200 text-sm"
          />
          <span className="text-[10px] text-slate-500 block">Delay pause length between processing each recipient list index to reduce risk of WhatsApp anti-spam triggers.</span>
        </div>

        {/* Default Country Code */}
        <div className="space-y-1.5">
          <label className="text-sm font-semibold text-slate-300">Default Country Code (e.g. 91 for India)</label>
          <input
            type="text"
            required
            placeholder="e.g. 91"
            value={defaultCountryCode}
            onChange={(e) => setDefaultCountryCode(e.target.value)}
            className="w-full glass-input rounded-xl px-4 py-3 text-slate-200 text-sm"
          />
          <span className="text-[10px] text-slate-500 block">Automatically prepended to 10-digit phone numbers in spreadsheets missing country code prefixes.</span>
        </div>

        {/* Max Retries */}
        <div className="space-y-1.5">
          <label className="text-sm font-semibold text-slate-300">Automation Retry Limit</label>
          <input
            type="number"
            min="0"
            max="5"
            required
            value={maxRetries}
            onChange={(e) => setMaxRetries(e.target.value)}
            className="w-full glass-input rounded-xl px-4 py-3 text-slate-200 text-sm"
          />
          <span className="text-[10px] text-slate-500 block">Number of attempts to re-attach files or resolve loading selectors before registering contact failed.</span>
        </div>

        {/* Default Attachment Folder */}
        <div className="space-y-1.5">
          <label className="text-sm font-semibold text-slate-300 flex items-center gap-2">
            Default Attachments Directory Folder
          </label>
          <input
            type="text"
            required
            value={attachmentsDir}
            onChange={(e) => setAttachmentsDir(e.target.value)}
            className="w-full glass-input rounded-xl px-4 py-3 text-slate-200 text-sm font-mono"
          />
          <span className="text-[10px] text-slate-500 block">Local filesystem directory folder where documents, PDFs, or images are located.</span>
        </div>

        {/* Keep Browser Open checkbox */}
        <div className="flex items-center gap-3 bg-slate-900/35 border border-slate-900 rounded-xl p-4">
          <input
            id="keepBrowserOpenMode"
            type="checkbox"
            checked={keepBrowserOpen}
            onChange={(e) => setKeepBrowserOpen(e.target.checked)}
            className="w-4 h-4 text-emerald-600 bg-slate-900 border-slate-800 rounded focus:ring-emerald-500 focus:ring-2 focus:ring-offset-slate-950"
          />
          <div>
            <label htmlFor="keepBrowserOpenMode" className="text-sm font-semibold text-slate-200 block cursor-pointer">Keep WhatsApp Window Open After Campaign Completes</label>
            <span className="text-[10px] text-slate-500">Leaves the WhatsApp Web browser window open when all messages finish so you can inspect chat delivery or close it manually.</span>
          </div>
        </div>

        {/* Headless Browser checkbox */}
        <div className="flex items-center gap-3 bg-slate-900/35 border border-slate-900 rounded-xl p-4">
          <input
            id="headlessMode"
            type="checkbox"
            checked={headless}
            onChange={(e) => setHeadless(e.target.checked)}
            className="w-4 h-4 text-emerald-600 bg-slate-900 border-slate-800 rounded focus:ring-emerald-500 focus:ring-2 focus:ring-offset-slate-950"
          />
          <div>
            <label htmlFor="headlessMode" className="text-sm font-semibold text-slate-200 block cursor-pointer">Run Browser in Headless Mode</label>
            <span className="text-[10px] text-slate-500">Executes Playwright browser in background without visible window (requires existing authenticated session).</span>
          </div>
        </div>

        {/* Notification checkbox */}
        <div className="flex items-center gap-3 bg-slate-900/35 border border-slate-900 rounded-xl p-4">
          <input
            id="notify"
            type="checkbox"
            checked={enableNotifications}
            onChange={(e) => setEnableNotifications(e.target.checked)}
            className="w-4 h-4 text-emerald-600 bg-slate-900 border-slate-800 rounded focus:ring-emerald-500 focus:ring-2 focus:ring-offset-slate-950"
          />
          <div>
            <label htmlFor="notify" className="text-sm font-semibold text-slate-200 block cursor-pointer">Enable Audio & Scan Alerts</label>
            <span className="text-[10px] text-slate-500">Triggers visual alerts in UI logs when WhatsApp session authentication triggers QR codes.</span>
          </div>
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={isSaving}
          className="btn-primary w-full py-3"
        >
          {isSaving ? (
            <>
              <RefreshCw className="animate-spin" size={16} />
              Saving settings...
            </>
          ) : (
            <>
              <CheckCircle size={16} />
              Save System Parameters
            </>
          )}
        </button>
      </form>
    </div>
  );
}

// ============================================================================
// VIEW COMPONENT 6: WHATSAPP ACCOUNT / SESSION LOGIN
// ============================================================================
function WhatsAppSessionView({ sessionData, isConnecting, onConnect, onRefresh, onLogout }) {
  const [quota, setQuota] = useState({ max_login_sessions: 1, active_sessions: 0, available_seats: 1 });
  const [sessions, setSessions] = useState([]);
  const [isUpgrading, setIsUpgrading] = useState(false);
  const [upgradeMsg, setUpgradeMsg] = useState('');
  const [newSessionName, setNewSessionName] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);

  const fetchQuota = async () => {
    try {
      const res = await axios.get(`${API_BASE}/user/quota`);
      setQuota(res.data);
    } catch (err) {
      console.error('Failed to fetch quota:', err);
    }
  };

  const fetchSessions = async () => {
    try {
      const res = await axios.get(`${API_BASE}/automation/sessions`);
      setSessions(res.data);
    } catch (err) {
      console.error('Failed to fetch sessions:', err);
    }
  };

  useEffect(() => {
    fetchQuota();
    fetchSessions();
  }, [sessionData]);

  const loadRazorpayScript = () => {
    return new Promise((resolve) => {
      if (window.Razorpay) return resolve(true);
      const script = document.createElement('script');
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      document.body.appendChild(script);
    });
  };

  const handleUpgradeSeats = async () => {
    setIsUpgrading(true);
    setUpgradeMsg('');
    try {
      const isLoaded = await loadRazorpayScript();
      const orderRes = await axios.post(`${API_BASE}/billing/razorpay-order`, { additionalSeats: 1 });
      const order = orderRes.data;

      if (order.mock || !isLoaded || !window.Razorpay) {
        // Direct mock verification in dev mode
        const verifyRes = await axios.post(`${API_BASE}/billing/razorpay-verify`, {
          razorpay_order_id: order.orderId,
          razorpay_payment_id: `pay_mock_${Date.now()}`,
          razorpay_signature: 'mock_signature',
          additionalSeats: 1
        });
        setUpgradeMsg(verifyRes.data.message || 'Razorpay Checkout (Test Mode): Added +1 Login Seat!');
        await fetchQuota();
        setTimeout(() => setUpgradeMsg(''), 4000);
        return;
      }

      const options = {
        key: order.key,
        amount: order.amount,
        currency: order.currency,
        name: 'WhatsApp Automator SaaS',
        description: 'Additional WhatsApp Login ID Seat License (₹999/mo)',
        order_id: order.orderId,
        prefill: {
          name: order.user?.name || '',
          email: order.user?.email || ''
        },
        theme: { color: '#10b981' },
        handler: async (response) => {
          try {
            const verifyRes = await axios.post(`${API_BASE}/billing/razorpay-verify`, {
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
              additionalSeats: 1
            });
            setUpgradeMsg(verifyRes.data.message || 'Razorpay Payment Verified! Seat Added.');
            await fetchQuota();
            setTimeout(() => setUpgradeMsg(''), 4000);
          } catch (err) {
            alert(`Payment verification failed: ${err.response?.data?.error || err.message}`);
          }
        }
      };

      const rzp = new window.Razorpay(options);
      rzp.open();
    } catch (err) {
      alert(`Razorpay checkout failed: ${err.response?.data?.error || err.message}`);
    } finally {
      setIsUpgrading(false);
    }
  };

  const handleCreateSession = async (e) => {
    e.preventDefault();
    try {
      await axios.post(`${API_BASE}/automation/sessions/create`, { session_name: newSessionName });
      setNewSessionName('');
      setShowCreateModal(false);
      await fetchQuota();
      await fetchSessions();
    } catch (err) {
      alert(err.response?.data?.error || err.message);
    }
  };

  const handleDeleteSession = async (id) => {
    if (!confirm('Are you sure you want to delete this WhatsApp account profile?')) return;
    try {
      await axios.delete(`${API_BASE}/automation/sessions/${id}`);
      await fetchSessions();
    } catch (err) {
      alert(err.response?.data?.error || err.message);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Seat Quota & Licensing Card */}
      <div className="glass-panel border border-emerald-500/30 rounded-2xl p-6 bg-gradient-to-r from-slate-900 via-slate-900 to-emerald-950/30">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="flex items-start gap-4">
            <div className="p-3.5 rounded-2xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <ShieldCheck size={28} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-bold text-white font-heading">Subscription & Login Seats</h3>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  {quota.active_sessions} / {quota.max_login_sessions} Seat(s) Occupied
                </span>
              </div>
              <p className="text-sm text-slate-400 mt-1">
                Per-login seat limit based on your commercial subscription plan. Each seat allows one concurrent active WhatsApp session.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-2 px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl font-medium text-sm transition-all border border-slate-700"
            >
              <Plus size={16} />
              Add WhatsApp Profile
            </button>
            <button
              onClick={handleUpgradeSeats}
              disabled={isUpgrading}
              className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white rounded-xl font-semibold text-sm transition-all shadow-lg shadow-emerald-500/20"
            >
              <Plus size={16} />
              {isUpgrading ? 'Upgrading...' : 'Buy Additional Seat (+1 Login ID)'}
            </button>
          </div>
        </div>

        {upgradeMsg && (
          <div className="mt-4 p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-400 text-xs font-medium flex items-center gap-2 animate-fade-in">
            <CheckCircle size={16} />
            <span>{upgradeMsg}</span>
          </div>
        )}
      </div>

      {/* Add Session Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <h3 className="text-lg font-bold text-white mb-2 font-heading">Add WhatsApp Profile</h3>
            <p className="text-xs text-slate-400 mb-4">
              Create a new login profile for managing an additional WhatsApp phone number.
            </p>
            <form onSubmit={handleCreateSession} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Profile Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Sales Support WhatsApp"
                  value={newSessionName}
                  onChange={(e) => setNewSessionName(e.target.value)}
                  className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 focus:outline-none focus:border-emerald-500 text-sm"
                />
              </div>
              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 text-slate-400 hover:text-slate-200 text-sm font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-sm font-semibold shadow-md"
                >
                  Create Profile
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* WhatsApp Profiles Grid */}
      <div className="space-y-4">
        <h4 className="text-base font-bold text-white font-heading">Configured WhatsApp Accounts ({sessions.length})</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {sessions.map((s, idx) => (
            <div key={s.id || idx} className="glass-panel border border-slate-800 rounded-2xl p-5 flex flex-col justify-between gap-4">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold ${
                    s.connected ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-slate-800 text-slate-400'
                  }`}>
                    <Smartphone size={20} />
                  </div>
                  <div>
                    <h5 className="font-bold text-white text-sm">{s.session_name}</h5>
                    <span className={`text-[11px] font-semibold ${s.connected ? 'text-emerald-400' : 'text-slate-400'}`}>
                      {s.connected ? '● Connected' : s.status}
                    </span>
                  </div>
                </div>
                {idx > 0 && (
                  <button
                    onClick={() => handleDeleteSession(s.id)}
                    className="p-1.5 hover:bg-rose-500/20 text-slate-500 hover:text-rose-400 rounded-lg transition-colors"
                    title="Delete Profile"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>

              <div className="flex items-center justify-between pt-3 border-t border-slate-800/80 text-xs">
                <span className="text-slate-400">Seat Assignment: Slot #{idx + 1}</span>
                {idx === 0 && !sessionData.connected && (
                  <button
                    onClick={onConnect}
                    disabled={isConnecting}
                    className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg font-semibold text-xs transition-all shadow-sm"
                  >
                    {isConnecting ? 'Opening...' : 'Connect WhatsApp'}
                  </button>
                )}
                {idx === 0 && sessionData.connected && (
                  <button
                    onClick={onLogout}
                    className="px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 rounded-lg font-medium text-xs transition-all"
                  >
                    Disconnect
                  </button>
                )}
                {idx > 0 && (
                  <span className="text-slate-500 text-[11px]">Seat ready for pairing</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Connection Status Card */}
      <div className="glass-panel border border-slate-800 rounded-2xl p-6 relative overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="flex items-start gap-4">
            <div className={`p-3.5 rounded-2xl ${
              sessionData.connected 
                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
                : sessionData.qrImageUrl 
                  ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20 animate-pulse' 
                  : 'bg-slate-800 text-slate-400 border border-slate-700'
            }`}>
              {sessionData.connected ? <ShieldCheck size={28} /> : <QrCode size={28} />}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-bold text-white font-heading">WhatsApp Web Session</h3>
                <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                  sessionData.connected 
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' 
                    : sessionData.qrImageUrl 
                      ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' 
                      : 'bg-slate-800 text-slate-400 border border-slate-700'
                }`}>
                  {sessionData.connected ? 'Connected & Authenticated' : (sessionData.qrImageUrl ? 'Action Required: Scan QR' : sessionData.status || 'Not Connected')}
                </span>
              </div>
              <p className="text-sm text-slate-400 mt-1">
                {sessionData.connected 
                  ? 'Your WhatsApp Web session is logged in and saved locally. All campaigns will execute automatically.' 
                  : 'Link your WhatsApp account once below. Your session will remain saved on this computer.'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {!sessionData.connected && (
              <button
                onClick={onConnect}
                disabled={isConnecting}
                className="flex items-center gap-2 px-5 py-2.5 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white rounded-xl font-medium text-sm transition-all shadow-lg shadow-emerald-500/20"
              >
                {isConnecting ? <RefreshCw size={16} className="animate-spin" /> : <Smartphone size={16} />}
                {isConnecting ? 'Opening Browser...' : 'Connect / Open WhatsApp'}
              </button>
            )}

            <button
              onClick={onRefresh}
              className="p-2.5 bg-slate-900 hover:bg-slate-800 text-slate-300 rounded-xl border border-slate-800 transition-all"
              title="Refresh Connection Status"
            >
              <RefreshCw size={16} />
            </button>

            {(sessionData.connected || sessionData.hasSavedSession) && (
              <button
                onClick={onLogout}
                className="flex items-center gap-2 px-4 py-2.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 rounded-xl text-sm font-medium transition-all"
              >
                <LogOut size={16} />
                Disconnect Account
              </button>
            )}
          </div>
        </div>
      </div>

      {/* QR Code Section */}
      {sessionData.qrImageUrl && !sessionData.connected && (
        <div className="glass-panel border border-amber-500/30 rounded-2xl p-6 bg-amber-500/5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
            <div>
              <div className="flex items-center gap-2 text-amber-400 font-semibold mb-3 text-base">
                <QrCode size={20} />
                <span>Scan QR Code to Link WhatsApp</span>
              </div>
              <ol className="space-y-3 text-sm text-slate-300">
                <li className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-xs font-bold text-emerald-400 shrink-0 mt-0.5">1</span>
                  <span>Open <strong>WhatsApp</strong> on your phone.</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-xs font-bold text-emerald-400 shrink-0 mt-0.5">2</span>
                  <span>Tap <strong>Menu (⋮)</strong> or <strong>Settings (⚙)</strong>.</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-xs font-bold text-emerald-400 shrink-0 mt-0.5">3</span>
                  <span>Select <strong>Linked Devices</strong> and tap <strong>Link a Device</strong>.</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-xs font-bold text-emerald-400 shrink-0 mt-0.5">4</span>
                  <span>Point your phone camera at this screen to scan the QR code.</span>
                </li>
              </ol>
            </div>

            <div className="flex flex-col items-center justify-center p-4 bg-slate-900 border border-slate-800 rounded-xl">
              <img 
                src={`${API_SERVER}${sessionData.qrImageUrl}`} 
                alt="WhatsApp Web QR Code"
                className="w-64 h-64 object-contain rounded-lg border-2 border-white/20 bg-white p-2"
              />
              <p className="text-xs text-slate-400 mt-3 animate-pulse">QR Code active. Scan now to connect.</p>
            </div>
          </div>
        </div>
      )}

      {/* Guide & Specs Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="glass-panel border border-slate-800 rounded-2xl p-6">
          <h4 className="font-semibold text-white text-base mb-2 flex items-center gap-2">
            <ShieldCheck size={18} className="text-emerald-400" />
            Persistent Session Storage
          </h4>
          <p className="text-sm text-slate-400 leading-relaxed">
            Your login cookies are saved locally on this PC in AppData. Once logged in, campaigns launch instantly without asking for QR scans.
          </p>
        </div>

        <div className="glass-panel border border-slate-800 rounded-2xl p-6">
          <h4 className="font-semibold text-white text-base mb-2 flex items-center gap-2">
            <Smartphone size={18} className="text-emerald-400" />
            Standalone Operation
          </h4>
          <p className="text-sm text-slate-400 leading-relaxed">
            WhatsApp Multi-Device keeps your PC connected even if your mobile phone is offline or disconnected from Wi-Fi.
          </p>
        </div>
      </div>
    </div>
  );
}
