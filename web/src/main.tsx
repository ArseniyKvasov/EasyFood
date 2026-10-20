import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'bootstrap/dist/css/bootstrap.min.css';
import './styles/tokens.css';
import './styles/app.css';
import App from './App';

const container = document.getElementById('root');
if (!container) throw new Error('Не найден элемент #root');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
