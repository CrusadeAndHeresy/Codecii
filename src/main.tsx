import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

// The AI reasoning feature was removed; clear any key it left on this device.
try { localStorage.removeItem('ai-settings'); } catch { /* storage unavailable */ }

createRoot(document.getElementById('root')!).render(<App />);
