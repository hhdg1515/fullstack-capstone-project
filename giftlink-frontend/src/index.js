import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import './index.css';
import App from './App';
import {AuthProvider} from './context/AuthContext';
import { UnsavedChangesProvider } from './forms/UnsavedChanges';

const router = createBrowserRouter([{ path: '*', element: <AuthProvider><UnsavedChangesProvider><App /></UnsavedChangesProvider></AuthProvider> }]);

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);

