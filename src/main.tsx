import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Missing root element for Kakarla Dairy Farm.');

createRoot(rootElement).render(<StrictMode><App /></StrictMode>);
