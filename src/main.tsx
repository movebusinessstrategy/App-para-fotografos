import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { initSentry } from './integrations/sentry';
import { ErrorBoundary, reloadOnceForChunk } from './components/ErrorBoundary';

initSentry();

// Vite dispara este evento quando um módulo dinâmico (chunk) de um deploy antigo
// some — recarrega 1x pra pegar o build novo, ANTES de virar tela branca.
window.addEventListener('vite:preloadError', () => { reloadOnceForChunk(); });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
