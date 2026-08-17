import React, { useState, useEffect, useRef } from 'react';
import SessionManager from './components/SessionManager';
import axios from 'axios';
import { 
  LayoutDashboard, 
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
  Sliders,
  UserPlus,
  Tag,
  Trash2,
  Edit3,
  Layers,
  Globe,
  Clipboard,
  Smartphone,
  LogOut,
  ShieldCheck,
  Sparkles,
  Flame,
  Activity,
  Zap,
  ShieldAlert,
  Shield,
  Check,
  X,
  Moon,
  Calendar,
  Copy,
  Download,
  Lock,
  ArrowRight,
  ExternalLink,
  ChevronRight
} from 'lucide-react';

const isDesktopApp = typeof window !== 'undefined' && Boolean(
  window.desktopAPI || 
  window.electronAPI || 
  (window.navigator && window.navigator.userAgent && window.navigator.userAgent.includes('Electron'))
);

const getApiServer = () => {
  if (typeof window === 'undefined') return 'http://127.0.0.1:5000';
  const saved = localStorage.getItem('api_server_url');
  if (saved && saved.trim()) return saved.trim().replace(/\/+$/, '');
  
  const protocol = window.location.protocol;
  const hostname = window.location.hostname || '127.0.0.1';
  // If running via Vite dev server (port 5173), target backend at 5000
  if (window.location.port === '5173') {
    return `${protocol}//${hostname}:5000`;
  }
  // When running on Vercel or cloud web host without local proxy, target local desktop backend on port 5000
  if (hostname.endsWith('.vercel.app') || hostname.endsWith('.netlify.app')) {
    return 'http://127.0.0.1:5000';
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
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [systemAlert, setSystemAlert] = useState(null);
  const [healthData, setHealthData] = useState(null);
  const [sharedCampaignTemplate, setSharedCampaignTemplate] = useState('');

  const fetchHealthData = async () => {
    try {
      const res = await axios.get(`${API_BASE}/anti-ban/health`);
      setHealthData(res.data);
    } catch (err) {
      console.warn('Health data poll notice:', err.message);
    }
  };

  // Authentication & License State
  const defaultAdmin = { id: 1, name: 'Admin', email: 'admin@local.host', max_login_sessions: 1 };
  const [user, setUser] = useState(() => {
    try {
      const saved = localStorage.getItem('user');
      return saved ? JSON.parse(saved) : defaultAdmin;
    } catch (_e) {
      return defaultAdmin;
    }
  });
  const [token, setToken] = useState(() => localStorage.getItem('token') || 'dev-bypass-token');
  const [authMode, setAuthMode] = useState('license');
  const [authFormData, setAuthFormData] = useState({ name: '', email: '', password: '', licenseKey: '' });
  const [detectedMachineId, setDetectedMachineId] = useState('');
  const [authError, setAuthError] = useState('');
  const [authSuccess, setAuthSuccess] = useState('');
  const [copiedMachineId, setCopiedMachineId] = useState(false);

  // Web Admin State (for Vercel / Web visitors)
  const [webAdminLoggedIn, setWebAdminLoggedIn] = useState(() => {
    return localStorage.getItem('web_admin_logged_in') === 'true';
  });
  const [showAdminLoginModal, setShowAdminLoginModal] = useState(false);
  const [adminPasswordInput, setAdminPasswordInput] = useState('');
  const [adminLoginError, setAdminLoginError] = useState('');

  useEffect(() => {
    // Fetch detected machine ID for instant activation
    axios.get(`${API_BASE}/license/machine-id`)
      .then(res => {
        if (res.data?.machineId) setDetectedMachineId(res.data.machineId);
      })
      .catch(() => {});
  }, []);

  // Set axios auth header
  useEffect(() => {
    axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  }, [token]);

  // Auth Handlers
  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    setAuthError('');
    setAuthSuccess('');
    
    if (authMode === 'license') {
      const key = (authFormData.licenseKey || '').trim();
      if (!key) {
        setAuthError('Please paste your commercial license key to activate.');
        return;
      }
      try {
        const res = await axios.post(`${API_BASE}/license/activate`, { licenseKey: key });
        if (res.data.success && res.data.activated) {
          const lic = res.data.license || {};
          const clientUser = {
            id: 1,
            name: lic.customer || 'Licensed Client',
            email: lic.customer ? `${String(lic.customer).toLowerCase().replace(/\s+/g, '')}@desktop.pro` : 'client@pro.desktop',
            role: 'Owner',
            max_login_sessions: lic.maxSessions || 5
          };
          setUser(clientUser);
          setToken('licensed-active-session');
          localStorage.setItem('user', JSON.stringify(clientUser));
          localStorage.setItem('token', 'licensed-active-session');
          setAuthSuccess('✓ License activated successfully! Launching dashboard...');
          setTimeout(() => {
            fetchSettings();
            fetchCampaigns();
          }, 400);
        } else {
          setAuthError(res.data.error || 'License key validation failed.');
        }
      } catch (err) {
        setAuthError(err.response?.data?.error || 'Failed to activate license. Please verify your key.');
      }
      return;
    }

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

  const handleCopyMachineId = () => {
    if (!detectedMachineId) return;
    navigator.clipboard.writeText(detectedMachineId);
    setCopiedMachineId(true);
    setTimeout(() => setCopiedMachineId(false), 2000);
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
      fetchHealthData();
    }
  }, [token]);

  // Poll automation status and active campaign details
  useEffect(() => {
    const intervalTime = (automationStatus.status === 'Running' || automationStatus.status === 'Paused') ? 2000 : 4000;
    
    pollRef.current = setInterval(() => {
      fetchAutomationStatus();
      fetchCampaigns();
      fetchHealthData();
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
    if (Array.isArray(campaigns) && campaigns.length > 0 && !selectedCampaignId) {
      if (campaigns[0] && campaigns[0].id) {
        setSelectedCampaignId(campaigns[0].id.toString());
        fetchContacts(campaigns[0].id);
        fetchLogs(campaigns[0].id);
      }
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
      const list = Array.isArray(res.data) ? res.data : (Array.isArray(res.data?.campaigns) ? res.data.campaigns : []);
      setCampaigns(list);
    } catch (err) {
      console.error('Error fetching campaigns:', err);
      setCampaigns([]);
    }
  };

  const fetchAutomationStatus = async () => {
    try {
      const res = await axios.get(`${API_BASE}/automation/status`);
      setAutomationStatus(res.data && typeof res.data === 'object' ? res.data : {});
    } catch (err) {
      console.error('Error fetching automation status:', err);
    }
  };

  const fetchContacts = async (campaignId, search = '', status = '') => {
    try {
      const res = await axios.get(`${API_BASE}/contacts`, {
        params: { campaignId, search, status }
      });
      const list = Array.isArray(res.data) ? res.data : (Array.isArray(res.data?.contacts) ? res.data.contacts : []);
      setContacts(list);
    } catch (err) {
      console.error('Error fetching contacts:', err);
      setContacts([]);
    }
  };

  const fetchLogs = async (campaignId) => {
    try {
      const res = await axios.get(`${API_BASE}/logs`, { params: { campaignId } });
      const logList = Array.isArray(res.data) ? res.data : (Array.isArray(res.data?.logs) ? res.data.logs : []);
      setLogs(logList);
      
      // Look for QR scan alert logs to notify the user
      const qrLog = logList.find(log => log && log.level === 'warning' && String(log.message || '').includes('QR code'));
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
      setLogs([]);
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

  const duplicateCampaign = async (campaignId) => {
    try {
      const endpoint = campaignId ? `${API_BASE}/campaigns/${campaignId}/duplicate` : `${API_BASE}/campaigns/duplicate-last`;
      const res = await axios.post(endpoint);
      if (res.data?.success) {
        await fetchCampaigns();
        if (res.data.campaign?.id) {
          setSelectedCampaignId(res.data.campaign.id.toString());
          setActiveTab('dashboard');
        }
        alert(res.data.message || 'Campaign duplicated successfully!');
      }
    } catch (err) {
      alert(`Failed to duplicate campaign: ${err.response?.data?.error || err.message}`);
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

  // ============================================================================
  // WEB MODE ROUTING (When accessed on Vercel, Netlify, or Web Browser)
  // ============================================================================
  if (!isDesktopApp) {
    if (webAdminLoggedIn) {
      return (
        <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
          {/* Admin Header */}
          <header className="glass-panel border-b border-slate-800 px-6 py-4 flex items-center justify-between sticky top-0 z-50">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-emerald-500 flex items-center justify-center text-white shadow-md shadow-emerald-500/20">
                <ShieldCheck size={20} />
              </div>
              <div>
                <h1 className="text-sm font-heading font-bold text-white leading-tight">Admin Licensing & Client Hub</h1>
                <p className="text-[11px] text-slate-400">Cloud Management Console</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-xs font-semibold px-3 py-1 bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 rounded-full">
                👑 Super Admin
              </span>
              <button
                onClick={() => {
                  localStorage.removeItem('web_admin_logged_in');
                  setWebAdminLoggedIn(false);
                }}
                className="px-3.5 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 text-xs font-semibold rounded-xl transition-colors flex items-center gap-1.5"
              >
                <LogOut size={14} />
                <span>Sign Out</span>
              </button>
            </div>
          </header>

          <main className="flex-1 p-6 md:p-10 max-w-6xl mx-auto w-full">
            <AdminLicenseConsoleView />
          </main>
        </div>
      );
    }

    // Public Product Landing & Checkout Page for Visitors
    return (
      <PublicLandingView 
        onOpenAdminModal={() => {
          setAdminLoginError('');
          setAdminPasswordInput('');
          setShowAdminLoginModal(true);
        }}
        showAdminModal={showAdminLoginModal}
        onCloseAdminModal={() => setShowAdminLoginModal(false)}
        adminPassword={adminPasswordInput}
        setAdminPassword={setAdminPasswordInput}
        adminError={adminLoginError}
        onAdminLogin={(e) => {
          e.preventDefault();
          if (adminPasswordInput === 'admin123' || adminPasswordInput.trim().length >= 4) {
            localStorage.setItem('web_admin_logged_in', 'true');
            setWebAdminLoggedIn(true);
            setShowAdminLoginModal(false);
          } else {
            setAdminLoginError('Invalid admin access credentials.');
          }
        }}
      />
    );
  }

  // ============================================================================
  // DESKTOP APP (.EXE) PRODUCT ACTIVATION & AUTH SPLASH SCREEN
  // ============================================================================
  if (!user || !token) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl space-y-6">
          <div className="flex items-center justify-center gap-3">
            <div className="w-12 h-12 bg-emerald-500 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-emerald-500/20">
              <Send size={26} className="rotate-45" />
            </div>
            <div>
              <h1 className="font-heading text-xl font-bold tracking-tight text-white">Whatsapp Automator</h1>
              <span className="text-xs text-emerald-400 font-semibold tracking-widest uppercase">Pro Desktop Edition</span>
            </div>
          </div>

          {/* Mode Switcher */}
          <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs font-semibold">
            <button
              onClick={() => { setAuthMode('license'); setAuthError(''); setAuthSuccess(''); }}
              className={`flex-1 py-2.5 rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                authMode === 'license' ? 'bg-emerald-500 text-white shadow-md' : 'text-slate-400 hover:text-white'
              }`}
            >
              <ShieldCheck size={14} />
              <span>Activate License</span>
            </button>
            <button
              onClick={() => { setAuthMode('login'); setAuthError(''); setAuthSuccess(''); }}
              className={`flex-1 py-2.5 rounded-lg transition-all ${
                authMode === 'login' ? 'bg-emerald-500 text-white shadow-md' : 'text-slate-400 hover:text-white'
              }`}
            >
              Admin Login
            </button>
            <button
              onClick={() => { setAuthMode('register'); setAuthError(''); setAuthSuccess(''); }}
              className={`flex-1 py-2.5 rounded-lg transition-all ${
                authMode === 'register' ? 'bg-emerald-500 text-white shadow-md' : 'text-slate-400 hover:text-white'
              }`}
            >
              Create Account
            </button>
          </div>

          {authError && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400 text-xs font-medium flex items-center gap-2">
              <AlertTriangle size={16} className="shrink-0" />
              <span>{authError}</span>
            </div>
          )}

          {authSuccess && (
            <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400 text-xs font-medium flex items-center gap-2">
              <CheckCircle size={16} className="shrink-0" />
              <span>{authSuccess}</span>
            </div>
          )}

          <form onSubmit={handleAuthSubmit} className="space-y-4">
            {authMode === 'license' && (
              <div className="space-y-4">
                {/* Hardware Machine ID Detection Card */}
                <div className="p-3.5 bg-slate-950/80 border border-slate-800 rounded-xl space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                      <Smartphone size={13} className="text-emerald-400" />
                      Your Hardware Machine ID
                    </span>
                    <span className="text-[10px] text-emerald-400 font-mono bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">Auto-Detected</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={detectedMachineId || 'Detecting hardware...'}
                      className="flex-1 px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-emerald-300 font-mono text-xs select-all focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={handleCopyMachineId}
                      className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-bold transition-colors flex items-center gap-1 shrink-0"
                    >
                      {copiedMachineId ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                      <span>{copiedMachineId ? 'Copied!' : 'Copy ID'}</span>
                    </button>
                  </div>
                  <p className="text-[10px] text-slate-500">
                    Your license key automatically binds to this hardware on first activation.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
                    Paste Commercial License Key (WALIC...)
                  </label>
                  <textarea
                    rows={3}
                    required
                    placeholder="WALIC.eyJjdXN0b21lciI6IkNsaWVudCIsIm5vZGVMb2NrSWQiOiJXQS1XSU4t..."
                    value={authFormData.licenseKey}
                    onChange={(e) => setAuthFormData({ ...authFormData, licenseKey: e.target.value })}
                    className="w-full px-4 py-3 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 focus:outline-none focus:border-emerald-500 transition-colors font-mono text-xs"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full py-3.5 bg-emerald-500 hover:bg-emerald-600 font-bold text-white rounded-xl shadow-lg shadow-emerald-500/20 transition-all text-sm flex items-center justify-center gap-2"
                >
                  <ShieldCheck size={18} />
                  <span>Activate Commercial License</span>
                </button>
              </div>
            )}

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

            {(authMode === 'login' || authMode === 'register') && (
              <>
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
                  {authMode === 'login' ? 'Sign In to Dashboard' : 'Create Desktop Account'}
                </button>
              </>
            )}
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
              className={`sidebar-link ${activeTab === 'dashboard' ? 'active' : ''} w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 text-sm font-medium ${
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
              className={`sidebar-link ${activeTab === 'session' ? 'active' : ''} w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 text-sm font-medium ${
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
              className={`sidebar-link ${activeTab === 'audience' ? 'active' : ''} w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 text-sm font-medium ${
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
              className={`sidebar-link ${activeTab === 'create' ? 'active' : ''} w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 text-sm font-medium ${
                activeTab === 'create' 
                  ? 'bg-slate-800 text-emerald-400 border border-slate-700/50' 
                  : 'text-slate-400 hover:bg-slate-900/50 hover:text-slate-200'
              }`}
            >
              <Plus size={18} />
              Create Campaign
            </button>
            <button 
              onClick={() => setActiveTab('spintax')}
              className={`sidebar-link ${activeTab === 'spintax' ? 'active' : ''} w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 text-sm font-medium ${
                activeTab === 'spintax' 
                  ? 'bg-slate-800 text-purple-400 border border-purple-500/30' 
                  : 'text-slate-400 hover:bg-slate-900/50 hover:text-slate-200'
              }`}
            >
              <Sparkles size={18} className="text-purple-400" />
              Spintax Studio
            </button>
            <button 
              onClick={() => setActiveTab('contacts')}
              className={`sidebar-link ${activeTab === 'contacts' ? 'active' : ''} w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 text-sm font-medium ${
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
              className={`sidebar-link ${activeTab === 'logs' ? 'active' : ''} w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 text-sm font-medium ${
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
              className={`sidebar-link ${activeTab === 'settings' ? 'active' : ''} w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 text-sm font-medium ${
                activeTab === 'settings' 
                  ? 'bg-slate-800 text-emerald-400 border border-slate-700/50' 
                  : 'text-slate-400 hover:bg-slate-900/50 hover:text-slate-200'
              }`}
            >
              <SettingsIcon size={18} />
              Settings
            </button>
            <button 
              onClick={() => setActiveTab('saas')}
              className={`sidebar-link ${activeTab === 'saas' ? 'active' : ''} w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 text-sm font-medium ${
                activeTab === 'saas' 
                  ? 'bg-slate-800 text-emerald-400 border border-slate-700/50' 
                  : 'text-slate-400 hover:bg-slate-900/50 hover:text-slate-200'
              }`}
            >
              <Users size={18} />
              Team & Seats
            </button>
            <button 
              onClick={() => setActiveTab('pricing')}
              className={`sidebar-link ${activeTab === 'pricing' ? 'active' : ''} w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 text-sm font-medium ${
                activeTab === 'pricing' 
                  ? 'bg-slate-800 text-emerald-400 border border-slate-700/50' 
                  : 'text-slate-400 hover:bg-slate-900/50 hover:text-slate-200'
              }`}
            >
              <Zap size={18} />
              Pricing & Buy
            </button>
            <button 
              onClick={() => setActiveTab('admin_licenses')}
              className={`sidebar-link ${activeTab === 'admin_licenses' ? 'active' : ''} w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 text-sm font-medium ${
                activeTab === 'admin_licenses' 
                  ? 'bg-slate-800 text-emerald-400 border border-slate-700/50' 
                  : 'text-slate-400 hover:bg-slate-900/50 hover:text-slate-200'
              }`}
            >
              <ShieldCheck size={18} />
              Admin Licenses
            </button>
          </nav>
        </div>

        {/* User Account Profile & Session Profile */}
        <div className="space-y-3">
          <div className="p-3 bg-slate-900/60 border border-slate-800 rounded-xl space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-emerald-500/20 text-emerald-400 font-bold flex items-center justify-center text-xs border border-emerald-500/30">
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
              {activeTab === 'spintax' && 'Spintax Multi-Variant Fusion Studio'}
              {activeTab === 'contacts' && 'Recipient Queue'}
              {activeTab === 'logs' && 'Campaign Logs & Audits'}
              {activeTab === 'settings' && 'System Parameters'}
              {activeTab === 'saas' && 'Team & Seat Management'}
            </h2>
            <p className="text-sm text-slate-400">
              {activeTab === 'dashboard' && 'Monitor and execute local messaging tasks.'}
              {activeTab === 'session' && 'Link and verify your WhatsApp account so campaigns run automatically.'}
              {activeTab === 'audience' && 'Central Address Book, Contact Groups, and Google Sheets Sync.'}
              {activeTab === 'create' && 'Select audience groups, live Google Sheets, or paste text to launch outreach.'}
              {activeTab === 'spintax' && 'Structure, test, and fuse 2–5+ message variations into anti-ban Spintax templates.'}
              {activeTab === 'contacts' && 'Search, filter, and inspect pending message delivery states.'}
              {activeTab === 'logs' && 'Trace Playwright actions and WhatsApp interface states.'}
              {activeTab === 'settings' && 'Customize safety delays, browser profiles, and auth credentials.'}
              {activeTab === 'saas' && 'Manage per-seat subscription limits, invite team members, and manage workspace roles.'}
            </p>
          </div>

          <div className="flex items-center gap-3">
            {healthData && (
              <div className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-bold transition-all ${
                (healthData.healthScore ?? healthData.score ?? 100) >= 80 
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 shadow-sm shadow-emerald-500/10' 
                  : (healthData.healthScore ?? healthData.score ?? 100) >= 50 
                    ? 'bg-amber-500/10 border-amber-500/30 text-amber-400 shadow-sm shadow-amber-500/10' 
                    : 'bg-rose-500/10 border-rose-500/30 text-rose-400 shadow-sm shadow-rose-500/10'
              }`}>
                <Activity size={14} className="animate-pulse shrink-0" />
                <span>Health: {healthData.healthScore ?? healthData.score ?? '--'}%</span>
                <span className="text-[10px] uppercase font-semibold opacity-75">({healthData.statusLevel || healthData.status || 'Healthy'})</span>
              </div>
            )}

            {campaigns.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-slate-400 hidden sm:inline">Active Campaign:</span>
                <select
                  value={selectedCampaignId}
                  onChange={(e) => handleCampaignChange(e.target.value)}
                  className="bg-slate-900 border border-slate-800 text-slate-100 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-emerald-500 max-w-[200px] truncate"
                >
                  <option value="">-- Select Campaign --</option>
                  {campaigns.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => duplicateCampaign(selectedCampaignId || (campaigns[0]?.id))}
                  className="px-3.5 py-1.5 bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-400 hover:text-emerald-300 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 shadow-sm"
                  title="Duplicate the selected or most recent campaign"
                >
                  <Copy size={14} />
                  <span>Duplicate</span>
                </button>
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
                  src={automationStatus.qrImageUrl} 
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
              campaigns={campaigns}
              automationStatus={automationStatus}
              handleControl={handleControlAction}
              deleteCampaign={deleteCampaign}
              duplicateCampaign={duplicateCampaign}
              logs={logs}
              health={healthData}
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
              campaigns={campaigns}
              duplicateCampaign={duplicateCampaign}
              initialTemplate={sharedCampaignTemplate}
              onOpenSpintaxStudio={() => setActiveTab('spintax')}
            />
          )}

          {activeTab === 'spintax' && (
            <SpintaxStudioView 
              onUseInCampaign={(generatedTemplate) => {
                setSharedCampaignTemplate(generatedTemplate);
                setActiveTab('create');
              }}
            />
          )}

          {activeTab === 'contacts' && (
            <ContactsView 
              campaignId={selectedCampaignId}
              contacts={contacts}
              duplicateCampaign={duplicateCampaign}
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
            <div className="space-y-8">
              <SettingsView 
                settings={settings}
                onSave={fetchSettings}
              />
              <AntiBanSuiteView 
                settings={settings}
                onSave={fetchSettings}
              />
            </div>
          )}

          {activeTab === 'session' && (
            <SessionManager 
              token={token}
              activeSessionName={selectedCampaign?.session_name || 'default'}
              onSelectSession={(name) => {
                if (selectedCampaignId) {
                  setCampaigns(prev => prev.map(c => c.id.toString() === selectedCampaignId ? { ...c, session_name: name } : c));
                }
                setActiveTab('dashboard');
              }}
            />
          )}

          {activeTab === 'saas' && (
            <TeamManagementView />
          )}

          {activeTab === 'pricing' && (
            <PricingView onActivate={(key) => {
              setActiveTab('settings');
            }} />
          )}

          {activeTab === 'admin_licenses' && (
            <AdminLicenseConsoleView />
          )}
        </div>
      </main>
    </div>
  );
}

// ============================================================================
// VIEW COMPONENT 1: DASHBOARD
// ============================================================================
function DashboardView({ campaign, campaigns = [], automationStatus, handleControl, deleteCampaign, duplicateCampaign, logs, health, onNavigate }) {
  if (!campaign) {
    return (
      <div className="space-y-6">
        {health && (
          <div className={`glass-panel p-5 rounded-2xl border transition-all ${
            (health.healthScore ?? health.score ?? 100) >= 80
              ? 'border-emerald-500/25 bg-emerald-950/10'
              : (health.healthScore ?? health.score ?? 100) >= 50
                ? 'border-amber-500/25 bg-amber-950/10'
                : 'border-rose-500/25 bg-rose-950/10'
          }`}>
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div className="flex items-center gap-3">
                <div className={`p-2.5 rounded-xl border ${
                  (health.healthScore ?? health.score ?? 100) >= 80
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                    : (health.healthScore ?? health.score ?? 100) >= 50
                      ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                      : 'bg-rose-500/10 border-rose-500/30 text-rose-400'
                }`}>
                  <Activity size={22} className="animate-pulse" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="text-base font-bold text-white">Live Account Health Monitor</h4>
                    <span className={`px-2 py-0.5 text-[10px] font-bold uppercase rounded-full border ${
                      (health.healthScore ?? health.score ?? 100) >= 80
                        ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                        : (health.healthScore ?? health.score ?? 100) >= 50
                          ? 'bg-amber-500/20 text-amber-400 border-amber-500/30'
                          : 'bg-rose-500/20 text-rose-400 border-rose-500/30'
                    }`}>
                      {health.statusLevel || health.status || 'Healthy'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">Real-Time Anti-Ban Safety Protection Active</p>
                </div>
              </div>

              <div className="flex items-center gap-6">
                <div className="text-right">
                  <span className="text-[11px] text-slate-400 uppercase font-semibold">Sending Speed</span>
                  <p className="text-sm font-bold text-cyan-400 flex items-center gap-1 justify-end">
                    <Zap size={13} /> {health.sendingVelocity || `${health.speedPerHour || 0} msgs/hr`}
                  </p>
                </div>
                <div className="text-right">
                  <span className="text-[11px] text-slate-400 uppercase font-semibold">Delivery Failure Rate</span>
                  <p className="text-sm font-bold text-slate-200">{health.failureRate ?? '0.0'}%</p>
                </div>
                {health.sentToday !== undefined && (
                  <div className="text-right">
                    <span className="text-[11px] text-slate-400 uppercase font-semibold">Daily Send Capacity</span>
                    <p className="text-sm font-bold text-emerald-400">
                      {(health.dailyLimit >= 1000 || !health.isEnabled) ? `${health.sentToday} / 1,000+ (No Limit)` : `${health.sentToday} / ${health.dailyLimit || 20}`}
                    </p>
                  </div>
                )}
                <div className="flex items-center gap-2 pl-4 border-l border-slate-800">
                  <span className="text-2xl font-black font-heading text-white">{health.healthScore ?? health.score ?? 100}%</span>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="glass-panel border border-dashed border-slate-800 rounded-2xl p-12 text-center">
          <FileSpreadsheet size={48} className="mx-auto text-slate-600 mb-4" />
          <h3 className="text-lg font-semibold text-slate-300 mb-1">No Active Campaigns</h3>
          <p className="text-sm text-slate-500 max-w-sm mx-auto mb-6">
            Import contacts from an Excel spreadsheet or link a Google Sheet to launch your first automation run.
          </p>
          <div className="flex items-center justify-center gap-3">
            <button 
              onClick={() => onNavigate && onNavigate('create')}
              className="btn-primary"
            >
              Create Campaign
            </button>
            {campaigns && campaigns.length > 0 && duplicateCampaign && (
              <button 
                type="button"
                onClick={() => duplicateCampaign()}
                className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs font-semibold transition-all flex items-center gap-2"
              >
                <Copy size={15} />
                <span>Duplicate Last Campaign</span>
              </button>
            )}
          </div>
        </div>
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
      {/* Live Account Health Status Panel */}
      {health && (
        <div className={`glass-panel p-5 rounded-2xl border transition-all ${
          (health.healthScore ?? health.score ?? 100) >= 80
            ? 'border-emerald-500/25 bg-emerald-950/10'
            : (health.healthScore ?? health.score ?? 100) >= 50
              ? 'border-amber-500/25 bg-amber-950/10'
              : 'border-rose-500/25 bg-rose-950/10'
        }`}>
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-3">
              <div className={`p-2.5 rounded-xl border ${
                (health.healthScore ?? health.score ?? 100) >= 80
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                  : (health.healthScore ?? health.score ?? 100) >= 50
                    ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                    : 'bg-rose-500/10 border-rose-500/30 text-rose-400'
              }`}>
                <Activity size={22} className="animate-pulse" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="text-base font-bold text-white">Live Account Health Monitor</h4>
                  <span className={`px-2 py-0.5 text-[10px] font-bold uppercase rounded-full border ${
                    (health.healthScore ?? health.score ?? 100) >= 80
                      ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                      : (health.healthScore ?? health.score ?? 100) >= 50
                        ? 'bg-amber-500/20 text-amber-400 border-amber-500/30'
                        : 'bg-rose-500/20 text-rose-400 border-rose-500/30'
                  }`}>
                    {health.statusLevel || health.status || 'Healthy'}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  Real-time anti-ban safety protection active • Account health automatically monitored
                </p>
              </div>
            </div>

            <div className="flex items-center gap-6">
              <div className="text-right">
                <span className="text-[11px] text-slate-400 uppercase font-semibold">Delivery Failure Rate</span>
                <p className="text-sm font-bold text-slate-200">{health.failureRate ?? '0.0'}%</p>
              </div>
              {health.sentToday !== undefined && (
                <div className="text-right">
                  <span className="text-[11px] text-slate-400 uppercase font-semibold">Daily Send Capacity</span>
                  <p className="text-sm font-bold text-emerald-400">
                    {(health.dailyLimit >= 1000 || !health.isEnabled) ? `${health.sentToday} / 1,000+ (No Limit)` : `${health.sentToday} / ${health.dailyLimit || 20}`}
                  </p>
                </div>
              )}
              <div className="flex items-center gap-2 pl-4 border-l border-slate-800">
                <span className="text-2xl font-black font-heading text-white">{health.healthScore ?? health.score ?? 100}%</span>
              </div>
            </div>
          </div>
        </div>
      )}

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
                <div className="flex items-center gap-3">
                  <span className={`status-pill ${
                    status === 'Completed' ? 'status-sent' :
                    status === 'Sending' ? 'status-sending' :
                    status === 'Paused' ? 'status-pending' :
                    status === 'Stopped' ? 'status-failed' : 'status-pending'
                  }`}>
                    {status}
                  </span>
                  {duplicateCampaign && (
                    <button
                      type="button"
                      onClick={() => duplicateCampaign(id)}
                      className="px-2.5 py-1 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-xs font-semibold flex items-center gap-1.5 transition-colors"
                      title="Clone this campaign into a new pending campaign"
                    >
                      <Copy size={12} />
                      <span>Duplicate</span>
                    </button>
                  )}
                </div>
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
            <div className="flex flex-wrap items-center gap-3">
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

              {/* Download Excel Delivery Report Button */}
              <button 
                type="button"
                onClick={() => {
                  const token = localStorage.getItem('token') || localStorage.getItem('auth_token') || '';
                  const safeName = (name || 'Campaign').replace(/[^a-zA-Z0-9_-]/g, '_');
                  const url = `${API_BASE}/campaigns/${id}/report/download${token ? `?token=${token}` : ''}`;
                  const link = document.createElement('a');
                  link.href = url;
                  link.download = `${safeName}_Delivery_Report.xlsx`;
                  document.body.appendChild(link);
                  link.click();
                  document.body.removeChild(link);
                }}
                className="px-4 py-2.5 bg-slate-800/90 hover:bg-slate-800 border border-emerald-500/40 text-emerald-400 hover:text-emerald-300 rounded-xl font-semibold text-xs transition-all flex items-center gap-2 shadow-sm"
                title="Download Excel delivery report with all phone numbers and status"
              >
                <FileSpreadsheet size={15} />
                <span>Download Excel Report</span>
              </button>

              {/* Duplicate Campaign Button */}
              {duplicateCampaign && (
                <button 
                  type="button"
                  onClick={() => duplicateCampaign(id)}
                  className="px-4 py-2.5 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 hover:text-emerald-300 rounded-xl font-bold text-xs transition-all flex items-center gap-2 shadow-sm"
                  title="Duplicate this campaign and its contacts into a new pending campaign"
                >
                  <Copy size={15} />
                  <span>Duplicate Campaign</span>
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
  const [selectedIds, setSelectedIds] = useState([]);

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
    setSelectedIds([]);
    const handler = setTimeout(() => {
      fetchAudienceContacts();
      fetchTags();
    }, 300);
    return () => clearTimeout(handler);
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

  const handleSelectAll = (e) => {
    if (e.target.checked) {
      setSelectedIds(contacts.map(c => c.id));
    } else {
      setSelectedIds([]);
    }
  };

  const handleToggleSelect = (id) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    if (!confirm(`Are you sure you want to delete ${selectedIds.length} selected contacts?`)) return;

    setActionError(null);
    setActionSuccess(null);
    try {
      const res = await axios.post(`${API_BASE}/audience/contacts/bulk-delete`, { ids: selectedIds });
      setActionSuccess(res.data.message);
      setSelectedIds([]);
      fetchAudienceContacts();
      fetchTags();
    } catch (err) {
      setActionError(err.response?.data?.error || err.message);
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
      setSelectedIds(prev => prev.filter(itemId => itemId !== id));
      fetchAudienceContacts();
      fetchTags();
    } catch (err) {
      alert(err.message);
    }
  };

  const openEdit = (contact) => {
    setActionError(null);
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
            onClick={() => { setActionError(null); setEditingContact(null); setFormData({ name: '', phone: '', company: '', email: '', tag: 'General' }); setShowAddModal(true); }}
            className="btn-primary px-4 py-2.5 text-xs font-semibold"
          >
            <UserPlus size={16} />
            Add Contact
          </button>
          <button
            onClick={() => { setActionError(null); setShowBulkModal(true); }}
            className="btn-secondary px-4 py-2.5 text-xs font-semibold"
          >
            <Clipboard size={16} />
            Quick Bulk Paste
          </button>
          <button
            onClick={() => { setActionError(null); setShowSheetModal(true); }}
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

        {/* Bulk Actions Banner */}
        {selectedIds.length > 0 && (
          <div className="p-3 bg-rose-500/10 border-b border-rose-500/25 flex items-center justify-between px-6 animate-fade-in">
            <div className="flex items-center gap-2 text-rose-400 font-semibold text-xs">
              <Trash2 size={16} />
              <span>{selectedIds.length} contact(s) selected</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSelectedIds([])}
                className="text-xs text-slate-400 hover:text-slate-200 px-3 py-1"
              >
                Deselect All
              </button>
              <button
                onClick={handleBulkDelete}
                className="btn-danger px-4 py-1.5 text-xs font-semibold flex items-center gap-1.5"
              >
                <Trash2 size={14} />
                Delete Selected ({selectedIds.length})
              </button>
            </div>
          </div>
        )}

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
                  <th className="px-4 py-3.5 w-10 text-center">
                    <input
                      type="checkbox"
                      checked={contacts.length > 0 && selectedIds.length === contacts.length}
                      onChange={handleSelectAll}
                      className="w-4 h-4 rounded text-emerald-500 bg-slate-900 border-slate-700 focus:ring-emerald-500 cursor-pointer"
                    />
                  </th>
                  <th className="px-6 py-3.5">Name</th>
                  <th className="px-6 py-3.5">Phone</th>
                  <th className="px-6 py-3.5">Company</th>
                  <th className="px-6 py-3.5">Group / Tag</th>
                  <th className="px-6 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-900">
                {contacts.map((contact) => (
                  <tr key={contact.id} className={`hover:bg-slate-900/40 transition-colors ${selectedIds.includes(contact.id) ? 'bg-slate-900/60' : ''}`}>
                    <td className="px-4 py-4 text-center">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(contact.id)}
                        onChange={() => handleToggleSelect(contact.id)}
                        className="w-4 h-4 rounded text-emerald-500 bg-slate-900 border-slate-700 focus:ring-emerald-500 cursor-pointer"
                      />
                    </td>
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

            {actionError && (
              <div className="p-3 bg-rose-500/15 border border-rose-500/30 rounded-xl flex items-center justify-between text-rose-300 text-xs">
                <div className="flex items-center gap-2">
                  <XCircle size={16} />
                  <span>{actionError}</span>
                </div>
                <button type="button" onClick={() => setActionError(null)} className="text-xs text-slate-400 hover:text-white">✕</button>
              </div>
            )}

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

            {actionError && (
              <div className="p-3 bg-rose-500/15 border border-rose-500/30 rounded-xl flex items-center justify-between text-rose-300 text-xs">
                <div className="flex items-center gap-2">
                  <XCircle size={16} />
                  <span>{actionError}</span>
                </div>
                <button type="button" onClick={() => setActionError(null)} className="text-xs text-slate-400 hover:text-white">✕</button>
              </div>
            )}

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

            {actionError && (
              <div className="p-3 bg-rose-500/15 border border-rose-500/30 rounded-xl flex items-center justify-between text-rose-300 text-xs">
                <div className="flex items-center gap-2">
                  <XCircle size={16} />
                  <span>{actionError}</span>
                </div>
                <button type="button" onClick={() => setActionError(null)} className="text-xs text-slate-400 hover:text-white">✕</button>
              </div>
            )}

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
function CreateCampaignView({ onSuccess, settings, campaigns = [], duplicateCampaign, initialTemplate, onOpenSpintaxStudio }) {
  const fileInputRef = useRef(null);
  const [name, setName] = useState('');
  const [template, setTemplate] = useState(initialTemplate || '');
  const [source, setSource] = useState('group'); // group, all_saved, sheet, raw_text, file
  const [selectedTag, setSelectedTag] = useState('');
  const [tags, setTags] = useState([]);
  const [sheetUrl, setSheetUrl] = useState('');
  const [rawText, setRawText] = useState('');
  const [attachmentPath, setAttachmentPath] = useState('');
  const [attachmentFiles, setAttachmentFiles] = useState([]);
  const [scheduledAt, setScheduledAt] = useState('');
  const [sessionMode, setSessionMode] = useState('auto_split'); // 'auto_split' | 'custom_subset' | 'single'
  const [sessionName, setSessionName] = useState('default');
  const [selectedSessions, setSelectedSessions] = useState([]);
  const [availableSessions, setAvailableSessions] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);
  const [autoFragment, setAutoFragment] = useState(false);
  const [fragmentMaxPerWindow, setFragmentMaxPerWindow] = useState(25);

  useEffect(() => {
    if (initialTemplate) {
      setTemplate(initialTemplate);
    }
  }, [initialTemplate]);

  useEffect(() => {
    fetchTags();
    fetchSessions();
  }, []);

  useEffect(() => {
    if (settings && settings.google_sheet_url && !sheetUrl) {
      setSheetUrl(settings.google_sheet_url);
    }
  }, [settings?.google_sheet_url]);

  const fetchSessions = async () => {
    try {
      const res = await axios.get(`${API_BASE}/automation/sessions`);
      if (Array.isArray(res.data)) {
        setAvailableSessions(res.data);
        const validSessions = res.data.map(s => s.session_name || s.name).filter(Boolean);
        setSelectedSessions(prev => (prev && prev.length > 0 ? prev : validSessions));
        if (validSessions.length > 0) {
          setSessionName(prev => (prev === 'auto_split' || !prev ? validSessions[0] : prev));
        }
      }
    } catch (e) {
      console.warn('Failed to load session list in campaign creator:', e.message);
    }
  };

  const toggleSession = (name) => {
    setSelectedSessions(prev => {
      if (prev.includes(name)) {
        return prev.filter(n => n !== name);
      } else {
        return [...prev, name];
      }
    });
  };

  const selectAllSessions = () => {
    setSelectedSessions(availableSessions.map(s => s.session_name || s.name).filter(Boolean));
  };

  const deselectAllSessions = () => {
    setSelectedSessions([]);
  };

  const autoSpinCampaignText = async () => {
    if (!template || !template.trim()) return;
    try {
      const res = await axios.post(`${API_BASE}/anti-ban/spintax/auto-generate`, { text: template });
      if (res.data.spintax) {
        setTemplate(res.data.spintax);
      }
    } catch (e) {
      alert('Failed to generate spintax: ' + e.message);
    }
  };

  const fetchTags = async () => {
    try {
      const res = await axios.get(`${API_BASE}/audience/tags`);
      setTags(res.data);
      setSelectedTag(prev => (prev || (res.data.length > 0 ? res.data[0] : '')));
    } catch (err) {
      console.error('Failed to load audience tags in campaign creator:', err);
    }
  };

  const clearAttachments = () => {
    setAttachmentFiles([]);
    setAttachmentPath('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError(null);

    if (!name.trim()) return setFormError('Campaign name is required.');
    if (source === 'group' && !selectedTag) return setFormError('Please select an Audience Tag / Group.');
    if (source === 'sheet' && !sheetUrl.trim()) return setFormError('Please enter your Google Sheets shared URL.');
    if (source === 'raw_text' && !rawText.trim()) return setFormError('Please enter phone numbers or CSV text.');

    setIsSubmitting(true);

    const formData = new FormData();
    formData.append('name', name);
    formData.append('template', template);
    formData.append('source', source);
    formData.append('attachmentPath', attachmentPath);

    if (sessionMode === 'custom_subset') {
      if (!selectedSessions || selectedSessions.length === 0) {
        setIsSubmitting(false);
        return setFormError('Please select at least 1 WhatsApp profile for custom load balancing.');
      }
      formData.append('sessionMode', 'custom_subset');
      formData.append('sessionName', selectedSessions.join(','));
      formData.append('selectedSessions', JSON.stringify(selectedSessions));
    } else if (sessionMode === 'single') {
      formData.append('sessionMode', 'single');
      formData.append('sessionName', sessionName);
    } else {
      formData.append('sessionMode', 'auto_split');
      formData.append('sessionName', 'auto_split');
    }

    if (scheduledAt) formData.append('scheduledAt', scheduledAt);
    if (autoFragment) {
      formData.append('autoFragment', 'true');
      formData.append('fragmentMaxPerWindow', String(fragmentMaxPerWindow));
    }

    if (attachmentFiles && attachmentFiles.length > 0) {
      Array.from(attachmentFiles).forEach(f => formData.append('attachments', f));
    }

    if (source === 'group') formData.append('tag', selectedTag);
    if (source === 'sheet') formData.append('sheetUrl', sheetUrl);
    if (source === 'raw_text') formData.append('rawText', rawText);

    try {
      await axios.post(`${API_BASE}/campaigns`, formData);
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
    <div className="max-w-3xl glass-panel p-8 rounded-2xl animate-slide-up space-y-6">
      {/* Quick Action: Duplicate Previous Campaign Banner */}
      {campaigns && campaigns.length > 0 && duplicateCampaign && (
        <div className="p-4 bg-gradient-to-r from-emerald-950/40 via-slate-900 to-slate-900 border border-emerald-500/30 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-lg shadow-emerald-950/20">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0 border border-emerald-500/30">
              <Copy size={20} />
            </div>
            <div>
              <h4 className="text-sm font-bold text-white">Re-run or Duplicate Previous Campaign?</h4>
              <p className="text-xs text-slate-400">Clone your latest campaign, message template, and contacts with 1-click.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => duplicateCampaign()}
            className="px-4 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-emerald-500/20 flex items-center gap-2 shrink-0"
          >
            <Copy size={15} />
            <span>Duplicate Last Campaign</span>
          </button>
        </div>
      )}

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
          <div className="flex items-center justify-between flex-wrap gap-2">
            <label className="text-sm font-semibold text-slate-300">Message Template</label>
            <div className="flex items-center gap-2">
              <button 
                type="button" 
                onClick={() => onOpenSpintaxStudio && onOpenSpintaxStudio()}
                className="text-xs bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 border border-purple-500/35 font-semibold px-2.5 py-1 rounded-lg transition flex items-center gap-1 shadow-sm"
                title="Open Multi-Message Spintax Studio to auto-structure 2-5 message variations"
              >
                <Sparkles size={12}/> ✨ Spintax Studio
              </button>
              <button 
                type="button" 
                onClick={() => autoSpinCampaignText()}
                className="text-xs bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/30 font-semibold px-2.5 py-1 rounded-lg transition flex items-center gap-1"
                title="Auto-replace keywords with Spintax synonyms"
              >
                <RefreshCw size={11}/> Auto-Synonyms
              </button>
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
            rows={4}
            placeholder="Hello {{Name}}, thank you for choosing {{Company}}..."
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            className="w-full glass-input rounded-xl p-4 text-slate-200 text-sm font-sans leading-relaxed"
          />
          <span className="text-[10px] text-slate-500 block">Use &#123;&#123;Name&#125;&#125; or &#123;&#123;Company&#125;&#125; for automatic recipient replacement.</span>
        </div>

        {/* Multi-Device WhatsApp Load Balancing & Custom Account Selector */}
        <div className="p-5 bg-gradient-to-r from-slate-900/80 to-emerald-950/25 border border-emerald-500/25 rounded-2xl space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                <Smartphone size={18} className="text-emerald-400" />
              </div>
              <div>
                <label className="text-sm font-bold text-white block">Multi-Account Load Balancing &amp; Device Routing</label>
                <span className="text-[11px] text-slate-400">Distribute broadcast volume across multiple WhatsApp accounts to avoid spam flags</span>
              </div>
            </div>
            <span className="text-[10px] px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-400 font-bold uppercase border border-emerald-500/30 flex items-center gap-1">
              <Zap size={11} /> Anti-Ban Auto-Split
            </span>
          </div>

          {/* Mode Selector Tabs */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => setSessionMode('auto_split')}
              className={`p-3 rounded-xl border text-left transition-all ${
                sessionMode === 'auto_split'
                  ? 'bg-emerald-500/15 border-emerald-500 text-white shadow-md'
                  : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:bg-slate-900 hover:text-slate-200'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-bold text-emerald-400">⚡ Auto-Split All</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">{availableSessions.length} Profiles</span>
              </div>
              <p className="text-[10px] text-slate-400 leading-tight">Use all connected WhatsApp accounts evenly in parallel.</p>
            </button>

            <button
              type="button"
              onClick={() => setSessionMode('custom_subset')}
              className={`p-3 rounded-xl border text-left transition-all ${
                sessionMode === 'custom_subset'
                  ? 'bg-emerald-500/15 border-emerald-500 text-white shadow-md'
                  : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:bg-slate-900 hover:text-slate-200'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-bold text-cyan-400">🎯 Pick Specific Numbers</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-mono font-bold">{selectedSessions.length} Selected</span>
              </div>
              <p className="text-[10px] text-slate-400 leading-tight">Select specific 2, 3 or N numbers to load balance.</p>
            </button>

            <button
              type="button"
              onClick={() => {
                setSessionMode('single');
                if (Array.isArray(availableSessions) && availableSessions.length > 0 && (sessionName === 'auto_split' || !sessionName)) {
                  const firstSess = availableSessions.find(s => s && (s.status === 'CONNECTED' || s.status === 'Connected')) || availableSessions[0];
                  if (firstSess) {
                    setSessionName(firstSess.session_name || firstSess.name || 'default');
                  }
                }
              }}
              className={`p-3 rounded-xl border text-left transition-all ${
                sessionMode === 'single'
                  ? 'bg-emerald-500/15 border-emerald-500 text-white shadow-md'
                  : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:bg-slate-900 hover:text-slate-200'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-bold text-amber-400">📱 Single Number</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">1 Profile</span>
              </div>
              <p className="text-[10px] text-slate-400 leading-tight">Send entire campaign exclusively from one number.</p>
            </button>
          </div>

          {/* Conditional View: Custom Subset Multi-Number Selection */}
          {sessionMode === 'custom_subset' && (
            <div className="p-4 bg-slate-950/60 border border-slate-800 rounded-xl space-y-3 animate-fade-in">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-200">Select Numbers for Load Balancing Pool:</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 font-mono font-bold">
                    {selectedSessions.length} of {availableSessions.length} accounts active
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={selectAllSessions}
                    className="text-[11px] text-emerald-400 hover:text-emerald-300 font-semibold px-2 py-1 rounded bg-emerald-500/10 border border-emerald-500/20 transition"
                  >
                    Select All
                  </button>
                  <button
                    type="button"
                    onClick={deselectAllSessions}
                    className="text-[11px] text-slate-400 hover:text-slate-200 font-semibold px-2 py-1 rounded bg-slate-800 border border-slate-700 transition"
                  >
                    Clear
                  </button>
                </div>
              </div>

              {availableSessions.length === 0 ? (
                <div className="text-center py-6 text-slate-400 text-xs">
                  <Smartphone size={24} className="mx-auto mb-2 opacity-40 text-emerald-400" />
                  No WhatsApp profiles registered yet. Scan QR code in WhatsApp Sessions to link numbers.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-56 overflow-y-auto pr-1">
                  {availableSessions.map((s) => {
                    const sId = s.session_name || s.name;
                    const isSelected = selectedSessions.includes(sId);
                    const isConnected = s.status === 'CONNECTED' || s.status === 'AUTHENTICATED' || s.status === 'READY';
                    return (
                      <div
                        key={sId}
                        onClick={() => toggleSession(sId)}
                        className={`p-3 rounded-xl border cursor-pointer transition-all flex items-center justify-between gap-3 ${
                          isSelected
                            ? 'bg-emerald-500/10 border-emerald-500/50 shadow-sm'
                            : 'bg-slate-900/40 border-slate-800/80 hover:bg-slate-900 hover:border-slate-700 text-slate-400'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className={`w-5 h-5 rounded-md flex items-center justify-center border transition shrink-0 ${
                            isSelected 
                              ? 'bg-emerald-500 border-emerald-400 text-slate-950 font-bold' 
                              : 'bg-slate-800 border-slate-700 text-transparent'
                          }`}>
                            <Check size={14} />
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-white truncate">{sId}</p>
                            <p className="text-[11px] font-mono text-emerald-400 truncate">
                              {s.phone_number ? `+${s.phone_number}` : '📱 Number Linked'}
                            </p>
                          </div>
                        </div>
                        <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold uppercase shrink-0 border ${
                          isConnected 
                            ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' 
                            : 'bg-slate-800 text-slate-400 border-slate-700'
                        }`}>
                          {s.status || 'Active'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Dynamic Load Balancer Calculation Stats */}
              {selectedSessions.length > 0 && (
                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2 text-emerald-300">
                    <Zap size={15} className="text-emerald-400 shrink-0" />
                    <span>
                      <strong>Load Balancer:</strong> Each selected number will process <strong>{(100 / selectedSessions.length).toFixed(1)}%</strong> of campaign volume (~{Math.ceil(100 / selectedSessions.length)} msgs per account for 100 contacts).
                    </span>
                  </div>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono font-bold shrink-0">
                    {selectedSessions.length}x Parallel Workers
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Conditional View: Single Profile Selection Dropdown */}
          {sessionMode === 'single' && (
            <div className="space-y-2 animate-fade-in">
              <select
                value={sessionName}
                onChange={(e) => setSessionName(e.target.value)}
                className="w-full glass-input rounded-xl px-4 py-2.5 text-slate-200 text-sm"
              >
                {availableSessions.map((s) => (
                  <option key={s.id || s.session_name} value={s.session_name}>
                    📱 Profile: {s.session_name} {s.phone_number ? `(+${s.phone_number})` : ''} - {s.status || 'Active'}
                  </option>
                ))}
              </select>
              <span className="text-[11px] text-amber-400/90 block">
                ⚠️ Caution: Broadcasts all campaign contacts exclusively through single account '{sessionName}'. For large lists, Auto-Split is strongly recommended.
              </span>
            </div>
          )}

          {/* Auto-Split Informational Banner */}
          {sessionMode === 'auto_split' && (
            <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 text-xs text-slate-300 flex items-center justify-between gap-2 animate-fade-in">
              <span className="flex items-center gap-2">
                <ShieldCheck size={16} className="text-emerald-400 shrink-0" />
                <span>
                  🛡️ <strong>Recommended Safe Mode:</strong> Contacts will be automatically split evenly across all <strong>{availableSessions.length || 'active'}</strong> connected WhatsApp profiles in parallel.
                </span>
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-mono font-bold shrink-0">
                {availableSessions.length || 1}x Speed
              </span>
            </div>
          )}
        </div>

        {/* Anti-Ban: Auto-Fragment Campaign Across Time Windows */}
        <div className="p-4 bg-gradient-to-r from-slate-900/80 to-amber-950/20 border border-amber-500/20 rounded-xl space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-amber-500/10">
                <ShieldAlert size={16} className="text-amber-400" />
              </div>
              <div>
                <label className="text-sm font-bold text-white block">Auto-Fragment Campaign</label>
                <span className="text-[11px] text-slate-400">Split sending across morning, afternoon &amp; evening windows to avoid detection</span>
              </div>
            </div>
            <button
              onClick={() => setAutoFragment(!autoFragment)}
              className={`relative w-12 h-6 rounded-full transition-colors duration-200 flex-shrink-0 ${autoFragment ? 'bg-amber-500' : 'bg-slate-700'}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${autoFragment ? 'translate-x-6' : ''}`} />
            </button>
          </div>
          {autoFragment && (
            <div className="pt-2 border-t border-amber-500/15 space-y-2 animate-fade-in">
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <label className="text-[10px] text-slate-500 font-semibold uppercase">Max Messages Per Window</label>
                  <input
                    type="number" min={5} max={100}
                    value={fragmentMaxPerWindow}
                    onChange={e => setFragmentMaxPerWindow(Math.max(5, +e.target.value || 25))}
                    className="w-full glass-input rounded-lg px-3 py-1.5 text-slate-200 text-xs mt-1"
                  />
                </div>
                <div className="flex-1">
                  <label className="text-[10px] text-slate-500 font-semibold uppercase">Send Windows</label>
                  <div className="flex gap-1 mt-1">
                    {['🌅 9-12', '☀️ 1-5', '🌆 6-9'].map(w => (
                      <span key={w} className="text-[10px] px-2 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 font-mono">{w}</span>
                    ))}
                  </div>
                </div>
              </div>
              <p className="text-[10px] text-amber-400/70">⏰ Campaign will auto-pause between windows and resume in the next time slot. Messages spread across multiple days if needed.</p>
            </div>
          )}
        </div>

        {/* Campaign Schedule Launch Option */}
        <div className="p-4 bg-slate-900/40 border border-slate-800 rounded-xl space-y-2">
          <div className="flex items-center gap-2">
            <Calendar size={16} className="text-emerald-400" />
            <label className="text-sm font-semibold text-slate-300">Schedule Campaign Launch (Optional)</label>
          </div>
          <input
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
            className="w-full glass-input rounded-xl px-4 py-2.5 text-slate-200 text-sm"
          />
          <span className="text-[10px] text-slate-500 block">Leave blank to launch immediately upon submission.</span>
        </div>

        {/* Optional Multiple Attachments */}
        <div className="space-y-3 p-4 bg-slate-900/40 border border-slate-800 rounded-xl">
          <div className="flex items-center justify-between">
            <label className="text-sm font-semibold text-slate-300 block">Campaign Attachments (Images, Videos, or PDFs)</label>
            {((attachmentFiles && attachmentFiles.length > 0) || (attachmentPath && attachmentPath.trim())) && (
              <button
                type="button"
                onClick={clearAttachments}
                className="text-xs px-2.5 py-1 bg-rose-950/60 hover:bg-rose-900/80 border border-rose-800 text-rose-300 rounded-lg font-medium transition flex items-center gap-1"
              >
                <span>❌</span> Remove Attachment
              </button>
            )}
          </div>

          <div className="space-y-2">
            <span className="text-xs text-slate-400 font-medium block">Option A: Upload Files from Anywhere on Device</span>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx"
              onChange={(e) => setAttachmentFiles(e.target.files)}
              className="w-full text-xs text-slate-400 file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-emerald-500/20 file:text-emerald-400 hover:file:bg-emerald-500/30 cursor-pointer"
            />
            {attachmentFiles && attachmentFiles.length > 0 && (
              <div className="flex items-center justify-between bg-slate-800/60 p-2 rounded-lg border border-slate-700">
                <p className="text-xs text-emerald-400 font-semibold truncate max-w-[80%]">
                  ✓ {attachmentFiles.length} file(s) selected: {Array.from(attachmentFiles).map(f => f.name).join(', ')}
                </p>
                <button
                  type="button"
                  onClick={clearAttachments}
                  className="text-[11px] text-rose-400 hover:underline"
                >
                  Clear Files
                </button>
              </div>
            )}
          </div>

          <div className="space-y-1.5 pt-2 border-t border-slate-800/60">
            <span className="text-xs text-slate-400 font-medium block">Option B: Or Enter Full File Path from Anywhere on PC</span>
            <input
              type="text"
              placeholder="e.g. C:\Users\ayush\Desktop\brochure.pdf, D:\Documents\invoice.pdf"
              value={attachmentPath}
              onChange={(e) => setAttachmentPath(e.target.value)}
              className="w-full glass-input rounded-xl px-4 py-2.5 text-slate-200 text-xs font-mono"
            />
            <span className="text-[10px] text-slate-500 block">Enter absolute file paths from anywhere on your computer, or filenames from the attachments folder.</span>
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
// VIEW COMPONENT 2.5: SPINTAX MESSAGE FUSION STUDIO
// ============================================================================
function SpintaxStudioView({ onUseInCampaign }) {
  const [messages, setMessages] = useState([
    'Hello {{Name}}, check out our exclusive special discount for {{Company}} today!',
    'Hey {{Name}}, we have a limited-time offer for {{Company}} you won\'t want to miss!',
    'Greetings {{Name}}, special savings are waiting for you and {{Company}} right now!'
  ]);
  const [mode, setMode] = useState('full'); // 'full' (rotation) or 'sentence' (fused lines)
  const [structuredSpintax, setStructuredSpintax] = useState('');
  const [previewSamples, setPreviewSamples] = useState([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [copied, setCopied] = useState(false);

  // Auto-generate spintax whenever messages or mode changes
  const generateSpintax = async () => {
    const clean = messages.filter(m => (m || '').trim());
    if (clean.length === 0) {
      setStructuredSpintax('');
      setPreviewSamples([]);
      return;
    }
    try {
      setIsGenerating(true);
      const res = await axios.post(`${API_BASE}/anti-ban/spintax/combine`, {
        messages: clean,
        mode
      });
      if (res.data.success) {
        setStructuredSpintax(res.data.spintax);
        setPreviewSamples(res.data.samples || []);
      }
    } catch (e) {
      console.error('Error combining spintax:', e);
    } finally {
      setIsGenerating(false);
    }
  };

  useEffect(() => {
    generateSpintax();
  }, [messages, mode]);

  const updateMessage = (idx, value) => {
    const next = [...messages];
    next[idx] = value;
    setMessages(next);
  };

  const addMessage = () => {
    if (messages.length >= 8) return;
    setMessages([...messages, '']);
  };

  const removeMessage = (idx) => {
    if (messages.length <= 2) return;
    setMessages(messages.filter((_, i) => i !== idx));
  };

  const insertPlaceholderToMsg = (idx, ph) => {
    const next = [...messages];
    next[idx] = (next[idx] || '') + ` {{${ph}}}`;
    setMessages(next);
  };

  const handleCopy = () => {
    if (!structuredSpintax) return;
    navigator.clipboard.writeText(structuredSpintax);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const rollNewPreviews = async () => {
    if (!structuredSpintax) return;
    try {
      const samples = [];
      for (let i = 0; i < 5; i++) {
        const res = await axios.post(`${API_BASE}/anti-ban/spintax/test`, { text: structuredSpintax });
        samples.push(res.data.result || res.data.parsedText);
      }
      setPreviewSamples(samples);
    } catch (e) {
      console.warn('Notice: Failed to fetch spintax preview samples:', e.message);
    }
  };

  return (
    <div className="space-y-8 animate-slide-up max-w-5xl">
      {/* Header Banner */}
      <div className="glass-panel p-6 rounded-2xl border border-purple-500/20 bg-gradient-to-r from-purple-950/30 via-slate-900/40 to-emerald-950/20">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3.5">
            <div className="p-3 rounded-xl bg-purple-500/10 border border-purple-500/30 text-purple-400">
              <Sparkles size={24} />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white font-heading flex items-center gap-2">
                Spintax Multi-Variant Fusion Studio
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 font-bold uppercase border border-purple-500/30">
                  Anti-Ban Engine
                </span>
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                Insert 2, 3, 4, or 5 message variations — the engine automatically compiles the Spintax structure, provides live randomized delivery previews, and allows 1-click transfer to your campaign.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 bg-slate-900/80 p-1.5 rounded-xl border border-slate-800">
            <button
              type="button"
              onClick={() => setMode('full')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                mode === 'full'
                  ? 'bg-purple-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              🔄 Full Message Rotation
            </button>
            <button
              type="button"
              onClick={() => setMode('sentence')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                mode === 'sentence'
                  ? 'bg-purple-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              ⚡ Sentence &amp; Line Fusion
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column: Multi-Message Input Deck */}
        <div className="lg:col-span-7 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-white font-heading">Message Variations</span>
              <span className="text-xs text-purple-400 font-semibold">({messages.length} Variants)</span>
            </div>
            {messages.length < 8 && (
              <button
                type="button"
                onClick={addMessage}
                className="btn-primary text-xs py-1.5 px-3 flex items-center gap-1"
              >
                <Plus size={14} /> Add Message Variation
              </button>
            )}
          </div>

          <div className="space-y-4">
            {messages.map((msg, idx) => (
              <div key={idx} className="glass-card p-4 rounded-xl border border-slate-800 space-y-2.5 relative transition-all hover:border-purple-500/30">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-purple-500/20 text-purple-300 text-[11px] font-bold flex items-center justify-center border border-purple-500/30">
                      {idx + 1}
                    </span>
                    <span className="text-xs font-bold text-slate-300">Message Variation #{idx + 1}</span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => insertPlaceholderToMsg(idx, 'Name')}
                      className="text-[10px] bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold px-2 py-0.5 rounded border border-slate-700"
                    >
                      + Name
                    </button>
                    <button
                      type="button"
                      onClick={() => insertPlaceholderToMsg(idx, 'Company')}
                      className="text-[10px] bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold px-2 py-0.5 rounded border border-slate-700"
                    >
                      + Company
                    </button>
                    {messages.length > 2 && (
                      <button
                        type="button"
                        onClick={() => removeMessage(idx)}
                        className="text-rose-400 hover:text-rose-300 p-1 hover:bg-rose-500/10 rounded transition"
                        title="Remove Variation"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </div>

                <textarea
                  rows={3}
                  value={msg}
                  onChange={(e) => updateMessage(idx, e.target.value)}
                  placeholder={`Write variation #${idx + 1}... e.g. Hello {{Name}}, check out our deals!`}
                  className="w-full glass-input rounded-xl p-3 text-slate-200 text-xs font-sans leading-relaxed"
                />

                <div className="flex items-center justify-between text-[10px] text-slate-500">
                  <span>Characters: {(msg || '').length}</span>
                  <span>{mode === 'full' ? 'Will rotate as full message' : 'Lines will fuse with corresponding lines'}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right Column: Structured Output & Simulator */}
        <div className="lg:col-span-5 space-y-6">
          {/* Structured Spintax Code Box */}
          <div className="glass-panel p-5 rounded-2xl border border-slate-800 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles size={16} className="text-purple-400" />
                <span className="text-xs font-bold uppercase tracking-wider text-slate-300">Generated Spintax Structure</span>
              </div>
              <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-bold">
                ✓ Ready to Copy
              </span>
            </div>

            <div className="relative">
              <textarea
                rows={6}
                readOnly
                value={structuredSpintax}
                className="w-full bg-slate-950 border border-slate-800 text-purple-300 text-xs font-mono p-3.5 rounded-xl leading-relaxed focus:outline-none select-all"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={handleCopy}
                disabled={!structuredSpintax}
                className={`flex-1 py-2.5 px-4 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 border ${
                  copied 
                    ? 'bg-emerald-600 text-white border-emerald-500 shadow-md shadow-emerald-500/20' 
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                }`}
              >
                {copied ? <Check size={14} /> : <Clipboard size={14} />}
                <span>{copied ? '✓ Copied to Clipboard!' : 'Copy Spintax Structure'}</span>
              </button>

              {onUseInCampaign && (
                <button
                  type="button"
                  onClick={() => onUseInCampaign(structuredSpintax)}
                  disabled={!structuredSpintax}
                  className="btn-primary py-2.5 px-4 text-xs font-bold flex items-center justify-center gap-1.5"
                >
                  <Send size={13} />
                  <span>Use in Campaign</span>
                </button>
              )}
            </div>
          </div>

          {/* Live Sample Previews Simulator */}
          <div className="glass-panel p-5 rounded-2xl border border-slate-800 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Activity size={16} className="text-emerald-400" />
                <span className="text-xs font-bold uppercase tracking-wider text-slate-300">Live Delivery Simulation</span>
              </div>
              <button
                type="button"
                onClick={rollNewPreviews}
                className="text-[11px] text-cyan-400 hover:text-cyan-300 hover:underline flex items-center gap-1"
              >
                <RefreshCw size={11} /> Roll New Samples
              </button>
            </div>

            <p className="text-[11px] text-slate-400">
              Here is how WhatsApp recipients will see randomized messages in real-time:
            </p>

            <div className="space-y-2.5 max-h-[260px] overflow-y-auto pr-1">
              {previewSamples.length === 0 ? (
                <p className="text-xs text-slate-500 italic p-3 text-center">Type variations above to see simulated outputs.</p>
              ) : (
                previewSamples.map((sample, idx) => {
                  const names = ['John Doe', 'Sarah Connor', 'David Miller', 'Priya Sharma', 'Carlos Gomez'];
                  const companies = ['Acme Corp', 'Apex Global', 'Zenith Ltd', 'Starlight Inc', 'Innovate LLC'];
                  const rendered = sample
                    .replace(/{{\s*name\s*}}/gi, names[idx % names.length])
                    .replace(/{{\s*company\s*}}/gi, companies[idx % companies.length]);

                  return (
                    <div key={idx} className="p-3 bg-slate-900/70 border border-slate-800 rounded-xl space-y-1">
                      <div className="flex items-center justify-between text-[10px] text-slate-400">
                        <span className="font-bold text-emerald-400">Sample #{idx + 1} (Recipient: {names[idx % names.length]})</span>
                        <span className="text-slate-500">Live Spun</span>
                      </div>
                      <p className="text-xs text-slate-200 leading-relaxed font-sans">{rendered}</p>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// VIEW COMPONENT 3: CONTACTS QUEUE
// ============================================================================
function ContactsView({ campaignId, contacts, duplicateCampaign, onFilterChange }) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');

  // Handle updates in filter state with debounce to prevent race conditions
  useEffect(() => {
    const handler = setTimeout(() => {
      onFilterChange(search, status);
    }, 300);
    return () => clearTimeout(handler);
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
      <div className="flex flex-col sm:flex-row gap-4 justify-between items-stretch sm:items-center bg-slate-900/40 p-4 border border-slate-900 rounded-xl">
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

        <div className="flex items-center gap-3">
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

          {duplicateCampaign && (
            <button
              type="button"
              onClick={() => duplicateCampaign(campaignId)}
              className="px-4 py-2 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 hover:text-emerald-300 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 shrink-0"
              title="Duplicate this campaign and its contacts into a new pending campaign"
            >
              <Copy size={14} />
              <span>Duplicate</span>
            </button>
          )}
        </div>
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
  const [delay, setDelay] = useState('8');
  const [minDelay, setMinDelay] = useState('8');
  const [maxDelay, setMaxDelay] = useState('45');
  const [burstInterval, setBurstInterval] = useState('20');
  const [burstDuration, setBurstDuration] = useState('120');
  const [enableSmartRateLimiter, setEnableSmartRateLimiter] = useState(true);
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
    if (settings.delay_seconds) setDelay(String(settings.delay_seconds));
    if (settings.min_delay_seconds || settings.min_delay || settings.minDelaySeconds) {
      setMinDelay(String(settings.min_delay_seconds || settings.min_delay || settings.minDelaySeconds));
    }
    if (settings.max_delay_seconds || settings.max_delay || settings.maxDelaySeconds) {
      setMaxDelay(String(settings.max_delay_seconds || settings.max_delay || settings.maxDelaySeconds));
    }
    if (settings.burst_interval_messages || settings.burstRestAfter) {
      setBurstInterval(String(settings.burst_interval_messages || settings.burstRestAfter));
    }
    if (settings.burst_pause_seconds !== undefined || settings.burstRestDuration !== undefined) {
      setBurstDuration(String(settings.burst_pause_seconds !== undefined ? settings.burst_pause_seconds : settings.burstRestDuration));
    }
    if (settings.enable_smart_rate_limiter !== undefined) {
      setEnableSmartRateLimiter(settings.enable_smart_rate_limiter === 'true' || settings.enable_smart_rate_limiter === true);
    } else if (settings.rateLimiterEnabled !== undefined) {
      setEnableSmartRateLimiter(settings.rateLimiterEnabled === true || settings.rateLimiterEnabled === 'true');
    }
    if (settings.max_retries) setMaxRetries(String(settings.max_retries));
    if (settings.default_country_code) setDefaultCountryCode(String(settings.default_country_code));
    if (settings.headless !== undefined) setHeadless(settings.headless === 'true' || settings.headless === true);
    if (settings.default_attachments_dir) setAttachmentsDir(String(settings.default_attachments_dir));
    if (settings.enable_notifications) setEnableNotifications(settings.enable_notifications === 'true' || settings.enable_notifications === true);
    if (settings.keep_browser_open_after_campaign !== undefined) setKeepBrowserOpen(settings.keep_browser_open_after_campaign === 'true' || settings.keep_browser_open_after_campaign === true);
  }, [settings]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSaving(true);
    setStatusMessage(null);

    try {
      await axios.post(`${API_BASE}/settings`, {
        delay_seconds: delay,
        min_delay_seconds: minDelay,
        min_delay: minDelay,
        minDelaySeconds: minDelay,
        max_delay_seconds: maxDelay,
        max_delay: maxDelay,
        maxDelaySeconds: maxDelay,
        burst_interval_messages: burstInterval,
        burstRestAfter: burstInterval,
        burst_pause_seconds: burstDuration,
        burstRestDuration: burstDuration,
        enable_smart_rate_limiter: enableSmartRateLimiter ? 'true' : 'false',
        rateLimiterEnabled: enableSmartRateLimiter,
        max_retries: maxRetries,
        default_country_code: defaultCountryCode,
        headless: headless ? 'true' : 'false',
        default_attachments_dir: attachmentsDir,
        enable_notifications: enableNotifications ? 'true' : 'false',
        keep_browser_open_after_campaign: keepBrowserOpen ? 'true' : 'false'
      });
      if (onSave) onSave();
      setStatusMessage({ type: 'success', text: 'System configuration & rate limiter saved successfully.' });
    } catch (error) {
      console.error(error);
      setStatusMessage({ type: 'error', text: `Failed to save settings: ${error.message}` });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="max-w-4xl glass-panel p-8 rounded-2xl animate-fade-in">
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

        {/* Smart Rate Limiter Section */}
        <div className="p-5 rounded-2xl bg-slate-900/40 border border-slate-800 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-purple-500/10"><Zap className="text-purple-400" size={16}/></div>
              <div>
                <p className="text-sm font-bold text-white">Smart Rate Limiter</p>
                <p className="text-[11px] text-slate-500">Human-Like Jitter &amp; Rest Breaks</p>
              </div>
            </div>
            <button 
              type="button" 
              onClick={() => setEnableSmartRateLimiter(!enableSmartRateLimiter)} 
              className={`relative w-12 h-6 rounded-full transition-colors duration-200 flex-shrink-0 ${enableSmartRateLimiter ? 'bg-emerald-500' : 'bg-slate-700'}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${enableSmartRateLimiter ? 'translate-x-6' : ''}`} />
            </button>
          </div>
          <p className="text-xs text-slate-400">Randomized delays between minimum and maximum bounds with automatic rest pause breaks.</p>
          
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t border-slate-800/80">
            <div>
              <label className="text-[10px] text-slate-500 font-semibold uppercase">Min Delay (s)</label>
              <input 
                type="number" 
                min="1" 
                max="300" 
                value={minDelay} 
                onChange={e => setMinDelay(e.target.value)} 
                className="w-full glass-input rounded-lg px-2.5 py-1.5 text-slate-200 text-xs mt-1"
              />
            </div>
            <div>
              <label className="text-[10px] text-slate-500 font-semibold uppercase">Max Delay (s)</label>
              <input 
                type="number" 
                min="1" 
                max="300" 
                value={maxDelay} 
                onChange={e => setMaxDelay(e.target.value)} 
                className="w-full glass-input rounded-lg px-2.5 py-1.5 text-slate-200 text-xs mt-1"
              />
            </div>
            <div>
              <label className="text-[10px] text-slate-500 font-semibold uppercase">Rest After (msgs)</label>
              <input 
                type="number" 
                min="1" 
                max="500" 
                value={burstInterval} 
                onChange={e => setBurstInterval(e.target.value)} 
                className="w-full glass-input rounded-lg px-2.5 py-1.5 text-slate-200 text-xs mt-1"
              />
            </div>
            <div>
              <label className="text-[10px] text-slate-500 font-semibold uppercase">Rest Duration (s)</label>
              <input 
                type="number" 
                min="5" 
                max="3600" 
                value={burstDuration} 
                onChange={e => setBurstDuration(e.target.value)} 
                className="w-full glass-input rounded-lg px-2.5 py-1.5 text-slate-200 text-xs mt-1"
              />
            </div>
          </div>
        </div>

        {/* Horizontal Grid for Campaign Dispatch Inputs */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Fallback Fixed Delay Selection */}
          <div className="space-y-1.5 p-4 rounded-xl bg-slate-900/40 border border-slate-800/80">
            <label className="text-xs font-semibold text-slate-300 block">Base Fallback Delay (Seconds)</label>
            <input
              type="number"
              min="0"
              max="120"
              required
              value={delay}
              onChange={(e) => setDelay(e.target.value)}
              className="w-full glass-input rounded-lg px-3 py-2 text-slate-200 text-sm"
            />
            <span className="text-[10px] text-slate-500 block">Fallback fixed delay used if Smart Rate Limiter is toggled off.</span>
          </div>

          {/* Default Country Code */}
          <div className="space-y-1.5 p-4 rounded-xl bg-slate-900/40 border border-slate-800/80">
            <label className="text-xs font-semibold text-slate-300 block">Default Country Code (e.g. 91)</label>
            <input
              type="text"
              required
              placeholder="e.g. 91"
              value={defaultCountryCode}
              onChange={(e) => setDefaultCountryCode(e.target.value)}
              className="w-full glass-input rounded-lg px-3 py-2 text-slate-200 text-sm"
            />
            <span className="text-[10px] text-slate-500 block">Prepended to numbers missing country code prefixes.</span>
          </div>

          {/* Max Retries */}
          <div className="space-y-1.5 p-4 rounded-xl bg-slate-900/40 border border-slate-800/80">
            <label className="text-xs font-semibold text-slate-300 block">Automation Retry Limit</label>
            <input
              type="number"
              min="0"
              max="5"
              required
              value={maxRetries}
              onChange={(e) => setMaxRetries(e.target.value)}
              className="w-full glass-input rounded-lg px-3 py-2 text-slate-200 text-sm"
            />
            <span className="text-[10px] text-slate-500 block">Attempts to retry message before marking contact failed.</span>
          </div>

          {/* Default Attachment Folder */}
          <div className="space-y-1.5 p-4 rounded-xl bg-slate-900/40 border border-slate-800/80">
            <label className="text-xs font-semibold text-slate-300 block">Default Attachments Folder</label>
            <input
              type="text"
              required
              value={attachmentsDir}
              onChange={(e) => setAttachmentsDir(e.target.value)}
              className="w-full glass-input rounded-lg px-3 py-2 text-slate-200 text-xs font-mono"
            />
            <span className="text-[10px] text-slate-500 block">Local folder for documents, PDFs, or image files.</span>
          </div>
        </div>

        {/* Browser & Execution Behavior Toggles (Horizontal 3-Column Grid) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* Keep Browser Open checkbox */}
          <div className="flex items-start gap-3 bg-slate-900/40 border border-slate-800/80 rounded-xl p-3.5">
            <input
              id="keepBrowserOpenMode"
              type="checkbox"
              checked={keepBrowserOpen}
              onChange={(e) => setKeepBrowserOpen(e.target.checked)}
              className="w-4 h-4 mt-0.5 text-emerald-600 bg-slate-900 border-slate-800 rounded focus:ring-emerald-500 shrink-0 cursor-pointer"
            />
            <div>
              <label htmlFor="keepBrowserOpenMode" className="text-xs font-bold text-slate-200 block cursor-pointer">Keep Window Open</label>
              <span className="text-[10px] text-slate-500 leading-tight block mt-0.5">Leaves WhatsApp Web open after campaign completion.</span>
            </div>
          </div>

          {/* Headless Browser checkbox */}
          <div className="flex items-start gap-3 bg-slate-900/40 border border-slate-800/80 rounded-xl p-3.5">
            <input
              id="headlessMode"
              type="checkbox"
              checked={headless}
              onChange={(e) => setHeadless(e.target.checked)}
              className="w-4 h-4 mt-0.5 text-emerald-600 bg-slate-900 border-slate-800 rounded focus:ring-emerald-500 shrink-0 cursor-pointer"
            />
            <div>
              <label htmlFor="headlessMode" className="text-xs font-bold text-slate-200 block cursor-pointer">Headless Browser</label>
              <span className="text-[10px] text-slate-500 leading-tight block mt-0.5">Runs in background without visible window.</span>
            </div>
          </div>

          {/* Notification checkbox */}
          <div className="flex items-start gap-3 bg-slate-900/40 border border-slate-800/80 rounded-xl p-3.5">
            <input
              id="notify"
              type="checkbox"
              checked={enableNotifications}
              onChange={(e) => setEnableNotifications(e.target.checked)}
              className="w-4 h-4 mt-0.5 text-emerald-600 bg-slate-900 border-slate-800 rounded focus:ring-emerald-500 shrink-0 cursor-pointer"
            />
            <div>
              <label htmlFor="notify" className="text-xs font-bold text-slate-200 block cursor-pointer">Audio & Scan Alerts</label>
              <span className="text-[10px] text-slate-500 leading-tight block mt-0.5">Triggers visual and audio alerts when QR scans are needed.</span>
            </div>
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
// VIEW COMPONENT: PRO DESKTOP LICENSE MANAGER
// ============================================================================
function ProDesktopLicenseManager() {
  const [machineId, setMachineId] = useState('');
  const [licenseStatus, setLicenseStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [inputKey, setInputKey] = useState('');
  const [activating, setActivating] = useState(false);
  const [activationMsg, setActivationMsg] = useState(null);
  const [copied, setCopied] = useState(false);

  const fetchLicenseData = async () => {
    try {
      // 1. Get Hardware Machine ID
      let mId = '';
      if (window.electronAPI?.getMachineId) {
        try {
          const res = await window.electronAPI.getMachineId();
          if (res?.machineId) mId = res.machineId;
        } catch (_e) {}
      }
      if (!mId) {
        const res = await axios.get(`${API_BASE}/license/machine-id`);
        if (res.data?.machineId) mId = res.data.machineId;
      }
      setMachineId(mId);

      // 2. Get License Status
      const statusRes = await axios.get(`${API_BASE}/license/status`);
      setLicenseStatus(statusRes.data);
    } catch (err) {
      console.error('Error fetching license info:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLicenseData();
  }, []);

  const handleCopyMachineId = () => {
    if (!machineId) return;
    navigator.clipboard.writeText(machineId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleActivate = async (e) => {
    e.preventDefault();
    if (!inputKey.trim()) return;
    setActivating(true);
    setActivationMsg(null);
    try {
      let result;
      if (window.electronAPI?.activateLicense) {
        result = await window.electronAPI.activateLicense(inputKey.trim());
      } else {
        const res = await axios.post(`${API_BASE}/license/activate`, { licenseKey: inputKey.trim() });
        result = res.data;
      }

      if (result.success || result.activated) {
        setActivationMsg({ success: true, text: result.message || 'License activated successfully! Full Pro desktop suite unlocked.' });
        setInputKey('');
        await fetchLicenseData();
      } else {
        setActivationMsg({ success: false, text: result.error || 'Activation failed. Please verify your license key.' });
      }
    } catch (err) {
      setActivationMsg({ success: false, text: err.response?.data?.error || err.message || 'Activation failed.' });
    } finally {
      setActivating(false);
    }
  };

  return (
    <div className="glass-card p-6 rounded-2xl border border-emerald-500/20 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4 border-b border-slate-800 pb-4">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <ShieldCheck size={24} />
          </div>
          <div>
            <h4 className="text-base font-bold text-white font-heading">Pro Desktop License &amp; Node-Locking</h4>
            <p className="text-xs text-slate-400">Cryptographically verified hardware node-lock &amp; offline lease management</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {licenseStatus?.activated ? (
            <span className="px-3 py-1 text-xs font-bold uppercase rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1.5">
              <Check size={14} /> Activated Pro License
            </span>
          ) : (
            <span className="px-3 py-1 text-xs font-bold uppercase rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center gap-1.5">
              <AlertTriangle size={14} /> Trial / Unactivated
            </span>
          )}
        </div>
      </div>

      {/* License & Hardware Details Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
        <div className="p-3.5 bg-slate-900/60 border border-slate-800 rounded-xl space-y-1">
          <span className="text-slate-400 uppercase font-semibold text-[10px]">Hardware Machine ID</span>
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-emerald-400 truncate text-xs font-bold">{machineId || 'Detecting...'}</span>
            <button
              type="button"
              onClick={handleCopyMachineId}
              title="Copy Machine ID"
              className="p-1 hover:bg-slate-800 text-slate-400 hover:text-white rounded transition"
            >
              {copied ? <Check size={14} className="text-emerald-400" /> : <Clipboard size={14} />}
            </button>
          </div>
        </div>

        <div className="p-3.5 bg-slate-900/60 border border-slate-800 rounded-xl space-y-1">
          <span className="text-slate-400 uppercase font-semibold text-[10px]">License Customer / Plan</span>
          <p className="font-bold text-slate-200 truncate">
            {licenseStatus?.license?.customer ? `${licenseStatus.license.customer}` : 'Pro Desktop Edition'}
          </p>
        </div>

        <div className="p-3.5 bg-slate-900/60 border border-slate-800 rounded-xl space-y-1">
          <span className="text-slate-400 uppercase font-semibold text-[10px]">Hardware Lock Status</span>
          <p className="font-bold text-emerald-400 flex items-center gap-1">
            <Shield size={12} /> Bound to Machine (Ed25519)
          </p>
        </div>

        <div className="p-3.5 bg-slate-900/60 border border-slate-800 rounded-xl space-y-1">
          <span className="text-slate-400 uppercase font-semibold text-[10px]">Offline Lease Period</span>
          <p className="font-bold text-slate-200">
            {licenseStatus?.daysRemaining ? `${licenseStatus.daysRemaining} Days Remaining` : 'Active Lease'}
            {licenseStatus?.isGracePeriod && <span className="text-amber-400 ml-1">(Grace Period)</span>}
          </p>
        </div>
      </div>

      {/* Activation Input Form */}
      <form onSubmit={handleActivate} className="pt-2 border-t border-slate-800/80 space-y-3">
        <label className="text-xs font-semibold text-slate-300 block uppercase">
          Activate License Key (WALIC...)
        </label>
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            required
            placeholder="Paste your Ed25519 signed license token (e.g. WALIC.ey...)"
            value={inputKey}
            onChange={e => setInputKey(e.target.value)}
            className="flex-1 glass-input rounded-xl px-4 py-2.5 text-slate-200 text-xs font-mono"
          />
          <button
            type="submit"
            disabled={activating || !inputKey.trim()}
            className="btn-primary px-6 py-2.5 text-xs font-semibold whitespace-nowrap"
          >
            {activating ? (
              <><RefreshCw className="animate-spin" size={14} /> Activating...</>
            ) : (
              <><ShieldCheck size={14} /> Activate License</>
            )}
          </button>
        </div>

        {activationMsg && (
          <div className={`p-3 rounded-xl text-xs flex items-center gap-2 ${
            activationMsg.success 
              ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400' 
              : 'bg-rose-500/10 border border-rose-500/30 text-rose-400'
          }`}>
            {activationMsg.success ? <CheckCircle size={16} /> : <XCircle size={16} />}
            <span>{activationMsg.text}</span>
          </div>
        )}
      </form>
    </div>
  );
}

// ============================================================================
// VIEW COMPONENT 5c: SAAS TEAM & SEAT MANAGEMENT
// ============================================================================
function TeamManagementView() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  const [inviting, setInviting] = useState(false);
  const [inviteResult, setInviteResult] = useState(null);
  const [newSeatLimit, setNewSeatLimit] = useState(5);
  const [scaling, setScaling] = useState(false);
  const [msg, setMsg] = useState(null);

  const fetchOrg = async () => {
    try {
      const res = await axios.get(`${API_BASE}/saas/organization`);
      setData(res.data);
      if (res.data.organization?.seat_limit) {
        setNewSeatLimit(res.data.organization.seat_limit);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrg();
  }, []);

  const handleInvite = async (e) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setInviting(true);
    setInviteResult(null);
    setMsg(null);
    try {
      const res = await axios.post(`${API_BASE}/saas/organization/invite`, { email: inviteEmail, role: inviteRole });
      setInviteResult(res.data);
      setInviteEmail('');
      fetchOrg();
    } catch (err) {
      setMsg({ ok: false, text: err.response?.data?.error || err.message });
    } finally {
      setInviting(false);
    }
  };

  const handleRevokeMember = async (memberUserId) => {
    if (!confirm('Revoke this team member seat slot?')) return;
    try {
      await axios.delete(`${API_BASE}/saas/organization/members/${memberUserId}`);
      setMsg({ ok: true, text: 'Member seat revoked.' });
      fetchOrg();
    } catch (err) {
      setMsg({ ok: false, text: err.response?.data?.error || err.message });
    }
  };

  const handleCancelInvite = async (inviteId) => {
    try {
      await axios.delete(`${API_BASE}/saas/organization/invites/${inviteId}`);
      fetchOrg();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleUpdateSeats = async () => {
    setScaling(true);
    setMsg(null);
    try {
      const res = await axios.post(`${API_BASE}/saas/organization/update-seats`, { seat_limit: newSeatLimit });
      setMsg({ ok: true, text: res.data.message });
      fetchOrg();
    } catch (err) {
      setMsg({ ok: false, text: err.response?.data?.error || err.message });
    } finally {
      setScaling(false);
    }
  };

  if (loading) {
    return <div className="p-12 text-center text-slate-500"><RefreshCw className="animate-spin mx-auto mb-2" size={24}/>Loading Team Seats...</div>;
  }

  const org = data?.organization || {};
  const usedSeats = data?.used_seats || 1;
  const seatLimit = org.seat_limit || 5;
  const pct = Math.min(100, Math.round((usedSeats / seatLimit) * 100));

  return (
    <div className="space-y-6 animate-slide-up">
      {/* Header Banner */}
      <div className="glass-panel p-6 rounded-2xl border border-emerald-500/20">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
              <Users size={28} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-xl font-bold text-white font-heading">{org.name || 'Workspace'}</h3>
                <span className="px-2.5 py-0.5 text-[10px] font-bold uppercase bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-full">
                  {org.plan_tier?.toUpperCase() || 'PRO DESKTOP'} PLAN
                </span>
              </div>
              <p className="text-sm text-slate-400">Standalone Desktop Workspace &amp; Team Management Hub</p>
            </div>
          </div>

          <div className="flex items-center gap-6">
            <div className="text-right">
              <span className="text-[11px] text-slate-400 uppercase font-semibold">License Status</span>
              <p className="text-sm font-bold text-emerald-400 font-heading">✓ Active Pro Desktop License</p>
            </div>
          </div>
        </div>

        {/* Seat Usage Progress Gauge */}
        <div className="mt-6 pt-4 border-t border-slate-800/80 space-y-2">
          <div className="flex items-center justify-between text-xs font-semibold">
            <span className="text-slate-300">Active Seat Occupancy</span>
            <span className="text-emerald-400 font-mono">{usedSeats} of {seatLimit} Seats Occupied ({pct}%)</span>
          </div>
          <div className="w-full h-3 bg-slate-900 rounded-full overflow-hidden border border-slate-800">
            <div 
              className={`h-full transition-all duration-500 ${pct >= 100 ? 'bg-rose-500' : pct >= 80 ? 'bg-amber-500' : 'bg-emerald-500'}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      </div>

      {msg && (
        <div className={`p-4 border rounded-xl flex items-center gap-3 text-sm ${msg.ok ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400' : 'bg-rose-500/10 border-rose-500/25 text-rose-400'}`}>
          {msg.ok ? <CheckCircle size={18}/> : <XCircle size={18}/>}
          <span>{msg.text}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Invite Team Member Card */}
        <div className="glass-card p-6 rounded-2xl border border-slate-800 space-y-4 lg:col-span-1">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400"><Plus size={18}/></div>
            <div>
              <h4 className="text-base font-bold text-white">Invite Team Member</h4>
              <p className="text-xs text-slate-400">Add seats to your workspace roster</p>
            </div>
          </div>

          <form onSubmit={handleInvite} className="space-y-3 pt-2 border-t border-slate-800">
            <div>
              <label className="text-xs font-semibold text-slate-400 uppercase">Team Member Email</label>
              <input
                type="email"
                required
                placeholder="colleague@company.com"
                value={inviteEmail}
                onChange={e => setInviteEmail(e.target.value)}
                className="w-full glass-input rounded-xl px-3 py-2 text-slate-200 text-sm mt-1"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-400 uppercase">Seat Role</label>
              <select
                value={inviteRole}
                onChange={e => setInviteRole(e.target.value)}
                className="w-full glass-input rounded-xl px-3 py-2 text-slate-200 text-sm mt-1 bg-slate-900"
              >
                <option value="member">Member (Campaign &amp; Messaging Access)</option>
                <option value="admin">Admin (Full Workspace Management)</option>
              </select>
            </div>

            <button
              type="submit"
              disabled={inviting || usedSeats >= seatLimit}
              className="btn-primary w-full py-2.5 text-xs font-semibold"
            >
              {inviting ? <><RefreshCw className="animate-spin" size={14}/> Inviting...</> : <><Plus size={14}/> Issue Seat Invitation</>}
            </button>

            {usedSeats >= seatLimit && (
              <p className="text-xs text-amber-400 text-center font-medium">⚠️ Seat limit reached. Scale seat capacity below to invite more users.</p>
            )}
          </form>

          {inviteResult && (
            <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl space-y-2 text-xs">
              <p className="font-bold text-emerald-400">✓ {inviteResult.message}</p>
              <p className="text-slate-400">Shareable Invite Token Link:</p>
              <input 
                readOnly 
                value={inviteResult.inviteLink || inviteResult.inviteToken} 
                onClick={e => e.target.select()}
                className="w-full bg-slate-900 p-2 rounded text-slate-200 font-mono text-[10px]"
              />
            </div>
          )}

          {/* Scale Seats Capacity Box */}
          {org.user_role === 'owner' && (
            <div className="pt-4 border-t border-slate-800 space-y-3">
              <label className="text-xs font-bold text-slate-300 block uppercase">Scale Workspace Seats</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={newSeatLimit}
                  onChange={e => setNewSeatLimit(+e.target.value || 1)}
                  className="flex-1 glass-input rounded-xl px-3 py-2 text-slate-200 text-sm"
                />
                <button
                  type="button"
                  onClick={handleUpdateSeats}
                  disabled={scaling}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-bold transition"
                >
                  {scaling ? 'Updating...' : 'Update Seats'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Active Team Roster & Invites Table */}
        <div className="glass-panel p-6 rounded-2xl border border-slate-800 space-y-6 lg:col-span-2">
          <div>
            <h4 className="text-base font-bold text-white mb-1">Active Seat Roster ({data?.members?.length || 0})</h4>
            <p className="text-xs text-slate-400">Users occupying active seats in this commercial workspace.</p>
          </div>

          <div className="space-y-3">
            {(data?.members || []).map((m) => (
              <div key={m.user_id} className="flex items-center justify-between p-4 bg-slate-900/60 border border-slate-800 rounded-xl">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-emerald-500/20 text-emerald-400 font-bold flex items-center justify-center border border-emerald-500/30">
                    {m.name ? m.name.charAt(0).toUpperCase() : 'U'}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-bold text-white">{m.name}</p>
                      <span className={`px-2 py-0.5 text-[10px] font-bold uppercase rounded-full border ${
                        m.role === 'owner' ? 'bg-purple-500/20 text-purple-400 border-purple-500/30' : 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                      }`}>
                        {m.role}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400">{m.email}</p>
                  </div>
                </div>

                {org.user_role === 'owner' && m.user_id !== org.owner_id && (
                  <button
                    onClick={() => handleRevokeMember(m.user_id)}
                    className="px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 rounded-lg text-xs font-semibold transition"
                  >
                    Revoke Seat
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Pending Invites */}
          {(data?.pending_invites || []).length > 0 && (
            <div className="pt-4 border-t border-slate-800 space-y-3">
              <h5 className="text-sm font-bold text-amber-400">Pending Seat Invites ({(data?.pending_invites || []).length})</h5>
              <div className="space-y-2">
                {data.pending_invites.map((inv) => (
                  <div key={inv.id} className="flex items-center justify-between p-3 bg-amber-500/5 border border-amber-500/20 rounded-xl text-xs">
                    <div>
                      <p className="font-semibold text-slate-200">{inv.email}</p>
                      <p className="text-[10px] text-slate-400 font-mono">Token: {inv.token}</p>
                    </div>
                    <button
                      onClick={() => handleCancelInvite(inv.id)}
                      className="text-rose-400 hover:text-rose-300 font-semibold"
                    >
                      Cancel Invite
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Pro Desktop License Manager & Hardware Node-Locking */}
      <ProDesktopLicenseManager />
    </div>
  );
}

// ============================================================================
// VIEW COMPONENT 5b: ANTI-BAN PROTECTION SUITE
// ============================================================================
function AntiBanSuiteView({ settings, onSave }) {
  const [cfg, setCfg] = useState({
    bypassAllSafety: false,
    delaySeconds: 1,
    spintaxEnabled: true,
    warmupEnabled: true,
    healthMonitorEnabled: true,
    rateLimiterEnabled: true,
    engagementBreakerEnabled: true,
    humanSimulationEnabled: true,
    riskScoringEnabled: true,
    deepDiversificationEnabled: true,
    cooldownEnforcementEnabled: true,
    nightQuietEnabled: false,
    nightQuietStart: '23',
    nightQuietEnd: '7',
    warmupDay1: 25,
    warmupDay2: 50,
    warmupDay3: 75,
    warmupDay7: 100,
    healthPauseThreshold: 30,
    minDelaySeconds: 8,
    maxDelaySeconds: 45,
    burstRestAfter: 20,
    burstRestDuration: 120,
  });
  const [blacklist, setBlacklist] = useState([]);
  const [newNum, setNewNum] = useState('');
  const [tmpl, setTmpl] = useState('{Hello|Hi|Hey} {friend|there}! {How are you|Hope you are well}?');
  const [tmplResult, setTmplResult] = useState('');
  const [health, setHealth] = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [reputations, setReputations] = useState([]);
  const [engagement, setEngagement] = useState(null);

  const fetchAntiBanData = () => {
    axios.get(`${API_BASE}/anti-ban/settings`).then(r => {
      const d = r.data?.settings || r.data || {};
      setCfg(p => ({
        ...p,
        bypassAllSafety: d.bypass_all_safety === 'true' || d.bypass_all_safety === true || d.turbo_blast_mode === 'true' || d.turbo_blast_mode === true,
        delaySeconds: parseInt(d.delay_seconds || settings?.delay_seconds || p.delaySeconds) || 1,
        spintaxEnabled: d.enable_spintax !== undefined ? (d.enable_spintax === 'true' || d.enable_spintax === true) : (r.data?.spintaxEnabled ?? p.spintaxEnabled),
        warmupEnabled: d.enable_number_warmup !== undefined ? (d.enable_number_warmup === 'true' || d.enable_number_warmup === true) : (d.warmup_enabled !== undefined ? (d.warmup_enabled === 'true' || d.warmup_enabled === true) : (r.data?.warmupEnabled ?? p.warmupEnabled)),
        healthMonitorEnabled: d.enable_health_monitoring !== undefined ? (d.enable_health_monitoring === 'true' || d.enable_health_monitoring === true) : (r.data?.healthMonitorEnabled ?? p.healthMonitorEnabled),
        rateLimiterEnabled: d.enable_smart_rate_limiter !== undefined ? (d.enable_smart_rate_limiter === 'true' || d.enable_smart_rate_limiter === true) : (d.rateLimiterEnabled !== undefined ? (d.rateLimiterEnabled === true || d.rateLimiterEnabled === 'true') : (settings?.enable_smart_rate_limiter !== undefined ? (settings.enable_smart_rate_limiter === 'true' || settings.enable_smart_rate_limiter === true) : p.rateLimiterEnabled)),
        engagementBreakerEnabled: d.enable_engagement_breaker !== undefined ? (d.enable_engagement_breaker === 'true' || d.enable_engagement_breaker === true) : true,
        humanSimulationEnabled: d.enable_human_simulation !== undefined ? (d.enable_human_simulation === 'true' || d.enable_human_simulation === true) : true,
        riskScoringEnabled: d.enable_risk_scoring !== undefined ? (d.enable_risk_scoring === 'true' || d.enable_risk_scoring === true) : true,
        deepDiversificationEnabled: d.enable_deep_diversification !== undefined ? (d.enable_deep_diversification === 'true' || d.enable_deep_diversification === true) : true,
        cooldownEnforcementEnabled: d.enable_cooldown_enforcement !== undefined ? (d.enable_cooldown_enforcement === 'true' || d.enable_cooldown_enforcement === true) : true,
        nightQuietEnabled: d.enable_night_pause === 'true' || d.enable_night_pause === true,
        nightQuietStart: String(d.night_pause_start_hour || '23'),
        nightQuietEnd: String(d.night_pause_end_hour || '7'),
        minDelaySeconds: parseInt(d.min_delay_seconds || d.min_delay || r.data?.minDelaySeconds || settings?.min_delay_seconds || settings?.min_delay || settings?.minDelaySeconds || p.minDelaySeconds) || 8,
        maxDelaySeconds: parseInt(d.max_delay_seconds || d.max_delay || r.data?.maxDelaySeconds || settings?.max_delay_seconds || settings?.max_delay || settings?.maxDelaySeconds || p.maxDelaySeconds) || 45,
        burstRestAfter: parseInt(d.burst_interval_messages || r.data?.burstRestAfter || settings?.burst_interval_messages || settings?.burstRestAfter || p.burstRestAfter) || 20,
        burstRestDuration: d.burst_pause_seconds !== undefined ? parseInt(d.burst_pause_seconds) : (r.data?.burstRestDuration !== undefined ? parseInt(r.data.burstRestDuration) : (settings?.burst_pause_seconds !== undefined ? parseInt(settings.burst_pause_seconds) : (settings?.burstRestDuration !== undefined ? parseInt(settings.burstRestDuration) : p.burstRestDuration))),
        warmupDay1: parseInt(d.warmup_stage1_limit || r.data?.warmupDay1 || p.warmupDay1) || 25,
        warmupDay2: parseInt(d.warmup_stage2_limit || r.data?.warmupDay2 || p.warmupDay2) || 50,
        warmupDay3: parseInt(d.warmup_stage3_limit || r.data?.warmupDay3 || p.warmupDay3) || 75,
        warmupDay7: parseInt(d.warmup_stage4_limit || r.data?.warmupDay7 || p.warmupDay7) || 100,
        healthPauseThreshold: parseInt(d.auto_pause_threshold || r.data?.healthPauseThreshold || p.healthPauseThreshold) || 30,
      }));
    }).catch((err) => {
      console.warn('Notice: Anti-ban data fetch error:', err.message);
    });
    axios.get(`${API_BASE}/anti-ban/blacklist`).then(r => setBlacklist(Array.isArray(r.data) ? r.data : (r.data.blacklist || []))).catch(() => setBlacklist([]));
    axios.get(`${API_BASE}/anti-ban/health`).then(r => setHealth(r.data)).catch(() => {});
    axios.get(`${API_BASE}/number-reputation`).then(r => setReputations(r.data?.reputations || [])).catch(() => setReputations([]));
    axios.get(`${API_BASE}/engagement-stats`).then(r => setEngagement(r.data?.engagement || null)).catch(() => {});
  };

  useEffect(() => {
    fetchAntiBanData();
  }, [settings]);

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        bypass_all_safety: cfg.bypassAllSafety ? 'true' : 'false',
        turbo_blast_mode: cfg.bypassAllSafety ? 'true' : 'false',
        delay_seconds: String(cfg.delaySeconds || 1),
        minDelaySeconds: Number(cfg.minDelaySeconds),
        min_delay_seconds: String(cfg.minDelaySeconds),
        min_delay: String(cfg.minDelaySeconds),
        maxDelaySeconds: Number(cfg.maxDelaySeconds),
        max_delay_seconds: String(cfg.maxDelaySeconds),
        max_delay: String(cfg.maxDelaySeconds),
        burstRestAfter: Number(cfg.burstRestAfter),
        burst_interval_messages: String(cfg.burstRestAfter),
        burstRestDuration: Number(cfg.burstRestDuration),
        burst_pause_seconds: String(cfg.burstRestDuration),
        rateLimiterEnabled: Boolean(cfg.rateLimiterEnabled),
        enable_smart_rate_limiter: cfg.rateLimiterEnabled ? 'true' : 'false',
        spintaxEnabled: Boolean(cfg.spintaxEnabled),
        enable_spintax: cfg.spintaxEnabled ? 'true' : 'false',
        warmupEnabled: Boolean(cfg.warmupEnabled),
        enable_number_warmup: cfg.warmupEnabled ? 'true' : 'false',
        warmup_enabled: cfg.warmupEnabled ? 'true' : 'false',
        healthMonitorEnabled: Boolean(cfg.healthMonitorEnabled),
        enable_health_monitoring: cfg.healthMonitorEnabled ? 'true' : 'false',
        enable_engagement_breaker: cfg.engagementBreakerEnabled ? 'true' : 'false',
        enable_human_simulation: cfg.humanSimulationEnabled ? 'true' : 'false',
        enable_risk_scoring: cfg.riskScoringEnabled ? 'true' : 'false',
        enable_deep_diversification: cfg.deepDiversificationEnabled ? 'true' : 'false',
        enable_cooldown_enforcement: cfg.cooldownEnforcementEnabled ? 'true' : 'false',
        enable_night_pause: cfg.nightQuietEnabled ? 'true' : 'false',
        night_pause_start_hour: String(cfg.nightQuietStart || '23'),
        night_pause_end_hour: String(cfg.nightQuietEnd || '7'),
        warmupDay1: Number(cfg.warmupDay1),
        warmup_stage1_limit: String(cfg.warmupDay1),
        warmupDay2: Number(cfg.warmupDay2),
        warmup_stage2_limit: String(cfg.warmupDay2),
        warmupDay3: Number(cfg.warmupDay3),
        warmup_stage3_limit: String(cfg.warmupDay3),
        warmupDay7: Number(cfg.warmupDay7),
        warmup_stage4_limit: String(cfg.warmupDay7),
        healthPauseThreshold: Number(cfg.healthPauseThreshold),
      };
      await axios.post(`${API_BASE}/anti-ban/settings`, payload);
      setMsg({ ok: true, t: 'Anti-Ban settings saved successfully!' });
      if (onSave) onSave();
      fetchAntiBanData();
    }
    catch (e) { setMsg({ ok: false, t: e.message }); }
    finally { setSaving(false); setTimeout(() => setMsg(null), 3000); }
  };

  const applyPreset = (mode) => {
    if (mode === 'max_safety') {
      setCfg(p => ({
        ...p,
        bypassAllSafety: false,
        rateLimiterEnabled: true,
        minDelaySeconds: 8,
        maxDelaySeconds: 45,
        burstRestAfter: 20,
        burstRestDuration: 120,
        warmupEnabled: true,
        healthMonitorEnabled: true,
        engagementBreakerEnabled: true,
        humanSimulationEnabled: true,
        riskScoringEnabled: true,
        deepDiversificationEnabled: true,
        cooldownEnforcementEnabled: true,
        spintaxEnabled: true,
        nightQuietEnabled: false
      }));
    } else if (mode === 'balanced') {
      setCfg(p => ({
        ...p,
        bypassAllSafety: false,
        rateLimiterEnabled: true,
        minDelaySeconds: 5,
        maxDelaySeconds: 20,
        burstRestAfter: 40,
        burstRestDuration: 60,
        warmupEnabled: false,
        healthMonitorEnabled: true,
        engagementBreakerEnabled: true,
        humanSimulationEnabled: true,
        riskScoringEnabled: false,
        deepDiversificationEnabled: true,
        cooldownEnforcementEnabled: true,
        spintaxEnabled: true,
        nightQuietEnabled: false
      }));
    } else if (mode === 'turbo_blast') {
      setCfg(p => ({
        ...p,
        bypassAllSafety: true,
        delaySeconds: 1,
        rateLimiterEnabled: false,
        warmupEnabled: false,
        healthMonitorEnabled: false,
        engagementBreakerEnabled: false,
        humanSimulationEnabled: false,
        riskScoringEnabled: false,
        deepDiversificationEnabled: false,
        cooldownEnforcementEnabled: false,
        nightQuietEnabled: false
      }));
    }
  };

  const autoSpinText = async () => {
    try {
      const r = await axios.post(`${API_BASE}/anti-ban/spintax/auto-generate`, { text: tmpl });
      if (r.data.spintax) {
        setTmpl(r.data.spintax);
        setTmplResult(r.data.result || '');
      }
    } catch (e) {
      alert('Failed to generate spintax: ' + e.message);
    }
  };

  const testSpintax = async () => {
    try { const r = await axios.post(`${API_BASE}/anti-ban/spintax/test`, { template: tmpl }); setTmplResult(r.data.result || r.data.message || ''); }
    catch { setTmplResult(tmpl.replace(/\{([^{}]+)\}/g, (_, g) => { const o = g.split('|'); return o[Math.floor(Math.random() * o.length)]; })); }
  };

  const addBl = async () => {
    const n = newNum.replace(/\D/g, ''); if (!n) return;
    try { await axios.post(`${API_BASE}/anti-ban/blacklist`, { number: n }); setNewNum(''); axios.get(`${API_BASE}/anti-ban/blacklist`).then(r => setBlacklist(Array.isArray(r.data) ? r.data : (r.data.blacklist || []))); }
    catch (e) { alert(e.message); }
  };

  const rmBl = async (target) => {
    if (!target) return;
    const targetStr = typeof target === 'object' ? (target.id || target.phone || target.number) : target;
    try {
      await axios.delete(`${API_BASE}/anti-ban/blacklist/${encodeURIComponent(targetStr)}`);
      const r = await axios.get(`${API_BASE}/anti-ban/blacklist`);
      setBlacklist(Array.isArray(r.data) ? r.data : (r.data.blacklist || []));
    } catch (e) {
      alert(e.response?.data?.error || e.message);
    }
  };

  const tog = k => setCfg(p => ({ ...p, [k]: !p[k] }));
  const upd = (k, v) => setCfg(p => ({ ...p, [k]: v }));

  const sc = !health ? 'text-slate-400' : health.score >= 80 ? 'text-emerald-400' : health.score >= 50 ? 'text-amber-400' : 'text-rose-400';
  const sb = !health ? 'bg-slate-800 border-slate-700' : health.score >= 80 ? 'bg-emerald-500/10 border-emerald-500/25' : health.score >= 50 ? 'bg-amber-500/10 border-amber-500/25' : 'bg-rose-500/10 border-rose-500/25';

  const Toggle = ({ k, activeColor = 'bg-emerald-500' }) => (
    <button onClick={() => tog(k)} className={`relative w-12 h-6 rounded-full transition-colors duration-200 flex-shrink-0 ${cfg[k] ? activeColor : 'bg-slate-700'}`}>
      <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${cfg[k] ? 'translate-x-6' : ''}`} />
    </button>
  );

  return (
    <div className="space-y-6">
      {/* Header & Quick Mode Presets */}
      <div className="glass-panel rounded-2xl p-6 border border-emerald-500/20 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/20">
              <ShieldAlert className="text-emerald-400" size={28} />
            </div>
            <div>
              <h3 className="text-xl font-bold text-white flex items-center gap-2">
                Anti-Ban Protection Suite &amp; Override Controls
                {cfg.bypassAllSafety ? (
                  <span className="px-2.5 py-0.5 text-[10px] font-bold uppercase bg-amber-500/20 text-amber-400 border border-amber-500/40 rounded-full animate-pulse">
                    ⚡ TURBO BYPASS ACTIVE
                  </span>
                ) : (
                  <span className="px-2.5 py-0.5 text-[10px] font-bold uppercase bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-full">
                    🛡️ SHIELD ACTIVE
                  </span>
                )}
              </h3>
              <p className="text-sm text-slate-400">Toggle individual safety layers or activate Turbo Mode to blast messages uncapped.</p>
            </div>
          </div>
          {health && (
            <div className={`flex items-center gap-2 px-4 py-2 rounded-xl border ${sb}`}>
              <Activity size={16} className={sc} />
              <span className={`text-sm font-bold ${sc}`}>Health: {health.score ?? '--'}%</span>
            </div>
          )}
        </div>

        {/* Mode Preset Selector */}
        <div className="pt-3 border-t border-slate-800 flex items-center justify-between flex-wrap gap-3">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Quick Speed / Safety Presets:</span>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => applyPreset('max_safety')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold border flex items-center gap-1.5 transition-all ${
                !cfg.bypassAllSafety && cfg.warmupEnabled && cfg.rateLimiterEnabled
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-sm shadow-emerald-500/20'
                  : 'bg-slate-900/60 text-slate-400 border-slate-800 hover:text-white'
              }`}
            >
              <Shield size={14} className="text-emerald-400" /> 🛡️ Maximum Safety
            </button>
            <button
              onClick={() => applyPreset('balanced')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold border flex items-center gap-1.5 transition-all ${
                !cfg.bypassAllSafety && !cfg.warmupEnabled && cfg.rateLimiterEnabled
                  ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40 shadow-sm shadow-cyan-500/20'
                  : 'bg-slate-900/60 text-slate-400 border-slate-800 hover:text-white'
              }`}
            >
              <Sliders size={14} className="text-cyan-400" /> ⚖️ Balanced Outreach
            </button>
            <button
              onClick={() => applyPreset('turbo_blast')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold border flex items-center gap-1.5 transition-all ${
                cfg.bypassAllSafety
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 shadow-sm shadow-amber-500/20'
                  : 'bg-slate-900/60 text-slate-400 border-slate-800 hover:text-white'
              }`}
            >
              <Zap size={14} className="text-amber-400" /> ⚡ Turbo / Bypass All
            </button>
          </div>
        </div>
      </div>

      {/* MASTER TURBO / BYPASS TOGGLE BANNER */}
      <div className={`p-5 rounded-2xl border transition-all duration-300 ${
        cfg.bypassAllSafety 
          ? 'bg-gradient-to-r from-amber-950/40 via-slate-900 to-amber-950/30 border-amber-500/40 shadow-lg shadow-amber-500/10'
          : 'bg-slate-900/40 border-slate-800'
      }`}>
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className={`p-3 rounded-xl ${cfg.bypassAllSafety ? 'bg-amber-500/20 border border-amber-500/30 text-amber-400' : 'bg-slate-800 text-slate-400'}`}>
              <Zap size={22} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="text-base font-bold text-white">⚡ Turbo / Unrestricted Blast Mode (Bypass All Safety Rules)</h4>
                {cfg.bypassAllSafety && <span className="text-[10px] px-2 py-0.5 bg-amber-500/20 text-amber-300 rounded font-mono font-bold uppercase">Active</span>}
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                {cfg.bypassAllSafety 
                  ? '⚠️ ALL DELAYS & RESTRICTIONS BYPASSED: Warmup caps, rest breaks, cooldown exclusions, reading pauses, and circuit breakers are disabled. Outbound dispatch runs at raw speed.'
                  : 'Enable to instantly bypass all rate limits, cooldowns, warmup limits, and behavioral pauses for high-speed blast messaging.'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {cfg.bypassAllSafety && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-950/60 border border-amber-500/30">
                <Clock size={14} className="text-amber-400" />
                <span className="text-xs text-slate-300">Raw Delay:</span>
                <input
                  type="number"
                  min="0"
                  max="60"
                  value={cfg.delaySeconds}
                  onChange={e => upd('delaySeconds', Math.max(0, +e.target.value || 0))}
                  className="w-14 glass-input rounded-lg px-2 py-1 text-amber-300 text-xs font-mono text-center"
                />
                <span className="text-xs text-slate-400">sec</span>
              </div>
            )}
            <Toggle k="bypassAllSafety" activeColor="bg-amber-500" />
          </div>
        </div>
      </div>

      {msg && <div className={`p-4 border rounded-xl flex items-center gap-3 text-sm ${msg.ok ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400' : 'bg-rose-500/10 border-rose-500/25 text-rose-400'}`}>{msg.ok ? <CheckCircle size={18}/> : <XCircle size={18}/>}<span>{msg.t}</span></div>}

      {/* Granular Protection Layers Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        {/* Layer 1: Smart Rate Limiter */}
        <div className={`glass-card p-5 rounded-2xl border transition-all ${cfg.rateLimiterEnabled && !cfg.bypassAllSafety ? 'border-purple-500/30' : 'border-slate-800 opacity-80'} space-y-4`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-purple-500/10"><Zap className="text-purple-400" size={16}/></div>
              <div><p className="text-sm font-bold text-white">Smart Rate Limiter</p><p className="text-[11px] text-slate-500">Human-Like Random Delays &amp; Rest Breaks</p></div>
            </div>
            <Toggle k="rateLimiterEnabled" activeColor="bg-purple-500"/>
          </div>
          <p className="text-xs text-slate-400">Randomizes intervals between min and max seconds and triggers burst rest breaks to emulate real users.</p>
          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-800">
            {[['Min Delay (s)','minDelaySeconds',1,300],['Max Delay (s)','maxDelaySeconds',1,300],['Rest After (msgs)','burstRestAfter',1,500],['Rest Duration (s)','burstRestDuration',5,3600]].map(([l,k,mn,mx]) => (
              <div key={k}><label className="text-[10px] text-slate-500 font-semibold uppercase">{l}</label>
                <input type="number" min={mn} max={mx} value={cfg[k]} onChange={e => upd(k, +e.target.value||mn)} className="w-full glass-input rounded-lg px-2 py-1.5 text-slate-200 text-xs mt-1"/></div>
            ))}
          </div>
        </div>

        {/* Layer 2: Number Warmup System */}
        <div className={`glass-card p-5 rounded-2xl border transition-all ${cfg.warmupEnabled && !cfg.bypassAllSafety ? 'border-amber-500/30' : 'border-slate-800 opacity-80'} space-y-4`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-amber-500/10"><Flame className="text-amber-400" size={16}/></div>
              <div><p className="text-sm font-bold text-white">Number Warmup Engine</p><p className="text-[11px] text-slate-500">Progressive Daily Limits</p></div>
            </div>
            <Toggle k="warmupEnabled" activeColor="bg-amber-500"/>
          </div>
          <p className="text-xs text-slate-400">
            {!cfg.warmupEnabled || cfg.bypassAllSafety
              ? '🚀 Uncapped Mode: Daily limits disabled. Ready to dispatch 1,000+ messages at once.' 
              : 'Gradually ramp daily send volume based on account age to build WhatsApp trust.'}
          </p>
          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-800">
            {[['Day 1','warmupDay1'],['Day 2','warmupDay2'],['Day 3-6','warmupDay3'],['Day 7+','warmupDay7']].map(([l,k]) => (
              <div key={k}><label className="text-[10px] text-slate-500 font-semibold uppercase">{l}</label>
                <input type="number" min="1" max="10000" value={cfg[k]} onChange={e => upd(k, +e.target.value||1)} className="w-full glass-input rounded-lg px-2 py-1.5 text-slate-200 text-xs mt-1"/></div>
            ))}
          </div>
        </div>

        {/* Layer 3: Engagement Circuit Breaker */}
        <div className={`glass-card p-5 rounded-2xl border transition-all ${cfg.engagementBreakerEnabled && !cfg.bypassAllSafety ? 'border-cyan-500/30' : 'border-slate-800 opacity-80'} space-y-4`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-cyan-500/10"><Activity className="text-cyan-400" size={16}/></div>
              <div><p className="text-sm font-bold text-white">Engagement Circuit Breaker</p><p className="text-[11px] text-slate-500">System 1: Inbound Reply Auto-Throttle</p></div>
            </div>
            <Toggle k="engagementBreakerEnabled" activeColor="bg-cyan-500"/>
          </div>
          <p className="text-xs text-slate-400">Monitors incoming replies in real-time. If 30+ messages receive 0 replies, auto-pauses campaign to prevent spam bans.</p>
          <div className="p-3 bg-slate-900/60 rounded-xl border border-slate-800 text-[11px] text-slate-300 space-y-1">
            <p>• Auto-throttles delay (2x-4x) when reply rates drop below 5%</p>
            <p>• Auto-blacklists recipients when opt-out keywords ("STOP", "BLOCK") are received</p>
          </div>
        </div>

        {/* Layer 4: Behavioral Simulation */}
        <div className={`glass-card p-5 rounded-2xl border transition-all ${cfg.humanSimulationEnabled && !cfg.bypassAllSafety ? 'border-emerald-500/30' : 'border-slate-800 opacity-80'} space-y-4`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-emerald-500/10"><ShieldCheck className="text-emerald-400" size={16}/></div>
              <div><p className="text-sm font-bold text-white">Behavioral Humanization</p><p className="text-[11px] text-slate-500">System 6: Typing Jitter &amp; Idle Simulation</p></div>
            </div>
            <Toggle k="humanSimulationEnabled" activeColor="bg-emerald-500"/>
          </div>
          <p className="text-xs text-slate-400">Simulates human reading (2-6s pause), chat scrolling, dynamic per-char typing speed, and random offline/online cycling.</p>
          <div className="p-3 bg-slate-900/60 rounded-xl border border-slate-800 text-[11px] text-slate-300 space-y-1">
            <p>• Variable typing delay: 30-60ms/char with backspace thinking pauses</p>
            <p>• Periodic natural offline rest periods (15-60s) every 5-10 messages</p>
          </div>
        </div>

        {/* Layer 5: Recipient Risk Pre-Qualification */}
        <div className={`glass-card p-5 rounded-2xl border transition-all ${cfg.riskScoringEnabled && !cfg.bypassAllSafety ? 'border-blue-500/30' : 'border-slate-800 opacity-80'} space-y-4`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-blue-500/10"><Shield className="text-blue-400" size={16}/></div>
              <div><p className="text-sm font-bold text-white">Recipient Risk Throttling</p><p className="text-[11px] text-slate-500">System 4: Chat History Risk Scoring</p></div>
            </div>
            <Toggle k="riskScoringEnabled" activeColor="bg-blue-500"/>
          </div>
          <p className="text-xs text-slate-400">Inspects conversation history before dispatching. Known contacts send at 1.0x speed, while cold unknown numbers get 3.0x safer delay.</p>
          <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-800 text-center">
            <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-bold">Low: 1.0x<p className="text-[10px] font-normal text-slate-400">Known Contact</p></div>
            <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-bold">Med: 1.5x<p className="text-[10px] font-normal text-slate-400">Warm Chat</p></div>
            <div className="p-2 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs font-bold">High: 3.0x<p className="text-[10px] font-normal text-slate-400">Cold Number</p></div>
          </div>
        </div>

        {/* Layer 6: Deep Content Diversification */}
        <div className={`glass-card p-5 rounded-2xl border transition-all ${cfg.deepDiversificationEnabled ? 'border-indigo-500/30' : 'border-slate-800 opacity-80'} space-y-4`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-indigo-500/10"><Sparkles className="text-indigo-400" size={16}/></div>
              <div><p className="text-sm font-bold text-white">Deep Content Diversification</p><p className="text-[11px] text-slate-500">System 3: Fingerprint &amp; Hash Scrambling</p></div>
            </div>
            <Toggle k="deepDiversificationEnabled" activeColor="bg-indigo-500"/>
          </div>
          <p className="text-xs text-slate-400">Injects invisible Zero-Width Spaces (\u200B), typography quote/dash alternates, and paragraph shifting to prevent WhatsApp server-side hash grouping.</p>
          <div className="p-3 bg-slate-900/60 rounded-xl border border-slate-800 text-[11px] text-slate-300">
            ✨ Makes every single dispatched message physically unique to WhatsApp AI while appearing 100% identical to the recipient.
          </div>
        </div>

        {/* Layer 7: Cooldown & Reputation Enforcement */}
        <div className={`glass-card p-5 rounded-2xl border transition-all ${cfg.cooldownEnforcementEnabled && !cfg.bypassAllSafety ? 'border-rose-500/30' : 'border-slate-800 opacity-80'} space-y-4`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-rose-500/10"><ShieldAlert className="text-rose-400" size={16}/></div>
              <div><p className="text-sm font-bold text-white">Cooldown Enforcement</p><p className="text-[11px] text-slate-500">System 5: Exclude Restricted Numbers</p></div>
            </div>
            <Toggle k="cooldownEnforcementEnabled" activeColor="bg-rose-500"/>
          </div>
          <p className="text-xs text-slate-400">When enabled, numbers with active 72h-168h cooldowns are automatically excluded from campaigns to let them cool down.</p>
          <p className="text-[11px] text-amber-400/80">Turn OFF if you want to force-use restricted numbers regardless of cooldown status.</p>
        </div>

        {/* Layer 8: Night Quiet Hours */}
        <div className={`glass-card p-5 rounded-2xl border transition-all ${cfg.nightQuietEnabled && !cfg.bypassAllSafety ? 'border-indigo-500/30' : 'border-slate-800 opacity-80'} space-y-4`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-indigo-500/10"><Moon className="text-indigo-400" size={16}/></div>
              <div><p className="text-sm font-bold text-white">Night Quiet Hours</p><p className="text-[11px] text-slate-500">Auto-Pause Overnight</p></div>
            </div>
            <Toggle k="nightQuietEnabled" activeColor="bg-indigo-500"/>
          </div>
          <p className="text-xs text-slate-400">Auto-pauses campaign dispatch during late night hours to avoid recipient spam reports.</p>
          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-800">
            <div>
              <label className="text-[10px] text-slate-500 font-semibold uppercase">Pause Start (24h)</label>
              <input type="number" min="0" max="23" value={cfg.nightQuietStart} onChange={e => upd('nightQuietStart', e.target.value)} className="w-full glass-input rounded-lg px-2 py-1.5 text-slate-200 text-xs mt-1"/>
            </div>
            <div>
              <label className="text-[10px] text-slate-500 font-semibold uppercase">Resume End (24h)</label>
              <input type="number" min="0" max="23" value={cfg.nightQuietEnd} onChange={e => upd('nightQuietEnd', e.target.value)} className="w-full glass-input rounded-lg px-2 py-1.5 text-slate-200 text-xs mt-1"/>
            </div>
          </div>
        </div>

      </div>

      {/* Spintax Engine Card */}
      <div className="glass-card p-5 rounded-2xl border border-slate-800 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-cyan-500/10"><Sparkles className="text-cyan-400" size={16}/></div>
            <div><p className="text-sm font-bold text-white">Spintax Studio</p><p className="text-[11px] text-slate-500">Automated Multi-Lang Variation Generator</p></div>
          </div>
          <Toggle k="spintaxEnabled"/>
        </div>
        <p className="text-xs text-slate-400">Type normal text in any language and click Auto-Spin to generate Spintax choices automatically.</p>
        <div className="space-y-2 pt-2 border-t border-slate-800">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-slate-400 uppercase">Live Tester &amp; Generator</label>
            <button onClick={autoSpinText} className="text-xs font-bold text-cyan-400 hover:text-cyan-300 flex items-center gap-1 transition-colors">
              <Sparkles size={12}/> Auto-Spin (Multi-Lang)
            </button>
          </div>
          <textarea rows={2} value={tmpl} onChange={e => setTmpl(e.target.value)} className="w-full glass-input rounded-xl px-3 py-2 text-slate-200 text-xs font-mono" />
          <div className="flex items-center gap-2">
            <button onClick={testSpintax} className="btn-primary text-xs py-1.5 px-3"><Sparkles size={12}/> Test Variation</button>
            <button onClick={autoSpinText} className="bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 rounded-xl text-xs py-1.5 px-3 font-semibold flex items-center gap-1 transition-colors">
              <Sparkles size={12}/> ✨ Auto-Generate Spintax
            </button>
          </div>
          {tmplResult && <div className="p-3 bg-slate-900 border border-slate-700 rounded-lg text-xs text-emerald-400 font-mono">→ {tmplResult}</div>}
        </div>
      </div>

      {/* Blacklist */}
      <div className="glass-panel rounded-2xl p-6 border border-slate-800">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-rose-500/10"><Shield className="text-rose-400" size={18}/></div>
          <div><h4 className="text-base font-bold text-white">Opt-Out Blacklist</h4><p className="text-xs text-slate-400">Numbers here are permanently skipped.</p></div>
        </div>
        <div className="flex gap-2 mb-4">
          <input type="text" placeholder="Phone number (e.g. 919876543210)" value={newNum} onChange={e => setNewNum(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addBl()} className="flex-1 glass-input rounded-xl px-4 py-2.5 text-slate-200 text-sm"/>
          <button onClick={addBl} className="btn-danger px-4 py-2.5"><Plus size={16}/> Add</button>
        </div>
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {blacklist.length === 0
            ? <div className="text-center py-8 text-slate-500 text-sm"><Shield size={28} className="mx-auto mb-2 opacity-30"/>No numbers blacklisted.</div>
            : blacklist.map((e, i) => {
              const displayVal = typeof e === 'object' ? (e.phone || e.number || e.id) : e;
              const targetVal = typeof e === 'object' ? (e.id || e.phone || e.number) : e;
              return (
                <div key={i} className="flex items-center justify-between px-4 py-2.5 bg-slate-900/50 border border-slate-800 rounded-xl">
                  <span className="text-sm font-mono text-slate-300">
                    {displayVal} {e.reason ? <span className="text-xs text-slate-500 font-sans ml-2">({e.reason})</span> : null}
                  </span>
                  <button onClick={() => rmBl(targetVal)} title="Remove from blacklist" className="p-1.5 hover:bg-rose-500/10 text-slate-500 hover:text-rose-400 rounded-lg transition-colors">
                    <X size={14}/>
                  </button>
                </div>
              );
            })}
        </div>
      </div>

      <button onClick={save} disabled={saving} className="btn-primary w-full py-3.5 text-base font-bold shadow-lg shadow-emerald-500/10">
        {saving ? <><RefreshCw className="animate-spin" size={18}/> Saving Settings...</> : <><Check size={18}/> Save Anti-Ban &amp; Speed Settings</>}
      </button>

      {/* Number Reputation Dashboard (System 5) */}
      <div className="glass-panel rounded-2xl p-6 border border-slate-800 space-y-4">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 rounded-lg bg-cyan-500/10"><Shield className="text-cyan-400" size={18}/></div>
          <div>
            <h4 className="text-base font-bold text-white">Number Reputation Tracker</h4>
            <p className="text-xs text-slate-400">Per-number trust scores, cooldown status &amp; restriction history</p>
          </div>
        </div>
        {reputations.length === 0 ? (
          <div className="text-center py-6 text-slate-500 text-sm">
            <Shield size={28} className="mx-auto mb-2 opacity-30"/>
            No number reputation data yet. Send some campaigns to begin tracking.
          </div>
        ) : (
          <div className="space-y-2">
            {reputations.map((rep, i) => {
              const trustColor = rep.trust_score >= 80 ? 'emerald' : rep.trust_score >= 50 ? 'amber' : 'rose';
              return (
                <div key={i} className={`p-4 rounded-xl border bg-slate-900/50 border-${trustColor}-500/20 space-y-2`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold bg-${trustColor}-500/10 text-${trustColor}-400 border border-${trustColor}-500/20`}>
                        {rep.trust_score}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-white">{rep.session_name}</p>
                        <p className="text-[10px] text-slate-500">
                          {rep.total_sent || 0} sent · {rep.restriction_count || 0} restriction{(rep.restriction_count || 0) !== 1 ? 's' : ''}
                          {rep.inCooldown && <span className="ml-2 text-rose-400 font-bold">⛔ COOLDOWN ({rep.cooldownRemaining})</span>}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {rep.inCooldown && (
                        <button
                          onClick={async () => {
                            try {
                              await axios.post(`${API_BASE}/number-reputation/${encodeURIComponent(rep.session_name)}/clear-cooldown`);
                              fetchAntiBanData();
                            } catch (e) { alert(e.message); }
                          }}
                          className="text-[10px] px-2 py-1 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-400 rounded-lg font-semibold transition-colors"
                        >
                          Clear Cooldown
                        </button>
                      )}
                      <button
                        onClick={async () => {
                          if (!confirm(`Report restriction for "${rep.session_name}"? This will reduce trust score and apply a cooldown.`)) return;
                          try {
                            await axios.post(`${API_BASE}/number-reputation/${encodeURIComponent(rep.session_name)}/restrict`, { notes: 'Manual restriction report from UI' });
                            fetchAntiBanData();
                          } catch (e) { alert(e.message); }
                        }}
                        className="text-[10px] px-2 py-1 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-400 rounded-lg font-semibold transition-colors"
                      >
                        ⚠️ Report Restriction
                      </button>
                    </div>
                  </div>
                  {/* Trust Score Bar */}
                  <div className="w-full bg-slate-800 rounded-full h-1.5">
                    <div
                      className={`h-1.5 rounded-full transition-all duration-500 bg-${trustColor}-500`}
                      style={{ width: `${rep.trust_score}%` }}
                    />
                  </div>
                  {rep.last_restricted_at && (
                    <p className="text-[10px] text-slate-500">Last restricted: {new Date(rep.last_restricted_at).toLocaleDateString()} · Trust recovers +1 every 50 successful sends</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Engagement Circuit Breaker Stats (System 1) */}
      {engagement && (
        <div className="glass-panel rounded-2xl p-6 border border-slate-800 space-y-4">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 rounded-lg bg-purple-500/10"><Activity className="text-purple-400" size={18}/></div>
            <div>
              <h4 className="text-base font-bold text-white">Engagement Circuit Breaker</h4>
              <p className="text-xs text-slate-400">Real-time reply tracking — auto-throttles when engagement drops</p>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              ['Outbound', engagement.outboundCount || 0, 'text-slate-300'],
              ['Replies', engagement.inboundCount || 0, 'text-emerald-400'],
              ['Reply Rate', ((engagement.engagementRatio || 0) * 100).toFixed(1) + '%', 
                engagement.engagementRatio >= 0.1 ? 'text-emerald-400' : engagement.engagementRatio >= 0.02 ? 'text-amber-400' : 'text-rose-400'],
              ['Throttle', engagement.throttleMultiplier + 'x', 
                engagement.throttleMultiplier <= 1 ? 'text-emerald-400' : engagement.throttleMultiplier <= 2 ? 'text-amber-400' : 'text-rose-400']
            ].map(([label, val, color]) => (
              <div key={label} className="p-3 rounded-xl bg-slate-900/50 border border-slate-800 text-center">
                <p className={`text-lg font-bold ${color}`}>{val}</p>
                <p className="text-[10px] text-slate-500 font-semibold uppercase">{label}</p>
              </div>
            ))}
          </div>
          <div className={`p-3 rounded-xl border text-xs flex items-center gap-2 ${
            engagement.riskLevel === 'healthy' || engagement.riskLevel === 'normal' || engagement.riskLevel === 'warmup'
              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
              : engagement.riskLevel === 'caution' || engagement.riskLevel === 'elevated'
              ? 'bg-amber-500/10 border-amber-500/20 text-amber-400'
              : 'bg-rose-500/10 border-rose-500/20 text-rose-400'
          }`}>
            <ShieldAlert size={14}/>
            <span>
              {engagement.riskLevel === 'healthy' ? '✅ Healthy engagement — replies are coming in. Speed is optimized.' :
               engagement.riskLevel === 'normal' || engagement.riskLevel === 'warmup' ? '🟢 Warming up — monitoring early engagement signals.' :
               engagement.riskLevel === 'caution' ? '⚠️ Low engagement — delays automatically increased 2x to protect account.' :
               engagement.riskLevel === 'warning' ? '🟡 Warning — zero replies detected. Delays increased 4x.' :
               '🛑 CRITICAL — No engagement detected. Campaign will auto-pause to prevent ban.'}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// VIEW COMPONENT 9: ADMIN LICENSE & CUSTOMER MANAGEMENT CONSOLE
// ============================================================================
function AdminLicenseConsoleView() {
  const [subTab, setSubTab] = useState('generator'); // 'generator', 'history', 'inspector'
  const [formData, setFormData] = useState({
    clientName: '',
    clientEmail: '',
    machineId: '',
    validityDays: '365',
    sessionsLimit: '5',
    turboAllowed: true,
    multiSessionAllowed: true,
    notes: ''
  });
  const [generatedKey, setGeneratedKey] = useState(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedWhatsAppMsg, setCopiedWhatsAppMsg] = useState(false);

  // History State
  const [licenses, setLicenses] = useState([]);
  const [historySearch, setHistorySearch] = useState('');
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Store & Pricing Configuration State
  const [storeConfig, setStoreConfig] = useState({
    brandName: 'WhatsApp Automator Pro',
    brandTagline: 'Commercial Desktop Automation Suite',
    supportEmail: 'support@rudraexpression.in',
    supportWhatsapp: '+919876543210',
    downloadUrl: 'https://github.com/ayushhbhuutada/whatsapp-automation/releases/latest/download/WhatsAppAutomationSetup.exe',
    razorpayKeyId: '',
    razorpayKeySecret: '',
    plans: []
  });
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [configSuccessMsg, setConfigSuccessMsg] = useState('');
  const [configErrorMsg, setConfigErrorMsg] = useState('');

  const fetchStoreConfig = async () => {
    try {
      setLoadingConfig(true);
      const res = await axios.get(`${API_BASE}/admin/config`);
      if (res.data?.config) {
        setStoreConfig(res.data.config);
      }
    } catch (e) {
      console.warn('Failed to load admin config:', e.message);
    } finally {
      setLoadingConfig(false);
    }
  };

  useEffect(() => {
    if (subTab === 'store_config') {
      fetchStoreConfig();
    }
  }, [subTab]);

  const handleSaveStoreConfig = async (e) => {
    e.preventDefault();
    setConfigErrorMsg('');
    setConfigSuccessMsg('');
    try {
      const res = await axios.post(`${API_BASE}/admin/config/update`, { config: storeConfig });
      if (res.data?.success) {
        setConfigSuccessMsg('✅ Store settings and pricing plans updated live! Website and checkout are now synced.');
        setTimeout(() => setConfigSuccessMsg(''), 4000);
      } else {
        setConfigErrorMsg(res.data?.error || 'Failed to update settings.');
      }
    } catch (err) {
      setConfigErrorMsg('Update error: ' + (err.response?.data?.error || err.message));
    }
  };

  const handlePlanChange = (index, field, value) => {
    const updatedPlans = [...(storeConfig.plans || [])];
    if (updatedPlans[index]) {
      updatedPlans[index] = { ...updatedPlans[index], [field]: value };
      setStoreConfig({ ...storeConfig, plans: updatedPlans });
    }
  };

  const handlePlanFeaturesChange = (index, text) => {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const updatedPlans = [...(storeConfig.plans || [])];
    if (updatedPlans[index]) {
      updatedPlans[index] = { ...updatedPlans[index], features: lines };
      setStoreConfig({ ...storeConfig, plans: updatedPlans });
    }
  };

  const handleGenerate = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setGeneratedKey(null);
    setLoading(true);
    try {
      const res = await axios.post(`${API_BASE}/admin/licenses/generate`, formData);
      if (res.data?.success) {
        setGeneratedKey(res.data);
      } else {
        setErrorMsg(res.data?.error || 'Failed to generate license.');
      }
    } catch (err) {
      setErrorMsg(err.response?.data?.error || 'License generation error: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleInspect = async (e) => {
    e.preventDefault();
    setInspectError('');
    setInspectResult(null);
    if (!inspectKey.trim()) return;
    try {
      const res = await axios.post(`${API_BASE}/admin/licenses/decode`, { licenseKey: inspectKey.trim() });
      if (res.data?.success) {
        setInspectResult(res.data);
      } else {
        setInspectError(res.data?.error || 'Could not decode license key.');
      }
    } catch (err) {
      setInspectError(err.response?.data?.error || 'Invalid or malformed license token.');
    }
  };

  const handleRevoke = async (id, clientName) => {
    if (!confirm(`Revoke license for "${clientName}"? The client will no longer be able to use the software.`)) return;
    try {
      await axios.post(`${API_BASE}/admin/licenses/revoke`, { id });
      fetchHistory();
    } catch (err) {
      alert('Failed to revoke license: ' + err.message);
    }
  };

  const copyLicenseKeyOnly = (key) => {
    navigator.clipboard.writeText(key);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  const copyWhatsAppFormat = (data) => {
    const text = `🚀 *WhatsApp Automator Pro — Commercial License Key*

👤 *Client Name:* ${data.clientName || 'Customer'}
📧 *Email:* ${data.clientEmail}
📱 *Machine Binding:* \`${data.machineId}\`
📅 *Validity:* ${data.validityDays} Days (Expires: ${new Date(data.expiresAt).toLocaleDateString()})
⚡ *WhatsApp Profiles Allowed:* ${data.maxSessions} Sessions

🔑 *Your License Key:*
\`${data.licenseKey}\`

---
*How to Activate:*
1. Install & open *WhatsApp Automator Pro Desktop*
2. Paste the License Key above in the activation box
3. Click *Activate License* and start automating!`;

    navigator.clipboard.writeText(text);
    setCopiedWhatsAppMsg(true);
    setTimeout(() => setCopiedWhatsAppMsg(false), 2000);
  };

  const filteredLicenses = licenses.filter(lic => {
    const q = historySearch.toLowerCase();
    return (
      (lic.client_name || '').toLowerCase().includes(q) ||
      (lic.client_email || '').toLowerCase().includes(q) ||
      (lic.machine_id || '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-8 max-w-6xl">
      {/* Top Header Card */}
      <div className="glass-panel rounded-2xl p-6 border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-700 flex items-center justify-center text-white shadow-lg shadow-emerald-500/20">
            <ShieldCheck size={26} />
          </div>
          <div>
            <h2 className="text-xl font-heading font-bold text-white tracking-tight">Admin License & Client Hub</h2>
            <p className="text-xs text-slate-400">Generate node-locked commercial keys, manage client validity, and control access</p>
          </div>
        </div>

        {/* Sub-Tab Navigation */}
        <div className="flex flex-wrap bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs font-semibold gap-1">
          <button
            onClick={() => setSubTab('generator')}
            className={`px-3.5 py-2 rounded-lg transition-all flex items-center gap-1.5 ${
              subTab === 'generator' ? 'bg-emerald-500 text-white shadow-md' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Sparkles size={14} />
            <span>Generate Key</span>
          </button>
          <button
            onClick={() => setSubTab('history')}
            className={`px-3.5 py-2 rounded-lg transition-all flex items-center gap-1.5 ${
              subTab === 'history' ? 'bg-emerald-500 text-white shadow-md' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Clock size={14} />
            <span>Issued History</span>
          </button>
          <button
            onClick={() => setSubTab('inspector')}
            className={`px-3.5 py-2 rounded-lg transition-all flex items-center gap-1.5 ${
              subTab === 'inspector' ? 'bg-emerald-500 text-white shadow-md' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Search size={14} />
            <span>Inspect / Decode</span>
          </button>
          <button
            onClick={() => setSubTab('store_config')}
            className={`px-3.5 py-2 rounded-lg transition-all flex items-center gap-1.5 ${
              subTab === 'store_config' ? 'bg-emerald-500 text-white shadow-md' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Sliders size={14} />
            <span>Pricing & Store Settings</span>
          </button>
        </div>
      </div>

      {/* SUBTAB 1: LICENSE GENERATOR */}
      {subTab === 'generator' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Generator Form */}
          <div className="lg:col-span-7 glass-panel rounded-2xl p-6 border border-slate-800 space-y-6">
            <div className="flex items-center gap-2 pb-4 border-b border-slate-800">
              <Zap size={18} className="text-amber-400" />
              <h3 className="text-base font-bold text-white">Generate Commercial Client License</h3>
            </div>

            {errorMsg && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400 text-xs flex items-center gap-2">
                <AlertTriangle size={16} />
                <span>{errorMsg}</span>
              </div>
            )}

            <form onSubmit={handleGenerate} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
                    Client Name / Business
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Acme Marketing Agency"
                    value={formData.clientName}
                    onChange={(e) => setFormData({ ...formData, clientName: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 text-xs focus:outline-none focus:border-emerald-500 transition-colors"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
                    Client Email
                  </label>
                  <input
                    type="email"
                    required
                    placeholder="client@company.com"
                    value={formData.clientEmail}
                    onChange={(e) => setFormData({ ...formData, clientEmail: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 text-xs focus:outline-none focus:border-emerald-500 transition-colors"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
                  Client Hardware Machine ID (from their PC)
                </label>
                <input
                  type="text"
                  required
                  placeholder="WA-WIN-XXXX-XXXX-XXXX-XXXX (or * for unbound)"
                  value={formData.machineId}
                  onChange={(e) => setFormData({ ...formData, machineId: e.target.value })}
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-emerald-300 font-mono text-xs focus:outline-none focus:border-emerald-500 transition-colors"
                />
                <p className="text-[10px] text-slate-500 mt-1">
                  Ask your client to copy their Machine ID from the activation screen of their `.exe` application.
                </p>
              </div>

              {/* Validity Presets */}
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                  License Validity Duration
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    ['1 Month', '30', '30 Days Trial'],
                    ['3 Months', '90', 'Quarterly'],
                    ['1 Year', '365', 'Annual Pro'],
                    ['Lifetime', '3650', 'VIP Permanent']
                  ].map(([label, days, desc]) => (
                    <button
                      key={days}
                      type="button"
                      onClick={() => setFormData({ ...formData, validityDays: days })}
                      className={`p-2.5 rounded-xl border text-left transition-all ${
                        formData.validityDays === days
                          ? 'bg-emerald-500/15 border-emerald-500 text-white shadow-md'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <p className="text-xs font-bold">{label}</p>
                      <p className="text-[10px] text-slate-500">{desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* WhatsApp Profile Slots & Permissions */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
                    WhatsApp Profile Quota
                  </label>
                  <select
                    value={formData.sessionsLimit}
                    onChange={(e) => setFormData({ ...formData, sessionsLimit: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 text-xs focus:outline-none focus:border-emerald-500 transition-colors"
                  >
                    <option value="1">1 WhatsApp Profile</option>
                    <option value="3">3 WhatsApp Profiles (Starter)</option>
                    <option value="5">5 WhatsApp Profiles (Pro)</option>
                    <option value="10">10 WhatsApp Profiles (Agency)</option>
                    <option value="20">20 WhatsApp Profiles (Enterprise)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
                    Admin Notes / Ref
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Paid via UPI Ref #987654"
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 text-xs focus:outline-none focus:border-emerald-500 transition-colors"
                  />
                </div>
              </div>

              {/* Feature Toggles */}
              <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-xl flex items-center justify-between text-xs">
                <label className="flex items-center gap-2 cursor-pointer text-slate-300">
                  <input
                    type="checkbox"
                    checked={formData.turboAllowed}
                    onChange={(e) => setFormData({ ...formData, turboAllowed: e.target.checked })}
                    className="rounded text-emerald-500 focus:ring-0 bg-slate-900 border-slate-700"
                  />
                  <span>Allow Turbo Mode Bypass</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer text-slate-300">
                  <input
                    type="checkbox"
                    checked={formData.multiSessionAllowed}
                    onChange={(e) => setFormData({ ...formData, multiSessionAllowed: e.target.checked })}
                    className="rounded text-emerald-500 focus:ring-0 bg-slate-900 border-slate-700"
                  />
                  <span>Allow Multi-Device Auto-Split</span>
                </label>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3.5 bg-emerald-500 hover:bg-emerald-600 font-bold text-white rounded-xl shadow-lg shadow-emerald-500/20 transition-all text-sm flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <ShieldCheck size={18} />
                <span>{loading ? 'Generating Asymmetric Ed25519 Token...' : '⚡ Generate Commercial License Key'}</span>
              </button>
            </form>
          </div>

          {/* Generated Result Container */}
          <div className="lg:col-span-5 space-y-6">
            {generatedKey ? (
              <div className="glass-panel rounded-2xl p-6 border border-emerald-500/40 bg-emerald-950/10 space-y-5 animate-fade-in">
                <div className="flex items-center gap-2 text-emerald-400">
                  <CheckCircle size={20} />
                  <h4 className="font-bold text-base text-white">License Generated Successfully!</h4>
                </div>

                <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-2">
                  <p className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Signed License Token</p>
                  <p className="font-mono text-xs text-emerald-300 break-all bg-slate-900/90 p-2.5 rounded-lg border border-slate-800 select-all">
                    {generatedKey.licenseKey}
                  </p>
                </div>

                <div className="space-y-1.5 text-xs text-slate-300 bg-slate-950/60 p-3.5 rounded-xl border border-slate-800">
                  <div className="flex justify-between"><span className="text-slate-500">Client:</span><span className="font-bold text-white">{generatedKey.clientName}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Email:</span><span>{generatedKey.clientEmail}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Node Lock:</span><span className="font-mono text-emerald-400 text-[11px]">{generatedKey.machineId}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Validity:</span><span>{generatedKey.validityDays} Days</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Profiles:</span><span>{generatedKey.maxSessions} Max WhatsApp Sessions</span></div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                  <button
                    onClick={() => copyLicenseKeyOnly(generatedKey.licenseKey)}
                    className="py-2.5 px-3 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 shadow"
                  >
                    {copiedKey ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                    <span>{copiedKey ? 'Copied Key!' : 'Copy Key Only'}</span>
                  </button>

                  <button
                    onClick={() => copyWhatsAppFormat(generatedKey)}
                    className="py-2.5 px-3 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 shadow-lg shadow-emerald-500/20"
                  >
                    {copiedWhatsAppMsg ? <Check size={14} /> : <Send size={14} />}
                    <span>{copiedWhatsAppMsg ? 'Copied for WhatsApp!' : '💬 Copy for WhatsApp'}</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="glass-panel rounded-2xl p-6 border border-slate-800 text-center py-16 space-y-3">
                <ShieldCheck size={36} className="mx-auto text-slate-600" />
                <h4 className="text-sm font-bold text-slate-300">Ready to Issue License</h4>
                <p className="text-xs text-slate-500 max-w-xs mx-auto">
                  Fill in the client details and Machine ID on the left to generate an offline cryptographic Ed25519 license key.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* SUBTAB 2: ISSUED HISTORY TABLE */}
      {subTab === 'history' && (
        <div className="glass-panel rounded-2xl p-6 border border-slate-800 space-y-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
            <div>
              <h3 className="text-base font-bold text-white">Issued Commercial Licenses</h3>
              <p className="text-xs text-slate-400">Track active client activations and remaining validity</p>
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <div className="relative flex-1 sm:w-64">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  placeholder="Search client, email or machine..."
                  value={historySearch}
                  onChange={(e) => setHistorySearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
                />
              </div>
              <button
                onClick={fetchHistory}
                className="p-2 bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-300 rounded-xl"
              >
                <RefreshCw size={16} className={loadingHistory ? 'animate-spin' : ''} />
              </button>
            </div>
          </div>

          {filteredLicenses.length === 0 ? (
            <div className="text-center py-12 text-slate-500 text-xs">
              No issued licenses found matching your search.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 uppercase tracking-wider text-[10px]">
                    <th className="py-3 px-3">Client</th>
                    <th className="py-3 px-3">Bound Machine ID</th>
                    <th className="py-3 px-3">Validity</th>
                    <th className="py-3 px-3">Sessions</th>
                    <th className="py-3 px-3">Status</th>
                    <th className="py-3 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {filteredLicenses.map((lic) => (
                    <tr key={lic.id} className="hover:bg-slate-900/40 transition-colors">
                      <td className="py-3 px-3">
                        <p className="font-bold text-white">{lic.client_name}</p>
                        <p className="text-[10px] text-slate-400">{lic.client_email}</p>
                      </td>
                      <td className="py-3 px-3">
                        <span className="font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20 text-[11px]">
                          {lic.machine_id}
                        </span>
                      </td>
                      <td className="py-3 px-3">
                        <p className="font-semibold text-slate-200">{lic.days_remaining}d remaining</p>
                        <p className="text-[10px] text-slate-500">{lic.validity_days} days total</p>
                      </td>
                      <td className="py-3 px-3 font-semibold text-slate-300">
                        {lic.sessions_limit} Profiles
                      </td>
                      <td className="py-3 px-3">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                          lic.status === 'active' && !lic.is_expired
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                            : lic.status === 'revoked'
                            ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                            : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                        }`}>
                          {lic.status === 'revoked' ? 'Revoked' : lic.is_expired ? 'Expired' : 'Active'}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => copyLicenseKeyOnly(lic.license_key)}
                            title="Copy License Key"
                            className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition-colors"
                          >
                            <Copy size={13} />
                          </button>
                          {lic.status === 'active' && (
                            <button
                              onClick={() => handleRevoke(lic.id, lic.client_name)}
                              title="Revoke License"
                              className="p-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 rounded-lg border border-rose-500/30 transition-colors"
                            >
                              <X size={13} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* SUBTAB 3: INSPECTOR / DECODER */}
      {subTab === 'inspector' && (
        <div className="glass-panel rounded-2xl p-6 border border-slate-800 space-y-6">
          <div className="pb-4 border-b border-slate-800">
            <h3 className="text-base font-bold text-white">License Key Inspector & Cryptographic Decoder</h3>
            <p className="text-xs text-slate-400">Paste any WALIC license token to verify its signature and unpack its permissions</p>
          </div>

          {inspectError && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400 text-xs flex items-center gap-2">
              <AlertTriangle size={16} />
              <span>{inspectError}</span>
            </div>
          )}

          <form onSubmit={handleInspect} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
                Enter WALIC Token
              </label>
              <textarea
                rows={3}
                required
                placeholder="WALIC.eyJjdXN0b21lciI6IkFjbWUiLCJub2RlTG9ja0lkIjoiV0EtV0lOLTEyMzQtNTY3OC...\"
                value={inspectKey}
                onChange={(e) => setInspectKey(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-emerald-300 font-mono text-xs focus:outline-none focus:border-emerald-500 transition-colors"
              />
            </div>

            <button
              type="submit"
              className="py-2.5 px-5 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-xl text-xs transition-colors flex items-center gap-1.5"
            >
              <Search size={14} />
              <span>Decode & Verify Signature</span>
            </button>
          </form>

          {inspectResult && (
            <div className="p-5 bg-slate-950 border border-slate-800 rounded-xl space-y-4 animate-fade-in">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {inspectResult.valid ? (
                    <span className="px-2.5 py-1 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-xs font-bold flex items-center gap-1">
                      <CheckCircle size={14} /> Valid Cryptographic Ed25519 Signature
                    </span>
                  ) : (
                    <span className="px-2.5 py-1 rounded bg-rose-500/20 text-rose-400 border border-rose-500/30 text-xs font-bold flex items-center gap-1">
                      <XCircle size={14} /> Signature Invalid or Key Tampered
                    </span>
                  )}
                </div>
              </div>

              {inspectResult.payload && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs bg-slate-900/60 p-4 rounded-xl border border-slate-800">
                  <div><span className="text-slate-500">Customer:</span> <strong className="text-white">{inspectResult.payload.customer}</strong></div>
                  <div><span className="text-slate-500">Bound Machine:</span> <strong className="font-mono text-emerald-400">{inspectResult.payload.nodeLockId}</strong></div>
                  <div><span className="text-slate-500">Issued At:</span> <span className="text-slate-300">{new Date(inspectResult.payload.issuedAt).toLocaleString()}</span></div>
                  <div><span className="text-slate-500">Expires At:</span> <span className="text-slate-300">{new Date(inspectResult.payload.expiryDate).toLocaleString()}</span></div>
                  <div><span className="text-slate-500">Max Sessions:</span> <span className="text-slate-300">{inspectResult.payload.maxSessions} Profiles</span></div>
                  <div><span className="text-slate-500">Features:</span> <span className="text-slate-300">{(inspectResult.payload.features || []).join(', ')}</span></div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* SUBTAB 4: STORE & PRICING CONFIGURATION HUB */}
      {subTab === 'store_config' && (
        <div className="glass-panel rounded-2xl p-6 border border-slate-800 space-y-6 animate-fade-in">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Sliders size={18} className="text-emerald-400" />
                <span>Store Branding, Live Pricing & Webhook Settings</span>
              </h3>
              <p className="text-xs text-slate-400">
                Modify pricing tiers, feature quotas, support details, and branding. Changes apply immediately to your live website.
              </p>
            </div>

            <button
              onClick={fetchStoreConfig}
              className="p-2 bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-300 rounded-xl flex items-center gap-1.5 text-xs font-semibold w-fit"
            >
              <RefreshCw size={14} className={loadingConfig ? 'animate-spin' : ''} />
              <span>Reload Config</span>
            </button>
          </div>

          {configSuccessMsg && (
            <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400 text-xs font-medium flex items-center gap-2">
              <CheckCircle size={16} />
              <span>{configSuccessMsg}</span>
            </div>
          )}

          {configErrorMsg && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400 text-xs font-medium flex items-center gap-2">
              <AlertTriangle size={16} />
              <span>{configErrorMsg}</span>
            </div>
          )}

          <form onSubmit={handleSaveStoreConfig} className="space-y-8">
            {/* Section 1: Store Branding & Support Info */}
            <div className="space-y-4">
              <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                <Tag size={14} className="text-emerald-400" />
                <span>1. General Branding & Customer Contacts</span>
              </h4>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Product Brand Name</label>
                  <input
                    type="text"
                    required
                    value={storeConfig.brandName || ''}
                    onChange={(e) => setStoreConfig({ ...storeConfig, brandName: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 text-xs focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Brand Tagline / Subhead</label>
                  <input
                    type="text"
                    value={storeConfig.brandTagline || ''}
                    onChange={(e) => setStoreConfig({ ...storeConfig, brandTagline: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 text-xs focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Support Email Address</label>
                  <input
                    type="email"
                    value={storeConfig.supportEmail || ''}
                    onChange={(e) => setStoreConfig({ ...storeConfig, supportEmail: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 text-xs focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Support WhatsApp Number</label>
                  <input
                    type="text"
                    value={storeConfig.supportWhatsapp || ''}
                    onChange={(e) => setStoreConfig({ ...storeConfig, supportWhatsapp: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 text-xs focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Windows .EXE Download URL</label>
                  <input
                    type="url"
                    required
                    value={storeConfig.downloadUrl || ''}
                    onChange={(e) => setStoreConfig({ ...storeConfig, downloadUrl: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 text-xs focus:outline-none focus:border-emerald-500 font-mono text-[11px]"
                  />
                </div>
              </div>
            </div>

            {/* Section 2: Payment Gateway Credentials */}
            <div className="space-y-4 pt-4 border-t border-slate-800">
              <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                <Lock size={14} className="text-amber-400" />
                <span>2. Payment Gateway Credentials (Razorpay)</span>
              </h4>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Razorpay Key ID</label>
                  <input
                    type="text"
                    placeholder="rzp_live_... (leave empty for test mock mode)"
                    value={storeConfig.razorpayKeyId || ''}
                    onChange={(e) => setStoreConfig({ ...storeConfig, razorpayKeyId: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 text-xs focus:outline-none focus:border-emerald-500 font-mono"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">If blank, checkout runs in Instant Test Mode.</p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Razorpay Key Secret</label>
                  <input
                    type="password"
                    placeholder="••••••••••••••••"
                    value={storeConfig.razorpayKeySecret || ''}
                    onChange={(e) => setStoreConfig({ ...storeConfig, razorpayKeySecret: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 text-xs focus:outline-none focus:border-emerald-500 font-mono"
                  />
                </div>
              </div>
            </div>

            {/* Section 3: Live Pricing & Tier Editor */}
            <div className="space-y-4 pt-4 border-t border-slate-800">
              <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                <Zap size={14} className="text-emerald-400" />
                <span>3. Commercial Pricing Plans & Feature Limits</span>
              </h4>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {(storeConfig.plans || []).map((plan, idx) => (
                  <div key={plan.id || idx} className="p-5 bg-slate-950 border border-slate-800 rounded-2xl space-y-4">
                    <div className="flex justify-between items-center pb-2 border-b border-slate-800">
                      <span className="font-bold text-white text-sm">{plan.name}</span>
                      <span className="text-[10px] font-mono uppercase bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded border border-emerald-500/20">
                        {plan.id}
                      </span>
                    </div>

                    <div className="space-y-3 text-xs">
                      <div>
                        <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-1">Plan Title</label>
                        <input
                          type="text"
                          value={plan.name || ''}
                          onChange={(e) => handlePlanChange(idx, 'name', e.target.value)}
                          className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-slate-200 text-xs"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-1">Display Price</label>
                          <input
                            type="text"
                            placeholder="₹4,999"
                            value={plan.price || ''}
                            onChange={(e) => handlePlanChange(idx, 'price', e.target.value)}
                            className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-emerald-300 font-bold text-xs"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-1">Price in Paise</label>
                          <input
                            type="number"
                            placeholder="499900"
                            value={plan.priceInPaise || ''}
                            onChange={(e) => handlePlanChange(idx, 'priceInPaise', parseInt(e.target.value) || 0)}
                            className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-slate-200 text-xs font-mono"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-1">Validity (Days)</label>
                          <input
                            type="number"
                            value={plan.validityDays || 30}
                            onChange={(e) => handlePlanChange(idx, 'validityDays', parseInt(e.target.value) || 30)}
                            className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-slate-200 text-xs font-mono"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-1">Profiles Quota</label>
                          <input
                            type="number"
                            value={plan.sessionsLimit || 1}
                            onChange={(e) => handlePlanChange(idx, 'sessionsLimit', parseInt(e.target.value) || 1)}
                            className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-slate-200 text-xs font-mono"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-1">Badge Tag</label>
                        <input
                          type="text"
                          placeholder="⭐ Most Popular"
                          value={plan.badge || ''}
                          onChange={(e) => handlePlanChange(idx, 'badge', e.target.value)}
                          className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-slate-200 text-xs"
                        />
                      </div>

                      <div className="flex items-center gap-4 pt-1">
                        <label className="flex items-center gap-1.5 cursor-pointer text-slate-300 text-[11px]">
                          <input
                            type="checkbox"
                            checked={Boolean(plan.turboAllowed)}
                            onChange={(e) => handlePlanChange(idx, 'turboAllowed', e.target.checked)}
                            className="rounded text-emerald-500"
                          />
                          <span>Turbo Mode</span>
                        </label>
                        <label className="flex items-center gap-1.5 cursor-pointer text-slate-300 text-[11px]">
                          <input
                            type="checkbox"
                            checked={Boolean(plan.multiSessionAllowed)}
                            onChange={(e) => handlePlanChange(idx, 'multiSessionAllowed', e.target.checked)}
                            className="rounded text-emerald-500"
                          />
                          <span>Multi-Device</span>
                        </label>
                      </div>

                      <div>
                        <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-1">Feature Bullets (1 per line)</label>
                        <textarea
                          rows={4}
                          value={(plan.features || []).join('\n')}
                          onChange={(e) => handlePlanFeaturesChange(idx, e.target.value)}
                          className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-slate-300 text-xs leading-relaxed"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Save Button */}
            <div className="pt-4 border-t border-slate-800 flex justify-end">
              <button
                type="submit"
                className="px-8 py-3.5 bg-emerald-500 hover:bg-emerald-600 font-bold text-white rounded-xl shadow-lg shadow-emerald-500/20 transition-all text-sm flex items-center gap-2"
              >
                <CheckCircle size={18} />
                <span>💾 Save Store & Pricing Configuration</span>
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// VIEW COMPONENT 10: SELF-SERVE PRICING & INSTANT LICENSE CHECKOUT
// ============================================================================
function PricingView({ onActivate }) {
  const [selectedPlan, setSelectedPlan] = useState('pro');
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [machineId, setMachineId] = useState('');
  const [loading, setLoading] = useState(false);
  const [orderResult, setOrderResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [copiedKey, setCopiedKey] = useState(false);

  const [plans, setPlans] = useState([]);

  useEffect(() => {
    // Attempt to auto-fill local machine id if available
    axios.get(`${API_BASE}/license/machine-id`)
      .then(res => {
        if (res.data?.machineId) setMachineId(res.data.machineId);
      })
      .catch(() => {});

    // Fetch dynamic store config / plans
    axios.get(`${API_BASE}/config/public`)
      .then(res => {
        if (Array.isArray(res.data?.plans) && res.data.plans.length > 0) {
          setPlans(res.data.plans);
          setSelectedPlan(res.data.plans[0].id);
        }
      })
      .catch(() => {});
  }, []);

  const handleCheckout = async (e) => {
    e.preventDefault();
    if (!customerEmail.trim()) {
      setErrorMsg('Please enter your email for license delivery.');
      return;
    }
    setErrorMsg('');
    setLoading(true);

    try {
      // 1. Create order
      const orderRes = await axios.post(`${API_BASE}/checkout/create-license-order`, {
        planId: selectedPlan,
        customerName: customerName.trim() || 'Customer',
        customerEmail: customerEmail.trim(),
        machineId: machineId.trim() || '*'
      });

      const orderData = orderRes.data;

      // 2. Handle Razorpay or Mock checkout
      if (orderData.mock || !window.Razorpay) {
        // Direct instant verification for mock / test checkout
        const verifyRes = await axios.post(`${API_BASE}/checkout/verify-license-payment`, {
          razorpay_order_id: orderData.orderId,
          razorpay_payment_id: `pay_${Date.now()}`,
          razorpay_signature: 'mock_valid_signature',
          planId: selectedPlan,
          customerName: customerName.trim() || 'Customer',
          customerEmail: customerEmail.trim(),
          machineId: machineId.trim() || '*'
        });

        setOrderResult(verifyRes.data);
      } else {
        const options = {
          key: orderData.key,
          amount: orderData.amount,
          currency: orderData.currency,
          name: 'WhatsApp Automator Pro',
          description: `${orderData.planName} Commercial License`,
          order_id: orderData.orderId,
          prefill: {
            name: customerName,
            email: customerEmail
          },
          theme: { color: '#10b981' },
          handler: async function (response) {
            try {
              const verifyRes = await axios.post(`${API_BASE}/checkout/verify-license-payment`, {
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
                planId: selectedPlan,
                customerName: customerName.trim() || 'Customer',
                customerEmail: customerEmail.trim(),
                machineId: machineId.trim() || '*'
              });
              setOrderResult(verifyRes.data);
            } catch (err) {
              setErrorMsg('Payment verification error: ' + (err.response?.data?.error || err.message));
            }
          }
        };
        const rzp = new window.Razorpay(options);
        rzp.open();
      }
    } catch (err) {
      setErrorMsg(err.response?.data?.error || 'Checkout initiation failed: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const copyKey = (key) => {
    navigator.clipboard.writeText(key);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  return (
    <div className="space-y-10 max-w-6xl">
      {/* Hero Header */}
      <div className="text-center space-y-3">
        <span className="text-xs font-bold uppercase tracking-widest text-emerald-400 bg-emerald-500/10 px-3 py-1 rounded-full border border-emerald-500/20">
          Commercial Software Licensing
        </span>
        <h2 className="text-3xl font-heading font-extrabold text-white tracking-tight">
          Simple, Transparent Pricing
        </h2>
        <p className="text-sm text-slate-400 max-w-lg mx-auto">
          Instant license key delivery with first-use hardware auto-locking. Download the Windows desktop app and automate in minutes.
        </p>
      </div>

      {/* SUCCESS MODAL ON PURCHASE */}
      {orderResult && (
        <div className="glass-panel rounded-2xl p-8 border border-emerald-500/40 bg-emerald-950/20 space-y-6 animate-fade-in shadow-2xl">
          <div className="flex items-center gap-3 text-emerald-400">
            <div className="w-12 h-12 rounded-2xl bg-emerald-500 flex items-center justify-center text-white shadow-lg shadow-emerald-500/30">
              <CheckCircle size={26} />
            </div>
            <div>
              <h3 className="text-xl font-bold text-white">Payment Successful & License Issued!</h3>
              <p className="text-xs text-slate-300">Your commercial license has been generated and is ready to use.</p>
            </div>
          </div>

          <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Your Commercial License Key</span>
              <span className="text-[10px] text-emerald-400 font-mono">Ed25519 Signed</span>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={orderResult.licenseKey}
                className="flex-1 px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-emerald-300 font-mono text-xs select-all focus:outline-none"
              />
              <button
                onClick={() => copyKey(orderResult.licenseKey)}
                className="px-3.5 py-2 bg-emerald-500 hover:bg-emerald-600 text-white font-bold rounded-lg text-xs transition-colors flex items-center gap-1 shrink-0"
              >
                {copiedKey ? <Check size={14} /> : <Copy size={14} />}
                <span>{copiedKey ? 'Copied!' : 'Copy Key'}</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div className="p-3 bg-slate-950/80 rounded-xl border border-slate-800">
              <span className="text-slate-500 block text-[10px] uppercase">Plan</span>
              <strong className="text-white">{orderResult.planName}</strong>
            </div>
            <div className="p-3 bg-slate-950/80 rounded-xl border border-slate-800">
              <span className="text-slate-500 block text-[10px] uppercase">Validity</span>
              <strong className="text-emerald-400">{orderResult.validityDays} Days</strong>
            </div>
            <div className="p-3 bg-slate-950/80 rounded-xl border border-slate-800">
              <span className="text-slate-500 block text-[10px] uppercase">Accounts Allowed</span>
              <strong className="text-white">{orderResult.sessionsLimit} Sessions</strong>
            </div>
            <div className="p-3 bg-slate-950/80 rounded-xl border border-slate-800">
              <span className="text-slate-500 block text-[10px] uppercase">Machine Lock</span>
              <strong className="text-amber-400 font-mono">{orderResult.machineId === '*' ? 'Auto-Locks on First Launch' : 'Bound'}</strong>
            </div>
          </div>

          <div className="p-4 bg-slate-900/60 rounded-xl border border-slate-800/80 space-y-3">
            <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
              <Sparkles size={14} className="text-emerald-400" />
              <span>Next Steps to Start Outreach:</span>
            </h4>
            <ol className="text-xs text-slate-300 space-y-1.5 list-decimal list-inside">
              <li>Download and install the Windows Desktop application below.</li>
              <li>Launch the app and paste your license key on the product activation screen.</li>
              <li>Scan your WhatsApp QR code and start sending campaigns safely!</li>
            </ol>

            <a
              href={orderResult.downloadUrl || 'https://github.com/ayushhbhuutada/whatsapp-automation/releases/latest/download/WhatsAppAutomationSetup.exe'}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-emerald-500 hover:bg-emerald-600 font-bold text-white text-xs rounded-xl shadow-lg shadow-emerald-500/20 transition-all mt-2"
            >
              <Download size={14} />
              <span>Download WhatsAppAutomationSetup.exe</span>
            </a>
          </div>
        </div>
      )}

      {/* Pricing Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-stretch">
        {(plans || []).map((plan) => {
          const isSelected = selectedPlan === plan.id;
          return (
            <div
              key={plan.id}
              onClick={() => setSelectedPlan(plan.id)}
              className={`glass-panel rounded-2xl p-6 border transition-all flex flex-col justify-between cursor-pointer relative ${
                isSelected
                  ? 'border-emerald-500 shadow-xl shadow-emerald-500/10 bg-slate-900/90'
                  : 'border-slate-800/80 hover:border-slate-700 bg-slate-900/40'
              }`}
            >
              {plan.popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-gradient-to-r from-emerald-500 to-teal-500 text-white font-extrabold text-[10px] tracking-wider uppercase rounded-full shadow-lg">
                  {plan.badge || '⭐ Most Popular'}
                </div>
              )}

              <div className="space-y-4">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-heading text-lg font-bold text-white">{plan.name}</h3>
                    <p className="text-xs text-slate-400 mt-1">{plan.desc}</p>
                  </div>
                  {!plan.popular && plan.badge && (
                    <span className="px-2 py-0.5 bg-slate-800 text-slate-300 text-[10px] font-bold rounded">
                      {plan.badge}
                    </span>
                  )}
                </div>

                <div className="pt-2 border-t border-slate-800/80">
                  <div className="flex items-baseline gap-1">
                    <span className="text-3xl font-heading font-extrabold text-white">{plan.price}</span>
                    <span className="text-xs text-slate-400 font-medium">{plan.period || ''}</span>
                  </div>
                </div>

                <ul className="space-y-2.5 pt-2 text-xs text-slate-300 border-t border-slate-800/60">
                  {(plan.features || []).map((feat, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <CheckCircle size={14} className="text-emerald-400 shrink-0 mt-0.5" />
                      <span>{feat}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="pt-6">
                <button
                  type="button"
                  onClick={() => setSelectedPlan(plan.id)}
                  className={`w-full py-2.5 rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-1.5 ${
                    isSelected
                      ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20'
                      : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
                  }`}
                >
                  <Zap size={14} />
                  <span>{isSelected ? 'Selected Plan' : 'Select Plan'}</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Checkout Form Box */}
      <div className="glass-panel max-w-xl mx-auto rounded-2xl p-6 sm:p-8 border border-slate-800 space-y-6">
        <div className="flex items-center gap-3 pb-4 border-b border-slate-800">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/15 text-emerald-400 flex items-center justify-center border border-emerald-500/20">
            <Lock size={18} />
          </div>
          <div>
            <h3 className="font-heading font-bold text-white text-base">Instant License Checkout</h3>
            <p className="text-xs text-slate-400">
              Selected: <strong className="text-emerald-400">{(plans || []).find(p => p.id === selectedPlan)?.name}</strong> ({(plans || []).find(p => p.id === selectedPlan)?.price})
            </p>
          </div>
        </div>

        {errorMsg && (
          <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400 text-xs flex items-center gap-2">
            <AlertTriangle size={16} />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleCheckout} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Your Full Name</label>
            <input
              type="text"
              required
              placeholder="John Doe"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 text-xs focus:outline-none focus:border-emerald-500 transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Your Email (License Sent Here)</label>
            <input
              type="email"
              required
              placeholder="name@company.com"
              value={customerEmail}
              onChange={(e) => setCustomerEmail(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 text-xs focus:outline-none focus:border-emerald-500 transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
              Machine ID <span className="text-slate-500 lowercase font-normal">(optional — auto-binds on first launch)</span>
            </label>
            <input
              type="text"
              placeholder="Leave blank for First-Use Auto-Lock, or paste WA-WIN-..."
              value={machineId}
              onChange={(e) => setMachineId(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-emerald-300 font-mono text-xs focus:outline-none focus:border-emerald-500 transition-colors"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 bg-emerald-500 hover:bg-emerald-600 font-bold text-white rounded-xl shadow-lg shadow-emerald-500/20 transition-all text-sm flex items-center justify-center gap-2 disabled:opacity-50 mt-2"
          >
            <ShieldCheck size={18} />
            <span>{loading ? 'Processing Payment...' : `⚡ Pay ${(plans || []).find(p => p.id === selectedPlan)?.price} & Get Instant License`}</span>
          </button>
        </form>
      </div>
    </div>
  );
}

// ============================================================================
// VIEW COMPONENT 11: PUBLIC PRODUCT LANDING, PRICING & DOWNLOAD PORTAL
// ============================================================================
function PublicLandingView({
  onOpenAdminModal,
  showAdminModal,
  onCloseAdminModal,
  adminPassword,
  setAdminPassword,
  adminError,
  onAdminLogin
}) {
  const [publicConfig, setPublicConfig] = useState({
    brandName: 'WhatsApp Automator Pro',
    brandTagline: 'Commercial Desktop Edition',
    downloadUrl: 'https://github.com/ayushhbhuutada/whatsapp-automation/releases/latest/download/WhatsAppAutomationSetup.exe',
    supportEmail: 'support@rudraexpression.in',
    supportWhatsapp: '+919876543210'
  });

  useEffect(() => {
    axios.get(`${API_BASE}/config/public`)
      .then(res => {
        if (res.data?.success) {
          setPublicConfig(prev => ({ ...prev, ...res.data }));
        }
      })
      .catch(() => {});
  }, []);

  const downloadUrl = publicConfig.downloadUrl || "https://github.com/ayushhbhuutada/whatsapp-automation/releases/latest/download/WhatsAppAutomationSetup.exe";

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col selection:bg-emerald-500 selection:text-slate-950">
      {/* Sticky Modern Glass Navbar */}
      <header className="glass-panel border-b border-slate-800/80 sticky top-0 z-50 backdrop-blur-xl px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-teal-700 rounded-xl flex items-center justify-center text-white shadow-lg shadow-emerald-500/20">
              <Send size={22} className="rotate-45" />
            </div>
            <div>
              <span className="font-heading text-base font-extrabold tracking-tight text-white block leading-tight">
                {publicConfig.brandName || 'WhatsApp Automator Pro'}
              </span>
              <span className="text-[10px] text-emerald-400 font-semibold tracking-widest uppercase">
                {publicConfig.brandTagline || 'Commercial Desktop Edition'}
              </span>
            </div>
          </div>

          <nav className="hidden md:flex items-center gap-8 text-xs font-semibold text-slate-300">
            <a href="#features" className="hover:text-emerald-400 transition-colors">Features</a>
            <a href="#antiban" className="hover:text-emerald-400 transition-colors">Anti-Ban Engine</a>
            <a href="#pricing" className="hover:text-emerald-400 transition-colors">Pricing & Buy</a>
          </nav>

          <div className="flex items-center gap-3">
            <button
              onClick={onOpenAdminModal}
              className="px-3.5 py-2 text-xs font-semibold text-slate-400 hover:text-white bg-slate-900/60 hover:bg-slate-800 border border-slate-800 rounded-xl transition-colors flex items-center gap-1.5"
            >
              <Lock size={13} />
              <span>Admin Portal</span>
            </button>

            <a
              href={downloadUrl}
              className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 font-bold text-white text-xs rounded-xl shadow-lg shadow-emerald-500/20 transition-all flex items-center gap-1.5"
            >
              <Download size={14} />
              <span>Download (.EXE)</span>
            </a>
          </div>
        </div>
      </header>

      {/* HERO SECTION */}
      <section className="relative overflow-hidden pt-20 pb-16 px-6 border-b border-slate-900">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="max-w-4xl mx-auto text-center space-y-6 relative z-10">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-bold uppercase tracking-wider">
            <Sparkles size={14} />
            <span>Windows 10 & 11 Desktop Software</span>
          </div>

          <h1 className="text-4xl sm:text-6xl font-heading font-extrabold text-white tracking-tight leading-tight">
            High-Velocity WhatsApp Outreach with <span className="text-emerald-400">0 Ban Risk</span>
          </h1>

          <p className="text-base sm:text-lg text-slate-400 max-w-2xl mx-auto leading-relaxed">
            Run automated outreach directly from your physical desktop. Features 6 active anti-ban circuit breakers, multi-account auto-split dispatch, and deep Spintax variations.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
            <a
              href={downloadUrl}
              className="w-full sm:w-auto px-8 py-4 bg-emerald-500 hover:bg-emerald-600 font-bold text-white text-sm rounded-xl shadow-xl shadow-emerald-500/25 transition-all flex items-center justify-center gap-2 text-center"
            >
              <Download size={18} />
              <span>Download Windows Installer (.EXE)</span>
            </a>
            <a
              href="#pricing"
              className="w-full sm:w-auto px-8 py-4 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-200 text-sm font-bold rounded-xl transition-all flex items-center justify-center gap-2 text-center"
            >
              <Zap size={18} className="text-amber-400" />
              <span>View Pricing & Buy License</span>
            </a>
          </div>

          <div className="pt-8 grid grid-cols-2 md:grid-cols-4 gap-4 text-xs font-medium text-slate-400 border-t border-slate-900 max-w-3xl mx-auto">
            <div className="p-3 bg-slate-900/40 rounded-xl border border-slate-800/60">
              <strong className="text-emerald-400 block text-sm font-bold">100% Offline</strong>
              <span>Zero Cloud Data Exposure</span>
            </div>
            <div className="p-3 bg-slate-900/40 rounded-xl border border-slate-800/60">
              <strong className="text-emerald-400 block text-sm font-bold">6 Anti-Ban Systems</strong>
              <span>Engagement Circuit Breakers</span>
            </div>
            <div className="p-3 bg-slate-900/40 rounded-xl border border-slate-800/60">
              <strong className="text-emerald-400 block text-sm font-bold">20 Accounts</strong>
              <span>Multi-Profile Auto-Split</span>
            </div>
            <div className="p-3 bg-slate-900/40 rounded-xl border border-slate-800/60">
              <strong className="text-emerald-400 block text-sm font-bold">Instant License</strong>
              <span>Auto-Locks on First Launch</span>
            </div>
          </div>
        </div>
      </section>

      {/* CORE FEATURES GRID */}
      <section id="features" className="py-20 px-6 max-w-6xl mx-auto space-y-12">
        <div className="text-center space-y-3">
          <span className="text-xs font-bold uppercase tracking-widest text-emerald-400 bg-emerald-500/10 px-3 py-1 rounded-full border border-emerald-500/20">
            Enterprise Architecture
          </span>
          <h2 className="text-3xl font-heading font-extrabold text-white">
            Engineered for Maximum Delivery & Account Safety
          </h2>
          <p className="text-sm text-slate-400 max-w-xl mx-auto">
            Everything you need to send personalized client communications without risking WhatsApp account bans.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            {
              icon: ShieldCheck,
              title: "6-Tier Anti-Ban Engine",
              desc: "Dynamic typing simulation, organic jitter delays, burst pauses, presence cycling, and engagement circuit breakers that auto-pause on zero replies."
            },
            {
              icon: Smartphone,
              title: "Multi-Account Auto-Split",
              desc: "Load balance 10,000+ contacts across 5 to 20 WhatsApp numbers in parallel. Automatically splits queues and switches senders seamlessly."
            },
            {
              icon: Sparkles,
              title: "Spintax & Hash Randomizer",
              desc: "Generate infinite dynamic message variations with zero-width character insertion to prevent Meta hash fingerprint matching."
            },
            {
              icon: FileSpreadsheet,
              title: "Excel & Sheets Importer",
              desc: "1-Click import from CSV, XLSX, or Google Sheets with automatic phone sanitization and dynamic custom field variable mapping."
            },
            {
              icon: Flame,
              title: "Turbo Mode Delivery",
              desc: "High-speed dispatch mode designed for established warmup accounts that can send messages at accelerated velocity."
            },
            {
              icon: Lock,
              title: "100% Offline Local Security",
              desc: "Runs directly on your computer via local SQLite. Your contacts, sessions, and client databases never leave your physical device."
            }
          ].map((feat, i) => {
            const Icon = feat.icon;
            return (
              <div key={i} className="glass-panel p-6 rounded-2xl border border-slate-800/80 hover:border-slate-700 transition-all space-y-3 bg-slate-900/40">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/15 text-emerald-400 flex items-center justify-center border border-emerald-500/20">
                  <Icon size={20} />
                </div>
                <h3 className="text-base font-bold text-white">{feat.title}</h3>
                <p className="text-xs text-slate-400 leading-relaxed">{feat.desc}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* ANTI-BAN ARCHITECTURE SECTION */}
      <section id="antiban" className="py-16 px-6 bg-slate-900/30 border-y border-slate-900">
        <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-10 items-center">
          <div className="space-y-5">
            <span className="text-xs font-bold uppercase tracking-widest text-emerald-400 bg-emerald-500/10 px-3 py-1 rounded-full border border-emerald-500/20">
              Proprietary Safety Layer
            </span>
            <h2 className="text-3xl font-heading font-extrabold text-white leading-tight">
              Why WhatsApp Automator Accounts Don't Get Banned
            </h2>
            <p className="text-xs text-slate-300 leading-relaxed">
              Standard web automators blast messages at robotic intervals from shared cloud servers. Our software runs natively inside your computer's Chromium instance and simulates organic human behavior.
            </p>

            <div className="space-y-3 pt-2">
              {[
                ["Typing Simulation", "Calculates variable typing speeds (30–60 WPM) based on message length before dispatch."],
                ["Engagement Auto-Throttle", "Tracks recipient replies in real-time. Automatically doubles delay if reply rate is low, and pauses if zero replies are received."],
                ["Organic Presence Cycling", "Simulates offline/online cycles between message batches to mirror human WhatsApp usage."],
                ["Reputation Trust Score", "Maintains an internal trust rating for each number to enforce conservative daily limits on newer SIMs."]
              ].map(([title, desc], idx) => (
                <div key={idx} className="flex items-start gap-3 text-xs">
                  <CheckCircle size={16} className="text-emerald-400 shrink-0 mt-0.5" />
                  <div>
                    <strong className="text-white block">{title}</strong>
                    <span className="text-slate-400">{desc}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="glass-panel p-6 rounded-2xl border border-slate-800 space-y-4 bg-slate-950/80">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Activity size={18} className="text-emerald-400" />
                <span className="text-xs font-bold text-white uppercase tracking-wider">Live Anti-Ban Diagnostics</span>
              </div>
              <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-[10px] font-bold rounded">
                Active & Protecting
              </span>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3 bg-slate-900 rounded-xl border border-slate-800 flex justify-between items-center">
                <span className="text-slate-400">Typing & Presence:</span>
                <span className="text-emerald-400 font-bold">Organic Simulation (35–55 WPM)</span>
              </div>
              <div className="p-3 bg-slate-900 rounded-xl border border-slate-800 flex justify-between items-center">
                <span className="text-slate-400">Jitter Delay Variance:</span>
                <span className="text-emerald-400 font-bold">Gaussian Jitter (±25%)</span>
              </div>
              <div className="p-3 bg-slate-900 rounded-xl border border-slate-800 flex justify-between items-center">
                <span className="text-slate-400">Content Hash Fingerprint:</span>
                <span className="text-emerald-400 font-bold">ZWSP Multi-Vector Diversification</span>
              </div>
              <div className="p-3 bg-slate-900 rounded-xl border border-slate-800 flex justify-between items-center">
                <span className="text-slate-400">Circuit Breaker Status:</span>
                <span className="text-emerald-400 font-bold">Armed (Auto-Pauses on 0 Replies)</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* PRICING & CHECKOUT SECTION */}
      <section id="pricing" className="py-20 px-6 max-w-6xl mx-auto w-full">
        <PricingView />
      </section>

      {/* ADMIN LOGIN MODAL */}
      {showAdminModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="glass-panel w-full max-w-sm p-6 rounded-2xl border border-slate-800 space-y-4 shadow-2xl relative">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-white font-bold text-sm">
                <ShieldCheck size={18} className="text-emerald-400" />
                <span>Admin License Console Login</span>
              </div>
              <button
                onClick={onCloseAdminModal}
                className="p-1 text-slate-400 hover:text-white rounded-lg"
              >
                <X size={16} />
              </button>
            </div>

            {adminError && (
              <div className="p-2.5 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400 text-xs flex items-center gap-2">
                <AlertTriangle size={14} />
                <span>{adminError}</span>
              </div>
            )}

            <form onSubmit={onAdminLogin} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
                  Admin Passkey
                </label>
                <input
                  type="password"
                  required
                  placeholder="Enter administrator password..."
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 text-xs focus:outline-none focus:border-emerald-500 transition-colors"
                />
              </div>

              <button
                type="submit"
                className="w-full py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white font-bold rounded-xl text-xs transition-colors shadow-lg shadow-emerald-500/20"
              >
                Sign In to Admin Console
              </button>
            </form>
          </div>
        </div>
      )}

      {/* FOOTER */}
      <footer className="border-t border-slate-900 py-10 px-6 text-center text-xs text-slate-500 space-y-4">
        <div className="flex items-center justify-center gap-3">
          <div className="w-6 h-6 bg-emerald-500 rounded-lg flex items-center justify-center text-white">
            <Send size={14} className="rotate-45" />
          </div>
          <span className="font-bold text-slate-300">{publicConfig.brandName || 'WhatsApp Automator Pro'}</span>
        </div>
        <p>© {new Date().getFullYear()} {publicConfig.brandName || 'WhatsApp Automator Pro'}. All rights reserved. {publicConfig.brandTagline || 'Commercial Desktop Edition'}.</p>
        {publicConfig.supportEmail && (
          <p className="text-[11px] text-slate-600">Support: <a href={`mailto:${publicConfig.supportEmail}`} className="text-slate-400 hover:text-emerald-400">{publicConfig.supportEmail}</a> {publicConfig.supportWhatsapp ? `| WhatsApp: ${publicConfig.supportWhatsapp}` : ''}</p>
        )}
      </footer>
    </div>
  );
}


