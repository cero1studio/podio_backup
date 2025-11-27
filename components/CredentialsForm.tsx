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
  const [useProxy, setUseProxy] = useState(false); // Default false para forzar uso de extensión en local
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Cargar datos guardados al montar
  useEffect(() => {
    const saved = localStorage.getItem('podio_creds_backup');
    if (saved) {
      try {
        const parsed = JSON.parse(atob(saved)); // Decode simple base64
        setClientId(parsed.clientId || '');
        setClientSecret(parsed.clientSecret || '');
        setUsername(parsed.username || '');
        setPassword(parsed.password || '');
        setUseProxy(parsed.useProxy ?? false);
        setRememberMe(true);
      } catch (e) {
        console.error("Error cargando credenciales guardadas", e);
      }
    }
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (clientId && clientSecret && username && password) {
      
      // Guardar o borrar credenciales
      if (rememberMe) {
        const toSave = JSON.stringify({ clientId, clientSecret, username, password, useProxy });
        localStorage.setItem('podio_creds_backup', btoa(toSave)); // Simple encoding
      } else {
        localStorage.removeItem('podio_creds_backup');
      }

      onSubmit({ clientId, clientSecret, username, password, useProxy });
    }
  };

  return (
    <div className="bg-white p-8 rounded-xl shadow-lg w-full max-w-md border border-gray-100">
      <div className="text-center mb-6">
        <div className="bg-green-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 relative group">
          <i className="fa-solid fa-network-wired text-green-600 text-2xl group-hover:scale-110 transition-transform"></i>
          {useProxy && <div className="absolute top-0 right-0 w-4 h-4 bg-blue-500 rounded-full border-2 border-white" title="Proxy Activado"></div>}
        </div>
        <h2 className="text-2xl font-bold text-gray-800">Conectar a Podio</h2>
        
        {/* Warning Box for CORS */}
        <div className="mt-4 bg-yellow-50 border border-yellow-200 p-3 rounded-lg text-left">
           <p className="text-[10px] text-yellow-800 font-semibold mb-1"><i className="fa-solid fa-triangle-exclamation"></i> IMPORTANTE (Localhost):</p>
           <p className="text-[10px] text-yellow-700 leading-tight">
             Para descargar archivos grandes y generar Excels sin errores, <strong>DESACTIVA el Proxy</strong> y usa la extensión de Chrome <span className="font-bold">"Allow CORS"</span>.
           </p>
        </div>
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
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 outline-none text-sm bg-gray-50"
                placeholder="Client ID"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Client Secret</label>
              <input
                type="password"
                required
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 outline-none text-sm bg-gray-50"
                placeholder="Client Secret"
              />
            </div>
        </div>
        
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Email de Usuario</label>
          <div className="relative">
            <span className="absolute left-3 top-2.5 text-gray-400"><i className="fa-solid fa-envelope"></i></span>
            <input
              type="email"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 outline-none transition"
              placeholder="usuario@dominio.com"
            />
          </div>
        </div>
        
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Contraseña</label>
          <div className="relative">
            <span className="absolute left-3 top-2.5 text-gray-400"><i className="fa-solid fa-lock"></i></span>
            <input
              type={showPassword ? "text" : "password"}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full pl-9 pr-10 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 outline-none transition"
              placeholder="Tu contraseña de Podio"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600 focus:outline-none"
              tabIndex={-1}
            >
              <i className={`fa-solid ${showPassword ? 'fa-eye-slash' : 'fa-eye'}`}></i>
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between text-xs text-gray-600 bg-gray-50 p-2 rounded">
           <label className="flex items-center cursor-pointer gap-2">
              <input 
                type="checkbox" 
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="rounded text-green-600 focus:ring-green-500"
              />
              Recordar datos
           </label>
           
           <label className="flex items-center cursor-pointer gap-2" title="Requerido SOLO si no tienes extensión CORS">
              <input 
                type="checkbox" 
                checked={useProxy}
                onChange={(e) => setUseProxy(e.target.checked)}
                className="rounded text-blue-600 focus:ring-blue-500"
              />
              <span className={useProxy ? 'text-blue-600 font-semibold' : ''}>Usar Proxy (Lento)</span>
           </label>
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className={`w-full py-3 px-4 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg transition duration-200 shadow-md transform active:scale-95 ${isLoading ? 'opacity-70 cursor-not-allowed' : ''}`}
        >
          {isLoading ? (
            <span className="flex items-center justify-center gap-2">
              <i className="fa-solid fa-circle-notch fa-spin"></i> Conectando...
            </span>
          ) : (
            'Iniciar Sesión'
          )}
        </button>
      </form>
      
      <div className="mt-4 text-center">
         <p className="text-[10px] text-gray-400">
           {useProxy 
             ? <span><i className="fa-solid fa-shield-halved text-blue-400"></i> Proxy Activado. Puede fallar con archivos grandes o Excels.</span>
             : <span><i className="fa-solid fa-bolt text-green-500"></i> Conexión Directa. Asegúrate de tener la extensión CORS activa.</span>
           }
         </p>
      </div>
    </div>
  );
};