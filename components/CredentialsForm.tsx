import React, { useState, useEffect } from 'react';
import { PodioGlobalCredentials } from '../types';

interface Props {
  onSubmit: (creds: PodioGlobalCredentials) => void;
  isLoading: boolean;
}

export const CredentialsForm: React.FC<Props> = ({ onSubmit, isLoading }) => {
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('podio_creds_backup');
    if (saved) {
      try {
        const parsed = JSON.parse(atob(saved));
        setClientId(parsed.clientId || '');
        setClientSecret(parsed.clientSecret || '');
        setUsername(parsed.username || '');
        setPassword(parsed.password || '');
        setRememberMe(true);
      } catch (e) {
        console.error("Error cargando credenciales", e);
      }
    }
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (clientId && clientSecret && username && password) {
      if (rememberMe) {
        const toSave = JSON.stringify({ clientId, clientSecret, username, password });
        localStorage.setItem('podio_creds_backup', btoa(toSave));
      } else {
        localStorage.removeItem('podio_creds_backup');
      }
      // useProxy siempre false, ya que usamos el proxy interno de Vite
      onSubmit({ clientId, clientSecret, username, password, useProxy: false });
    }
  };

  return (
    <div className="bg-white p-8 rounded-xl shadow-lg w-full max-w-md border border-gray-100">
      <div className="text-center mb-6">
        <div className="bg-indigo-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
          <i className="fa-solid fa-server text-indigo-600 text-2xl"></i>
        </div>
        <h2 className="text-2xl font-bold text-gray-800">Podio Local Backup</h2>
        <p className="text-xs text-gray-500 mt-2">
          Conexión segura a través de Proxy Local (Vite).<br/>
          <span className="text-green-600 font-semibold">CORS Solucionado.</span>
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Client ID</label>
              <input
                type="text"
                required
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm bg-gray-50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Client Secret</label>
              <input
                type="password"
                required
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm bg-gray-50"
              />
            </div>
        </div>
        
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Email</label>
          <input
            type="email"
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
          />
        </div>
        
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Contraseña</label>
          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full pl-3 pr-10 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600"
            >
              <i className={`fa-solid ${showPassword ? 'fa-eye-slash' : 'fa-eye'}`}></i>
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs text-gray-600">
            <input 
              type="checkbox" 
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
              className="rounded text-indigo-600 focus:ring-indigo-500"
            />
            Recordar datos
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className={`w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg shadow-md transition ${isLoading ? 'opacity-70 cursor-not-allowed' : ''}`}
        >
          {isLoading ? 'Conectando...' : 'Iniciar Sesión'}
        </button>
      </form>
    </div>
  );
};