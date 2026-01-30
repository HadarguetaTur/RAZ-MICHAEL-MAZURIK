import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ToastHost from './components/ui/ToastHost';
import ConfirmDialogHost from './components/ui/ConfirmDialogHost';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <ToastHost>
      <ConfirmDialogHost>
        <App />
      </ConfirmDialogHost>
    </ToastHost>
  </React.StrictMode>
);
