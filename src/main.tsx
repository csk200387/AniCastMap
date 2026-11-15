import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Analytics, type BeforeSend } from '@vercel/analytics/react';
import './styles/index.css';
import App from './App';

// Share links carry the sender's whole watched list in `?s=`: report those visits as plain page views.
const dropSharePayload: BeforeSend = (event) => {
  const url = new URL(event.url);
  url.searchParams.delete('s');
  return { ...event, url: url.toString() };
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <Analytics beforeSend={dropSharePayload} />
  </StrictMode>,
);
