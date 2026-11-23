import { createRoot } from 'react-dom/client';
import App from './App';
import AuthGate from './AuthGate';
import './styles.css';
import { watchSystemTheme } from './theme';

watchSystemTheme();

// The AI reasoning feature was removed; clear any key it left on this device.
try { localStorage.removeItem('ai-settings'); } catch { /* storage unavailable */ }

createRoot(document.getElementById('root')!).render(<AuthGate><App /></AuthGate>);
