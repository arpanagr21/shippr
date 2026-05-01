import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import { initFirebase } from '@/lib/firebase';
import type { FirebaseRuntimeConfig } from '@/lib/firebase';

// In production the client is served by the same origin as the API (single container).
// In development VITE_API_URL points to the separate server (e.g. http://localhost:3069).
const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) || '';

async function bootstrap() {
  const res = await fetch(`${API_BASE}/api/config`);
  const cfg = await res.json() as FirebaseRuntimeConfig;
  initFirebase(cfg);

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <BrowserRouter>
      <App />
    </BrowserRouter>,
  );
}

void bootstrap();
