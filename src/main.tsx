import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { DialogProvider } from './components/Dialogs';
import { ResettableApp } from './components/ResettableApp';
import { startSwUpdates } from './lib/swUpdate';
import './styles.css';

// オフラインでも開けるように、本番ビルドだけ Service Worker を登録する。
// 登録に失敗してもアプリはそのまま使える。新しい版は画面の案内から適用する。
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  const start = () => startSwUpdates();
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start, { once: true });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DialogProvider>
      <ResettableApp />
    </DialogProvider>
  </StrictMode>,
);
