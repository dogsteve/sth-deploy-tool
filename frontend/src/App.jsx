import React, { useState, useEffect, useRef } from 'react';
import { Settings, Rocket, Terminal, Upload, CheckCircle2, AlertCircle, Eye, EyeOff, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const API_BASE = "http://localhost:8000";
const WS_BASE = "ws://localhost:8000";

const ServiceCard = ({ name, onDeploy, onUpload }) => {
  const [tag, setTag] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [uploadStatus, setUploadStatus] = useState(null); // 'uploading', 'success', 'error'

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setIsDragging(true);
    } else if (e.type === "dragleave") {
      setIsDragging(false);
    }
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      const file = files[0];
      if (file.name.endsWith('.tar')) {
        setUploadStatus('uploading');
        try {
          await onUpload(name, file);
          setUploadStatus('success');
          setTimeout(() => setUploadStatus(null), 3000);
        } catch (err) {
          setUploadStatus('error');
          setTimeout(() => setUploadStatus(null), 3000);
        }
      } else {
        alert("Please drop a .tar file");
      }
    }
  };

  return (
    <motion.div 
      className="glass-card"
      whileHover={{ y: -5 }}
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
    >
      <div className="service-header">
        <h3 style={{ margin: 0, color: 'var(--accent-purple)' }}>{name}</h3>
        {uploadStatus === 'success' && <CheckCircle2 size={16} color="#00FF41" />}
        {uploadStatus === 'error' && <AlertCircle size={16} color="#FF4B4B" />}
      </div>

      <div className="input-group">
        <label>Deploy Tag</label>
        <input 
          type="text" 
          placeholder="v1.0.0" 
          value={tag} 
          onChange={(e) => setTag(e.target.value)}
        />
      </div>

      <div 
        className={`drop-zone ${isDragging ? 'active' : ''}`}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
      >
        <Upload size={20} style={{ marginBottom: '0.5rem', opacity: 0.7 }} />
        <div style={{ fontSize: '0.75rem', opacity: 0.8 }}>
          {uploadStatus === 'uploading' ? 'Uploading...' : 'Drop .tar here'}
        </div>
      </div>

      <button 
        style={{ width: '100%', marginTop: '1.5rem' }}
        onClick={() => onDeploy(name, tag)}
        disabled={!tag}
      >
        <Rocket size={16} style={{ marginRight: '8px', verticalAlign: 'middle' }} />
        Deploy
      </button>
    </motion.div>
  );
};

function App() {
  const [config, setConfig] = useState({
    registry_url: '',
    git_repo_url: '',
    username: '',
    password: ''
  });
  const [showPass, setShowPass] = useState(false);
  const [logs, setLogs] = useState([]);
  const [services] = useState([
    "sth-local-api", "sth-local-worker", "sth-portal-api", "sth-portal-worker", "sth-portal-fe"
  ]);
  
  const terminalRef = useRef(null);
  const socketRef = useRef(null);

  useEffect(() => {
    // Fetch initial config
    fetch(`${API_BASE}/config`)
      .then(res => res.json())
      .then(data => setConfig(data));

    // WebSocket setup
    socketRef.current = new WebSocket(`${WS_BASE}/logs`);
    socketRef.current.onmessage = (event) => {
      setLogs(prev => [...prev.slice(-100), event.data]);
    };

    return () => {
      if (socketRef.current) socketRef.current.close();
    };
  }, []);

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [logs]);

  const handleConfigChange = (e) => {
    setConfig({ ...config, [e.target.name]: e.target.value });
  };

  const saveConfig = async () => {
    await fetch(`${API_BASE}/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config)
    });
    setLogs(prev => [...prev, "System: Configuration saved successfully."]);
  };

  const handleUpload = async (serviceName, file) => {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(`${API_BASE}/upload/${serviceName}`, {
      method: 'POST',
      body: formData
    });
    if (!res.ok) throw new Error("Upload failed");
    setLogs(prev => [...prev, `System: Uploaded ${file.name} for ${serviceName}`]);
  };

  const handleDeploy = async (serviceName, tag) => {
    await saveConfig(); // Auto-save config on deploy
    const res = await fetch(`${API_BASE}/deploy/${serviceName}?tag=${tag}`, {
      method: 'POST'
    });
    if (res.ok) {
      setLogs(prev => [...prev, `System: Triggered deployment for ${serviceName}:${tag}`]);
    }
  };

  return (
    <div className="app-container">
      {/* Sidebar */}
      <aside className="sidebar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '1rem' }}>
          <Settings size={22} color="var(--accent-purple)" />
          <h2 style={{ margin: 0, fontSize: '1.2rem' }}>SETTINGS</h2>
        </div>

        <div className="input-group">
          <label>Registry URL</label>
          <input name="registry_url" value={config.registry_url} onChange={handleConfigChange} />
        </div>

        <div className="input-group">
          <label>Git Repo URL</label>
          <input name="git_repo_url" value={config.git_repo_url} onChange={handleConfigChange} />
        </div>

        <div className="input-group">
          <label>Username</label>
          <input name="username" value={config.username} onChange={handleConfigChange} />
        </div>

        <div className="input-group">
          <label>Password</label>
          <div style={{ position: 'relative' }}>
            <input 
              name="password" 
              type={showPass ? 'text' : 'password'} 
              value={config.password} 
              onChange={handleConfigChange} 
              style={{ width: '100%', boxSizing: 'border-box' }}
            />
            <button 
              className="secondary" 
              onClick={() => setShowPass(!showPass)}
              style={{ position: 'absolute', right: '5px', top: '5px', padding: '4px 8px', height: 'auto' }}
            >
              {showPass ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </div>

        <button onClick={saveConfig} style={{ marginTop: '1rem' }}>Save Config</button>
      </aside>

      {/* Main Content */}
      <main className="main-content">
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1 style={{ margin: 0, fontSize: '2rem', fontWeight: 800 }}>
            STH <span style={{ color: 'var(--accent-purple)' }}>DEPLOY</span>
          </h1>
          <button className="secondary" onClick={() => setLogs([])}>Clear Terminal</button>
        </header>

        <section className="service-grid">
          {services.map(s => (
            <ServiceCard 
              key={s} 
              name={s} 
              onDeploy={handleDeploy} 
              onUpload={handleUpload} 
            />
          ))}
        </section>

        {/* Terminal Section */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div className="terminal-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Terminal size={14} />
              Deployment Logs
            </div>
            <span>v1.0_web</span>
          </div>
          <div className="terminal-container" ref={terminalRef}>
            {logs.map((log, i) => (
              <p key={i} className="terminal-line">{log}</p>
            ))}
            {logs.length === 0 && <p style={{ color: '#444' }}>Waiting for logs...</p>}
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
