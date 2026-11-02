import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { SessionProvider, ToastProvider } from './context';
import { App } from './app';
import './styles.css';

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } } });
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><QueryClientProvider client={queryClient}><BrowserRouter><SessionProvider><ToastProvider><App /></ToastProvider></SessionProvider></BrowserRouter></QueryClientProvider></React.StrictMode>);
