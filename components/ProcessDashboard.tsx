import React, { useEffect, useRef } from 'react';
import { AppStatus, BackupStats, ProcessLog, ApiStats } from '../types';

interface Props {
  status: AppStatus;
  stats: BackupStats;
  apiStats: ApiStats;
  logs: ProcessLog[];
  onDownload: () => void;
  onReset: () => void;
}

export const ProcessDashboard: React.FC<Props> = ({
  status,
  stats,
  apiStats,
  logs,
  onDownload,
  onReset
}) => {
  const logEndRef = useRef<HTMLDivElement>(null);
  const isProcessing = [
    AppStatus.AUTHENTICATING,
    AppStatus.SELECTING_DIR,
    AppStatus.DISCOVERING_STRUCTURE,
    AppStatus.PROCESSING_BATCHES,
    AppStatus.WRITING_TO_DISK
  ].includes(status);

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
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        
        {/* Apps Progress */}
        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Apps Procesadas</p>
          <div className="flex items-end gap-2 mt-1">
            <span className="text-xl font-bold text-gray-800">{stats.processedApps}</span>
            <span className="text-xs text-gray-400 mb-1">/ {stats.totalApps}</span>
          </div>
          <div className="w-full bg-gray-100 h-1.5 mt-2 rounded-full overflow-hidden">
            <div 
              className="bg-blue-500 h-full transition-all duration-300"
              style={{ width: `${stats.totalApps > 0 ? (stats.processedApps / stats.totalApps) * 100 : 0}%` }}
            ></div>
          </div>
        </div>
        
        {/* File Stats */}
        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100">
           <p className="text-xs text-gray-500 uppercase tracking-wide">Archivos Guardados</p>
           <div className="flex items-end gap-2 mt-1">
             <span className="text-xl font-bold text-green-600">{stats.totalFilesDownloaded}</span>
             <span className="text-xs text-gray-400 mb-1">/ {stats.totalFilesFound}</span>
           </div>
        </div>

        {/* Status */}
        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 border-l-4 border-l-indigo-500">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Estado Actual</p>
          <p className="text-sm font-bold text-gray-800 mt-1 truncate">
            {status === AppStatus.IDLE && 'Esperando'}
            {status === AppStatus.AUTHENTICATING && 'Autenticando...'}
            {status === AppStatus.READY_TO_BACKUP && 'Esperando Confirmación'}
            {status === AppStatus.SELECTING_DIR && 'Selecciona Carpeta...'}
            {status === AppStatus.DISCOVERING_STRUCTURE && 'Escaneando...'}
            {status === AppStatus.WRITING_TO_DISK && 'Guardando...'}
            {status === AppStatus.COMPLETED && 'Completado'}
            {status === AppStatus.ERROR && 'Error'}
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

      {/* Progress Monitor - Current Action */}
      {isProcessing && (
        <div className="bg-blue-50 p-3 rounded-lg border border-blue-100 flex items-center gap-3 text-sm">
             <i className="fa-solid fa-spinner fa-spin text-blue-600"></i>
             <div className="flex flex-wrap gap-2 items-center text-blue-900">
                <span className="font-semibold">Procesando:</span>
                 {stats.currentOrg && <span><i className="fa-regular fa-building text-blue-400"></i> {stats.currentOrg}</span>}
                 <span className="text-blue-300">/</span>
                 {stats.currentSpace && <span><i className="fa-regular fa-folder text-blue-400"></i> {stats.currentSpace}</span>}
                 <span className="text-blue-300">/</span>
                 {stats.currentApp && <span className="bg-white px-2 py-0.5 rounded shadow-sm font-medium"><i className="fa-solid fa-table text-blue-500"></i> {stats.currentApp}</span>}
             </div>
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
        
        {/* Left: Console Logs */}
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
                    {log.timestamp.toLocaleTimeString([], {hour12: false, hour: '2-digit', minute:'2-digit', second:'2-digit'})}
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
             
             {(!isProcessing && status !== AppStatus.IDLE) && (
               <button onClick={onReset} className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition text-sm font-medium">
                 Reiniciar
               </button>
             )}
          </div>
        </div>

      </div>
    </div>
  );
};