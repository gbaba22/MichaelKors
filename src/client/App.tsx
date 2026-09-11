import { AdminApp } from './admin/AdminApp.js';
import { AssessApp } from './assess/AssessApp.js';

/**
 * Two apps behind one deployment: /admin is the configuration and analytics
 * console, everything else is the assessment link business users are sent.
 * A path check is enough - there is no navigation between the two.
 */
export function App() {
  const isAdmin = window.location.pathname.replace(/\/+$/, '') === '/admin';
  return isAdmin ? <AdminApp /> : <AssessApp />;
}
