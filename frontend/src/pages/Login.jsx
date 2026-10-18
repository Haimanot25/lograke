import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { CheckCircle2, Loader2 } from 'lucide-react';

const FEATURES = [
  'Push & pull from webhooks, syslog, HTTP and SFTP',
  'AI-powered pattern detection and anomaly insights',
  'Real-time dashboards, comparisons and reports',
  'Self-hosted — your logs never leave your network',
];

function LoginPage() {
  const { login, register, loading } = useAuth();
  const navigate = useNavigate();
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const currentTheme = document.documentElement.getAttribute('data-theme') || 'black';
  const logoSrc = currentTheme === 'white' ? '/logowithtext-forwhitebg.png' : '/logowhitewithtext-forblackbg.png';
  const logoHeight = currentTheme === 'white' ? 72 : 46;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!username.trim() || !password.trim()) {
      setError('Please fill in all fields');
      return;
    }
    const result = isRegister
      ? await register(username.trim(), password)
      : await login(username.trim(), password);
    if (result.success) {
      navigate('/dashboard', { replace: true });
    } else {
      setError(result.error);
    }
  };

  return (
    <div className="login-layout">
      <div className="login-brand">
        <div className="login-brand-logo">
          <img src="/logowithouttext-forleftside.png" alt="LogRake" />
        </div>
        <div className="login-brand-content">
          <h2 className="login-brand-title">Every log. One rake.</h2>
          <p className="login-brand-sub">
            LogRake unifies ingestion, search and AI-driven analysis for every log source
            in your stack — without shipping data to a third party.
          </p>
          <ul className="login-features">
            {FEATURES.map((feature) => (
              <li key={feature} className="login-feature">
                <CheckCircle2 size={16} />
                <span>{feature}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="login-brand-foot">LogRake v2.0 · Self-hosted log intelligence</div>
      </div>

      <div className="login-panel">
        <div className="login-card">
          <div className="login-head">
            <img className="login-mobile-logo" src={logoSrc} alt="LogRake" style={{ height: Math.round(logoHeight * 0.75), marginBottom: 18 }} />
            <img className="login-desktop-logo" src={logoSrc} alt="LogRake" style={{ height: logoHeight }} />
            <h1 className="login-title">{isRegister ? 'Create your account' : 'Welcome back'}</h1>
            <p className="login-sub">
              {isRegister
                ? 'The first account becomes the administrator.'
                : 'Sign in to your LogRake workspace'}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="login-form">
            <div>
              <label className="login-label" htmlFor="login-username">Username</label>
              <input
                id="login-username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="input-text"
                placeholder={isRegister ? 'Username (min 3 characters)' : 'Enter username'}
                autoFocus
                autoComplete="username"
              />
            </div>
            <div>
              <label className="login-label" htmlFor="login-password">Password</label>
              <input
                id="login-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input-text"
                placeholder={isRegister ? 'Password (min 6 characters)' : 'Enter password'}
                autoComplete={isRegister ? 'new-password' : 'current-password'}
              />
            </div>

            {error && <div className="login-error">{error}</div>}

            <button type="submit" className="btn btn-primary login-btn" disabled={loading}>
              {loading ? (
                <><Loader2 size={14} className="animate-spin" /> Please wait…</>
              ) : isRegister ? (
                'Create Account'
              ) : (
                'Sign In'
              )}
            </button>
          </form>

          <div className="login-switch">
            <button
              type="button"
              onClick={() => { setIsRegister(!isRegister); setError(''); }}
            >
              {isRegister ? 'Already have an account? Sign in' : "Don't have an account? Register"}
            </button>
          </div>

          <div className="login-hint">
            First registration sets up the admin user. All processing runs on this server.
          </div>
        </div>
      </div>
    </div>
  );
}

export default LoginPage;
