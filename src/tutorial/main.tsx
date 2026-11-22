import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles.css';
import './tutorial.css';
import { TutorialApp } from './TutorialApp';

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('../sw.js', { scope: '../' }).catch(() => {});
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TutorialApp />
  </StrictMode>,
);
