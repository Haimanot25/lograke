import React, { Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import LoginPage from './pages/Login';
import { ToastProvider } from './context/ToastContext';
import { FileProvider } from './context/FileContext';
import { UIProvider } from './context/UIContext';
import AppShell from './AppShell';
import { RouteErrorBoundary } from './components/RouteErrorBoundary';

const UploadPage = React.lazy(() => import('./pages/Upload'));
const Dashboard = React.lazy(() => import('./pages/Dashboard'));
const Explorer = React.lazy(() => import('./pages/Explorer'));
const Patterns = React.lazy(() => import('./pages/Patterns'));
const Observability = React.lazy(() => import('./pages/Observability'));
const Alerts = React.lazy(() => import('./pages/Alerts'));
const Comparison = React.lazy(() => import('./pages/Comparison'));
const Statistics = React.lazy(() => import('./pages/Statistics'));
const Reports = React.lazy(() => import('./pages/Reports'));
const Health = React.lazy(() => import('./pages/Health'));
const LogGraph = React.lazy(() => import('./components/LogGraph'));
const ParserConfig = React.lazy(() => import('./pages/ParserConfig'));
const LiveTail = React.lazy(() => import('./pages/LiveTail'));
const Settings = React.lazy(() => import('./pages/Settings'));
const Sources = React.lazy(() => import('./pages/Sources'));

function RequireAuth() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <div className="loading-spinner" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return <Outlet />;
}

function SafeRoute({ children }) {
  return (
    <RouteErrorBoundary>
      <Suspense fallback={<PageLoader />}>{children}</Suspense>
    </RouteErrorBoundary>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <FileProvider>
          <UIProvider>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route element={<RequireAuth />}>
                <Route element={<AppShell />}>
                  <Route path="/upload" element={<SafeRoute><UploadPage /></SafeRoute>} />
                  <Route path="/sources" element={<SafeRoute><Sources /></SafeRoute>} />
                  <Route path="/dashboard" element={<SafeRoute><Dashboard /></SafeRoute>} />
                  <Route path="/explorer" element={<SafeRoute><Explorer /></SafeRoute>} />
                  <Route path="/livetail" element={<SafeRoute><LiveTail /></SafeRoute>} />
                  <Route path="/observability" element={<SafeRoute><Observability /></SafeRoute>} />
                  <Route path="/patterns" element={<SafeRoute><Patterns /></SafeRoute>} />
                  <Route path="/statistics" element={<SafeRoute><Statistics /></SafeRoute>} />
                  <Route path="/comparison" element={<SafeRoute><Comparison /></SafeRoute>} />
                  <Route path="/reports" element={<SafeRoute><Reports /></SafeRoute>} />
                  <Route path="/health" element={<SafeRoute><Health /></SafeRoute>} />
                  <Route path="/graph" element={<SafeRoute><LogGraph /></SafeRoute>} />
                  <Route path="/alerts" element={<SafeRoute><Alerts /></SafeRoute>} />
                  <Route path="/parser" element={<SafeRoute><ParserConfig /></SafeRoute>} />
                  <Route path="/settings" element={<SafeRoute><Settings /></SafeRoute>} />
                </Route>
                <Route path="*" element={<Navigate to="/upload" replace />} />
              </Route>
            </Routes>
          </UIProvider>
        </FileProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}

function PageLoader() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
      <div className="loading-spinner" />
    </div>
  );
}
