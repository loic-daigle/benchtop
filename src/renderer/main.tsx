import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/base.css';
import './styles/dashboard.css';
import './styles/project.css';
import './styles/preview.css';
import './styles/highlight.css';
import './styles/features.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
