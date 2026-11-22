import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles.css';
import './tutorial.css';
import { TutorialApp } from './TutorialApp';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TutorialApp />
  </StrictMode>,
);
