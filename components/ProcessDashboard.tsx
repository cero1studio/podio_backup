import React, { useEffect, useRef } from 'react';
import { AppStatus, BackupStats, ProcessLog, ApiStats } from '../types';

interface Props {
  status: AppStatus;
  stats: BackupStats;
  apiStats: ApiStats;
  logs: ProcessLog[];
  onDownload: () => void;
  onReset: () => void;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
}

export const ProcessDashboard: React.FC<Props> = ({
  status,
  stats,
  apiStats,
  logs,
  onDownload,
  onReset,
  onPause,
  onResume,
  onCancel
}) => {
  const logEndRef = useRef<HTMLDivElement>(null);
  
  const isProcessing = [
    AppStatus.DISCOVERING_STRUCTURE,
    AppStatus.PROCESSING_BATCHES,
    AppStatus.WRITING_TO_DISK
  ].includes(status);

  const isPaused = status === AppStatus.PAUSED;
  const isRestoring = status === AppStatus.RESTORE_SESSION;

  // Auto-scroll logs
  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  // Calcular porcentaje de uso de API
  const rateLimitPercent = apiStats.rateLimitLimit && apiStats.rateLimitRemaining 
      ? (apiStats.rateLimitRemaining / apiStats.rateLimitLimit) * 100 
      : 100;

  return (
    <div className="w-full max-w-6xl mx-auto space-y-6">
      
      {/* Header Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
        
        {/* Apps Progress */}
        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 col-span-2">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Progreso Global (Apps)</p>
          <div className="flex items-end gap-2 mt-1">
            <span className="text-xl font-bold text-gray-800">{stats.processedApps}</span>
            <span className="text-xs text-gray-400 mb-1">/ {stats.totalApps} Apps</span>
          </div>
          <div className="w-full bg-gray-100 h-1.5 mt-2 rounded-full overflow-hidden">
            <div 
              className={`h-full transition-all duration-300 ${status === AppStatus.DISCOVERING_STRUCTURE ? 'bg-yellow-400 animate-pulse' : 'bg-blue-500'}`}
              style={{ width: `${stats.totalApps > 0 ? (stats.processedApps / stats.totalApps) * 100 : 0}%` }}
            ></div>
          </div>
          <div className="flex justify-between mt-1 text-[10px] text-gray-400">
             <span>{stats.processedOrgs}/{stats.totalOrgs} Orgs</span>
             <span>{stats.processedSpaces}/{stats.totalSpaces} Espacios</span>
          </div>
        </div>

        {/* Item Count Stats */}
        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 col-span-1">
           <p className="text-xs text-gray-500 uppercase tracking-wide">Total Items</p>
           <div className="flex items-end gap-2 mt-2">
             <i className="fa-solid fa-list-ol text-purple-200 text-3xl"></i>
             <div className="flex flex-col">
                 <span className="text-lg font-bold text-purple-600 leading-none">
                     {stats.totalItems > 0 ? (stats.totalItems / 1000).toFixed(1) + 'k' : stats.totalItems}
                 </span>
                 <span className="text-[10px] text-gray-400">Registros</span>
             </div>
           </div>
        </div>
        
        {/* File Stats */}
        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 col-span-1">
           <p className="text-xs text-gray-500 uppercase tracking-wide">Archivos</p>
           <div className="flex items-end gap-2 mt-1">
             <span className="text-xl font-bold text-green-600">{stats.totalFilesDownloaded}</span>
             <span className="text-xs text-gray-400 mb-1">/ {stats.totalFilesFound}</span>
           </div>
           <p className="text-[10px] text-gray-400 mt-2">
              {stats.totalExcelsGenerated} Excels OK
           </p>
        </div>

        {/* API Stats (Spans 2 cols on md) */}
        <div className="col-span-2 bg-gray-900 p-4 rounded-xl shadow-sm border border-gray-800 text-white flex flex-col justify-between">
           <div className="flex justify-between items-start">
               <div>
                   <p className="text-xs text-gray-400 uppercase tracking-wide font-mono mb-1">API Calls</p>
                   <span className="text-2xl font-mono font-bold text-green-400">{apiStats.totalRequests}</span>
               </div>
               <div className="text-right">
                   <p className="text-xs text-gray-400 uppercase tracking-wide font-mono mb-1">Rate Limit</p>
                   <span className={`text-xl font-mono font-bold ${rateLimitPercent < 20 ? 'text-red-400' : 'text-blue-400'}`}>
                       {apiStats.rateLimitRemaining ?? '-'} / {apiStats.rateLimitLimit ?? '-'}
                   </span>
               </div>
           </div>
           
           <div className="mt-2">
               <div className="flex justify-between text-[10px] text-gray-500 font-mono mb-1">
                   <span>Capacity</span>
                   <span>{rateLimitPercent.toFixed(1)}% Available</span>
               </div>
               <div className="w-full bg-gray-700 h-1.5 rounded-full overflow-hidden">
                   <div 
                     className={`h-full transition-all duration-500 ${rateLimitPercent < 20 ? 'bg-red-500' : 'bg-blue-500'}`}
                     style={{ width: `${rateLimitPercent}%` }}
                   ></div>
               </div>
           </div>
        </div>

      </div>

      {/* Control Bar - Only Visible when Active or Paused */}
      {(isProcessing || isPaused) && (
        <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm flex items-center justify-between sticky top-4 z-20">
            <div className="flex items-center gap-3 text-sm">
                <i className={`fa-solid ${isPaused ? 'fa-pause' : 'fa-spinner fa-spin'} text-indigo-600`}></i>
                <div className="flex flex-wrap gap-2 items-center text-gray-700">
                    <span className="font-semibold">
                        {status === AppStatus.DISCOVERING_STRUCTURE ? 'Analizando:' : 'Procesando:'}
                    </span>
                    {stats.currentOrg && <span>{stats.currentOrg}</span>}
                    <span className="text-gray-300">/</span>
                    {stats.currentSpace && <span>{stats.currentSpace}</span>}
                    {stats.currentApp && (
                        <>
                            <span className="text-gray-300">/</span>
                            <span className="bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded text-xs font-medium border border-indigo-100">{stats.currentApp}</span>
                        </>
                    )}
                </div>
            </div>

            <div className="flex gap-2">
                {!isPaused ? (
                    <button 
                        onClick={onPause}
                        className="px-4 py-2 bg-orange-100 hover:bg-orange-200 text-orange-700 rounded-lg text-sm font-medium transition flex items-center gap-2 border border-orange-200"
                    >
                        <i className="fa-solid fa-pause"></i> Pausar
                    </button>
                ) : (
                    <button 
                        onClick={onResume}
                        className="px-4 py-2 bg-green-100 hover:bg-green-200 text-green-700 rounded-lg text-sm font-medium transition flex items-center gap-2 animate-pulse border border-green-200"
                    >
                        <i className="fa-solid fa-play"></i> Reanudar
                    </button>
                )}
                
                <button 
                    onClick={onCancel}
                    className="px-4 py-2 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg text-sm font-medium transition flex items-center gap-2 border border-red-200"
                >
                    <i className="fa-solid fa-stop"></i> Cancelar
                </button>
            </div>
        </div>
      )}

      {/* RESTORE SESSION ACTION */}
      {status === AppStatus.RESTORE_SESSION && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-8 text-center shadow-sm">
           <div className="mb-4">
              <i className="fa-solid fa-clock-rotate-left text-5xl text-amber-500 mb-2"></i>
              <h2 className="text-2xl font-bold text-gray-800">Backup Interrumpido Detectado</h2>
              <p className="text-gray-600 max-w-lg mx-auto mt-2">
                Se detectó un proceso anterior que llevaba <strong>{stats.processedApps} apps</strong> procesadas. 
                ¿Deseas continuarlo?
              </p>
           </div>
           <div className="flex gap-4 justify-center mt-6">
               <button 
                 onClick={onReset}
                 className="px-6 py-3 bg-gray-200 hover:bg-gray-300 text-gray-700 font-semibold rounded-lg shadow transition"
               >
                  Descartar y Empezar Nuevo
               </button>
               <button 
                 onClick={onDownload}
                 className="px-8 py-3 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-lg shadow-lg transform hover:scale-105 transition flex items-center gap-2"
               >
                  <i className="fa-solid fa-folder-open"></i> Seleccionar Carpeta y Reanudar
               </button>
           </div>
           <p className="text-xs text-gray-400 mt-4 italic">
             Nota: Por seguridad del navegador, debes volver a seleccionar la carpeta donde estabas guardando los archivos.
           </p>
        </div>
      )}

      {/* BIG ACTION BUTTON FOR READY STATE */}
      {status === AppStatus.READY_TO_BACKUP && (
        <div className="bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-xl p-8 text-center shadow-sm">
           <div className="mb-4">
              <i className="fa-solid fa-folder-open text-5xl text-green-500 mb-2"></i>
              <h2 className="text-2xl font-bold text-gray-800">¡Conexión Exitosa!</h2>
              <p className="text-gray-600 max-w-lg mx-auto">
                Hemos establecido comunicación con Podio. El siguiente paso requiere que autorices el acceso a una carpeta de tu disco duro para guardar todos los archivos.
              </p>
           </div>
           <button 
             onClick={onDownload}
             className="bg-green-600 hover:bg-green-700 text-white font-bold py-4 px-8 rounded-full shadow-lg transform hover:scale-105 transition-all text-lg flex items-center gap-3 mx-auto"
           >
              <i className="fa-solid fa-download"></i> Seleccionar Carpeta y Comenzar Backup
           </button>
           <p className="text-xs text-gray-400 mt-4"><i className="fa-solid fa-lock"></i> Tu carpeta es segura. Solo escribiremos archivos nuevos.</p>
        </div>
      )}

      {/* Main Content Area - Full Width Console */}
      <div className="w-full">
        
        {/* Console Logs */}
        <div className="space-y-4">
          <div className="bg-black rounded-xl shadow-lg border border-gray-800 overflow-hidden flex flex-col h-[500px]">
            <div className="px-4 py-2 bg-gray-800 border-b border-gray-700 flex justify-between items-center">
              <span className="text-gray-400 text-xs font-mono flex items-center gap-2">
                <i className="fa-solid fa-terminal"></i> SYSTEM_LOG
              </span>
              <span className="flex gap-1.5">
                <div className="w-2 h-2 rounded-full bg-red-500"></div>
                <div className="w-2 h-2 rounded-full bg-yellow-500"></div>
                <div className="w-2 h-2 rounded-full bg-green-500"></div>
              </span>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 space-y-1 font-mono text-xs scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-transparent">
              {logs.map((log, idx) => (
                <div key={idx} className="flex gap-3 hover:bg-gray-900 py-0.5 px-1 rounded">
                  <span className="text-gray-600 shrink-0 select-none w-16 text-right">
                    {log.timestamp && new Date(log.timestamp).toLocaleTimeString([], {hour12: false, hour: '2-digit', minute:'2-digit', second:'2-digit'})}
                  </span>
                  <span className={`break-all ${
                    log.type === 'error' ? 'text-red-500 font-bold' : 
                    log.type === 'warning' ? 'text-yellow-400' : 
                    log.type === 'success' ? 'text-green-400 font-bold' : 
                    log.type === 'network' ? 'text-gray-500' : 'text-blue-300'
                  }`}>
                    {log.type === 'network' && <i className="fa-solid fa-arrow-right text-[10px] mr-1 opacity-50"></i>}
                    {log.type === 'success' && '✓ '}
                    {log.type === 'error' && '✗ '}
                    {log.type === 'warning' && '! '}
                    {log.message}
                  </span>
                </div>
              ))}
              <div ref={logEndRef} />
            </div>
          </div>

          <div className="flex gap-3">
             {status === AppStatus.COMPLETED && (
               <div className="flex-1 bg-green-50 text-green-800 border border-green-200 px-4 py-3 rounded-lg flex items-center justify-center gap-3">
                  <i className="fa-solid fa-check-circle text-2xl text-green-600"></i>
                  <div className="text-left">
                      <p className="font-bold text-sm">Backup Finalizado</p>
                      <p className="text-xs opacity-80">Revisa tu disco duro.</p>
                  </div>
               </div>
             )}

             {status === AppStatus.CANCELLED && (
               <div className="flex-1 bg-red-50 text-red-800 border border-red-200 px-4 py-3 rounded-lg flex items-center justify-center gap-3">
                  <i className="fa-solid fa-ban text-2xl text-red-600"></i>
                  <div className="text-left">
                      <p className="font-bold text-sm">Backup Cancelado</p>
                      <p className="text-xs opacity-80">Se detuvo el proceso a petición del usuario.</p>
                  </div>
               </div>
             )}
             
             {(!isProcessing && !isPaused && status !== AppStatus.IDLE && status !== AppStatus.RESTORE_SESSION) && (
               <button onClick={onReset} className="px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm font-bold shadow-md ml-auto flex items-center gap-2">
                 <i className="fa-solid fa-rotate-right"></i> Nuevo Backup
               </button>
             )}
          </div>
        </div>

      </div>
    </div>
  );
};