import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'bootstrap/dist/css/bootstrap.min.css';
import './styles/tokens.css';
import './styles/app.css';
import App from './App';
import AdminApp from './admin/AdminApp';
import PrintReport from './components/PrintReport';

const container = document.getElementById('root');
if (!container) throw new Error('Не найден элемент #root');

const isAdminPage = window.location.pathname.includes('/admin');
const isPrintPage = window.location.pathname.includes('/print');

createRoot(container).render(
  <StrictMode>
    {isPrintPage ? <PrintReport /> : isAdminPage ? <AdminApp /> : <App />}
  </StrictMode>,
);
