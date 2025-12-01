import React, { useState, useCallback, useRef, useEffect } from 'react';
import { PodioGlobalCredentials, AppStatus, ProcessLog, BackupStats, FileSystemDirectoryHandle, ApiStats, BackupPlan, PersistedState, PodioFile } from './types';
import { CredentialsForm } from './components/CredentialsForm';
import { ProcessDashboard } from './components/ProcessDashboard';
import { PodioService } from './services/podioService';
import { FileSystemService } from './services/fileSystemService';
import JSZip from 'jszip';
import FileSaver from 'file-saver';

const App: React.FC = () => {
  const [status, setStatus] = useState<AppStatus>(AppStatus.IDLE);
  const [logs, setLogs] = useState<ProcessLog[]>([]);
  const [isTestMode, setIsTestMode] = useState(false);
  
  // Persisted Plan (for resuming)
  const [restoredPlan, setRestoredPlan] = useState<BackupPlan[] | null>(null);
  const [restoredCreds, setRestoredCreds] = useState<PodioGlobalCredentials | null>(null);

  // Stats State
  const [stats, setStats] = useState<BackupStats>({
    totalOrgs: 0, processedOrgs: 0,
    totalSpaces: 0, processedSpaces: 0,
    totalApps: 0, processedApps: 0,
    totalItems: 0,
    totalExcelsGenerated: 0,
    totalFilesFound: 0,
    totalFilesDownloaded: 0
  });
  const [apiStats, setApiStats] = useState<ApiStats>({
    totalRequests: 0, rateLimitLimit: null, rateLimitRemaining: null
  });
  
  // Refs for services and flow control
  const podioServiceRef = useRef<PodioService | null>(null);
  
  // Control Flow Ref: Allows changing execution state without re-rendering loops
  const controlRef = useRef({
    isPaused: false,
    isCancelled: false
  });

  const addLog = useCallback((message: string, type: ProcessLog['type'] = 'info') => {
    setLogs(prev => {
        const newLogs = [...prev, { timestamp: new Date(), message, type }];
        if (newLogs.length > 500) return newLogs.slice(newLogs.length - 500);
        return newLogs;
    });
  }, []);

  // --- PERSISTENCE LOGIC ---
  // Save state to localStorage periodically
  useEffect(() => {
    const interval = setInterval(() => {
        if ([AppStatus.WRITING_TO_DISK, AppStatus.PROCESSING_BATCHES, AppStatus.PAUSED].includes(status)) {
            const state: PersistedState = {
                stats,
                logs: logs.slice(-50), // Save last 50 logs only
                token: podioServiceRef.current?.getSession() || null,
                credentials: restoredCreds || null, // We need creds to recreate service
                isTestMode,
                plan: restoredPlan // We save the plan so we don't have to rescan
            };
            localStorage.setItem('podio_active_backup', JSON.stringify(state));
        }
    }, 5000);
    return () => clearInterval(interval);
  }, [status, stats, logs, isTestMode, restoredPlan, restoredCreds]);

  // Load state on Mount
  useEffect(() => {
    const saved = localStorage.getItem('podio_active_backup');
    if (saved) {
        try {
            const parsed: PersistedState = JSON.parse(saved);
            // If the backup wasn't completed or cancelled, offer resume
            if (parsed.token && parsed.credentials) {
                setStats(parsed.stats);
                setLogs(parsed.logs);
                setIsTestMode(parsed.isTestMode);
                setRestoredPlan(parsed.plan);
                setRestoredCreds(parsed.credentials);
                
                // Rehydrate Service
                const podioService = new PodioService(
                    parsed.credentials,
                    (newApiStats) => setApiStats(newApiStats),
                    (msg) => addLog(msg, 'network')
                );
                podioService.setSession(parsed.token);
                podioServiceRef.current = podioService;

                setStatus(AppStatus.RESTORE_SESSION);
                addLog("Sesión previa detectada. Listo para reanudar.", "warning");
            }
        } catch (e) {
            console.error("Error restaurando sesión:", e);
            localStorage.removeItem('podio_active_backup');
        }
    }
  }, []);

  // --- CONTROL HANDLERS ---
  const handlePause = () => {
    controlRef.current.isPaused = true;
    setStatus(AppStatus.PAUSED);
    addLog("=== PROCESO PAUSADO POR USUARIO ===", 'warning');
  };

  const handleResume = () => {
    controlRef.current.isPaused = false;
    setStatus(AppStatus.WRITING_TO_DISK); 
    addLog("=== REANUDANDO PROCESO ===", 'success');
  };

  const handleCancel = () => {
    if (window.confirm("¿Seguro que deseas cancelar el backup? El progreso actual se mantendrá en disco.")) {
        controlRef.current.isCancelled = true;
        controlRef.current.isPaused = false; // Unpause to let loop exit
        setStatus(AppStatus.CANCELLED);
        addLog("!!! CANCELANDO... ESPERANDO A QUE TERMINE LA TAREA ACTUAL !!!", 'error');
        localStorage.removeItem('podio_active_backup');
    }
  };

  // --- CHECKPOINT FUNCTION ---
  // This must be awaited inside loops to enforce Pause/Cancel
  const checkControlFlow = async () => {
    if (controlRef.current.isCancelled) {
        throw new Error("CANCELLED_BY_USER");
    }
    
    while (controlRef.current.isPaused) {
        if (controlRef.current.isCancelled) throw new Error("CANCELLED_BY_USER");
        await new Promise(resolve => setTimeout(resolve, 500));
    }
  };

  const handleConnect = async (creds: PodioGlobalCredentials) => {
    setStatus(AppStatus.AUTHENTICATING);
    setLogs([]);
    setIsTestMode(creds.isTestMode);
    setRestoredCreds(creds); // Save for persistence
    
    // Reset control refs
    controlRef.current = { isPaused: false, isCancelled: false };
    
    setStats({ 
        totalOrgs: 0, processedOrgs: 0,
        totalSpaces: 0, processedSpaces: 0,
        totalApps: 0, processedApps: 0, 
        totalItems: 0,
        totalExcelsGenerated: 0, totalFilesFound: 0, totalFilesDownloaded: 0 
    });
    setApiStats({ totalRequests: 0, rateLimitLimit: null, rateLimitRemaining: null });
    
    addLog(`Iniciando conexión con usuario: ${creds.username}...`, "info");
    addLog("Usando Vite Local Proxy para máximo rendimiento.", "success");
    if (creds.isTestMode) {
        addLog("MODO TEST ACTIVADO: Se limitará a 1 Espacio y parará al llegar a 10 archivos.", "warning");
    }
    
    const podioService = new PodioService(
        creds,
        (newApiStats) => setApiStats(newApiStats),
        (msg) => addLog(msg, 'network')
    );
    podioServiceRef.current = podioService;

    try {
      await podioService.authenticate();
      addLog("¡Conexión establecida correctamente! Token recibido.", "success");
      addLog("Esperando selección de carpeta de destino...", "info");
      
      setStatus(AppStatus.READY_TO_BACKUP);

    } catch (error: any) {
      addLog(`Error de Conexión: ${error.message}`, "error");
      setTimeout(() => setStatus(AppStatus.IDLE), 3000);
    }
  };

  const handleSelectFolder = async () => {
    if (!podioServiceRef.current) return;
    
    setStatus(AppStatus.SELECTING_DIR);
    const fsService = new FileSystemService();
    
    try {
      const rootDirHandle = await fsService.selectDirectory();
      addLog("Carpeta seleccionada con permisos de escritura. Iniciando backup...", "success");
      await runDiskBackup(podioServiceRef.current, fsService, rootDirHandle);
    } catch (err: any) {
      if (err.message && (err.message.includes('Cross origin') || err.message.includes('security'))) {
        addLog("! Detectado bloqueo de seguridad del navegador (Iframe).", "warning");
        addLog(">>> Cambiando a MODO ZIP (Fallback)...", "info");
        await runZipBackup(podioServiceRef.current);
      } else if (err.message.includes("User activation") || err.message.includes("permisos")) {
        addLog("ERROR DE PERMISOS: Debes conceder permisos de EDICIÓN/ESCRITURA en la ventana emergente del navegador.", "error");
        setStatus(AppStatus.READY_TO_BACKUP); // Go back to ready
      } else {
        addLog(`Selección de carpeta cancelada: ${err.message}`, "warning");
        setStatus(AppStatus.READY_TO_BACKUP);
      }
    }
  };

  // --- PARALLEL FILE PROCESSING ---
  const processParallelFiles = async (
    podio: PodioService, 
    fs: FileSystemService, 
    filesDir: FileSystemDirectoryHandle,
    files: PodioFile[]
  ) => {
      const CHUNK_SIZE = 5; // Descargar 5 a la vez
      
      for (let i = 0; i < files.length; i += CHUNK_SIZE) {
          await checkControlFlow(); // Check pause/cancel between chunks

          const chunk = files.slice(i, i + CHUNK_SIZE);
          
          const promises = chunk.map(async (file) => {
              try {
                  const blob = await podio.downloadFileContent(file.link);
                  if (blob) {
                      await fs.writeFile(filesDir, file.name, blob);
                      return true;
                  }
              } catch (e: any) {
                  addLog(`Error descargando ${file.name}: ${e.message}`, 'error');
              }
              return false;
          });

          const results = await Promise.all(promises);
          const successCount = results.filter(r => r).length;
          
          setStats(prev => ({ 
              ...prev, 
              totalFilesDownloaded: prev.totalFilesDownloaded + successCount 
          }));
      }
  };


  const runDiskBackup = async (
    podio: PodioService, 
    fs: FileSystemService, 
    rootDir: FileSystemDirectoryHandle
  ) => {
    setStatus(AppStatus.DISCOVERING_STRUCTURE);
    
    try {
      // Configuración de límites según modo Test
      const MAX_SPACES = isTestMode ? 1 : 9999;
      const MAX_APPS = 9999; 
      const EXCEL_LIMIT = isTestMode ? 50 : 20000;
      const FILES_LIMIT_PER_APP = isTestMode ? 10 : 5000; 
      const GLOBAL_FILES_STOP_LIMIT = isTestMode ? 10 : 99999999;

      let backupPlan: BackupPlan[] = [];

      // Si tenemos un plan restaurado y estamos reanudando, lo usamos.
      // Si no, escaneamos.
      if (restoredPlan && restoredPlan.length > 0) {
          addLog("=== REANUDANDO SESIÓN: Usando plan de backup previo ===", "success");
          backupPlan = restoredPlan;
      } else {
          // --- FASE 1: DESCUBRIMIENTO ---
          addLog("=== FASE 1: ESCANEO DE ESTRUCTURA ===", "info");
          await checkControlFlow();

          const orgs = await podio.getOrganizations();
          let totalAppsCount = 0;
          let totalSpacesCount = 0;
          let totalItemsCount = 0;

          setStats(prev => ({ ...prev, totalOrgs: orgs.length }));
          addLog(`Se encontraron ${orgs.length} organizaciones.`, "info");

          for (const org of orgs) {
              await checkControlFlow();
              const allSpaces = await podio.getSpaces(org.org_id);
              const spacesToProcess = allSpaces.slice(0, MAX_SPACES);
              const spacePlans = [];
              totalSpacesCount += spacesToProcess.length;
              setStats(prev => ({ ...prev, totalSpaces: totalSpacesCount }));

              for (const space of spacesToProcess) {
                  await checkControlFlow();
                  const allApps = await podio.getApps(space.space_id);
                  const appsToProcess = allApps.slice(0, MAX_APPS);
                  totalAppsCount += appsToProcess.length;
                  appsToProcess.forEach(app => { totalItemsCount += (app.item_count || 0); });

                  setStats(prev => ({ ...prev, totalApps: totalAppsCount, totalItems: totalItemsCount }));
                  spacePlans.push({ space, apps: appsToProcess });
              }
              backupPlan.push({ org, spaces: spacePlans });
          }
          // Guardar el plan para futuro
          setRestoredPlan(backupPlan);
          addLog(`ESCANEADO COMPLETO: ${totalItemsCount} Registros (Items) en ${totalAppsCount} Apps.`, "success");
      }

      // --- FASE 2: EJECUCIÓN ---
      setStatus(AppStatus.WRITING_TO_DISK);
      addLog("=== FASE 2: INICIANDO DESCARGA (Paralela x5) ===", "info");

      // Si reanudamos, stats.totalFilesDownloaded ya tiene un valor.
      // Debemos asegurarnos de no resetearlo a 0 arriba.
      // El GLOBAL_FILES_STOP_LIMIT en modo test debe considerar lo que YA se descargó.
      
      for (const orgPlan of backupPlan) {
        if (isTestMode && stats.totalFilesDownloaded >= GLOBAL_FILES_STOP_LIMIT) break;
        await checkControlFlow();

        const { org, spaces } = orgPlan;
        setStats(prev => ({ ...prev, currentOrg: org.name }));
        
        const orgDir = await fs.getDirectory(rootDir, org.name);
        
        for (const spacePlan of spaces) {
          if (isTestMode && stats.totalFilesDownloaded >= GLOBAL_FILES_STOP_LIMIT) break;
          await checkControlFlow();

          const { space, apps } = spacePlan;
          setStats(prev => ({ ...prev, currentSpace: space.name }));
          
          const spaceDir = await fs.getDirectory(orgDir, space.name);

          for (const app of apps) {
            if (isTestMode && stats.totalFilesDownloaded >= GLOBAL_FILES_STOP_LIMIT) {
                 addLog(`Límite de Modo Test alcanzado (${GLOBAL_FILES_STOP_LIMIT} archivos). Deteniendo...`, "warning");
                 break;
            }
            await checkControlFlow();

            setStats(prev => ({ ...prev, currentApp: app.config.name }));
            const appDir = await fs.getDirectory(spaceDir, app.config.name);
            
            // --- EXCEL ---
            // Solo generamos Excel si no lo hemos contado ya (lógica simple de reanudación)
            // O podemos sobrescribirlo por seguridad.
            addLog(`Verificando/Generando Excel para '${app.config.name}'...`, "network");
            let batchId = -1;
            try {
               batchId = await podio.triggerAppExcelExport(app.app_id, EXCEL_LIMIT);
            } catch (ex) {
               addLog(`Fallo al solicitar Excel: ${ex}`, "error");
            }
            
            if (batchId !== -1) {
              await checkControlFlow(); 
              const batchResult = await podio.waitForBatch(batchId);
              if (batchResult && batchResult.file) {
                 const excelBlob = await podio.downloadFileContent(batchResult.file.link);
                 if (excelBlob) {
                   await fs.writeFile(appDir, `${app.config.name}.xlsx`, excelBlob);
                   setStats(prev => ({ ...prev, totalExcelsGenerated: prev.totalExcelsGenerated + 1 }));
                   addLog(`Excel guardado: ${app.config.name}.xlsx`, "success");
                 }
              }
            }

            // --- FILES (PARALLEL) ---
            await checkControlFlow();
            const files = await podio.getAppFiles(app.app_id, FILES_LIMIT_PER_APP);
            setStats(prev => ({ ...prev, totalFilesFound: prev.totalFilesFound + files.length }));
            
            if (files.length > 0) {
              const filesDir = await fs.getDirectory(appDir, "Files");
              
              // NEW: Parallel Processing
              await processParallelFiles(podio, fs, filesDir, files);

              const metadata = JSON.stringify(files, null, 2);
              await fs.writeFile(appDir, "_files_metadata.json", metadata);
            }

            setStats(prev => ({ ...prev, processedApps: prev.processedApps + 1 }));
          }
          setStats(prev => ({ ...prev, processedSpaces: prev.processedSpaces + 1 }));
        }
        setStats(prev => ({ ...prev, processedOrgs: prev.processedOrgs + 1 }));
      }
      
      addLog("¡Backup Completo Finalizado Exitosamente!", "success");
      setStatus(AppStatus.COMPLETED);
      localStorage.removeItem('podio_active_backup'); // Clear session on success

    } catch (error: any) {
      if (error.message === "CANCELLED_BY_USER") {
          addLog("Proceso detenido por el usuario.", "error");
          setStatus(AppStatus.CANCELLED);
          localStorage.removeItem('podio_active_backup'); // Clear session on cancel
      } else {
          console.error(error);
          addLog(`Error fatal durante el proceso: ${error.message}`, "error");
          setStatus(AppStatus.ERROR);
      }
    }
  };

  // ZIP Fallback (código simplificado existente)
  const runZipBackup = async (podio: PodioService) => {
      setStatus(AppStatus.DISCOVERING_STRUCTURE);
      const zip = new JSZip();
      try {
        const orgs = await podio.getOrganizations();
        for (const org of orgs) {
            await checkControlFlow();
            const spaces = await podio.getSpaces(org.org_id);
            for (const space of spaces) {
                const apps = await podio.getApps(space.space_id);
                setStatus(AppStatus.WRITING_TO_DISK); 
                for (const app of apps) {
                    await checkControlFlow();
                    const folderPath = `${org.name}/${space.name}/${app.config.name}`;
                    const batchId = await podio.triggerAppExcelExport(app.app_id, isTestMode ? 50 : 20000);
                    if (batchId !== -1) {
                         const batchResult = await podio.waitForBatch(batchId);
                         if (batchResult?.file) {
                             const blob = await podio.downloadFileContent(batchResult.file.link);
                             if(blob) zip.file(`${folderPath}/${app.config.name}.xlsx`, blob);
                         }
                    }
                }
            }
        }
        const content = await zip.generateAsync({ type: "blob" });
        const saveAs = (FileSaver as any).saveAs || FileSaver;
        saveAs(content, "Podio_Backup_Fallback.zip");
        setStatus(AppStatus.COMPLETED);
      } catch (e: any) {
          if (e.message === "CANCELLED_BY_USER") {
             setStatus(AppStatus.CANCELLED);
          } else {
             addLog("Error ZIP: " + e.message, "error");
             setStatus(AppStatus.ERROR);
          }
      }
  };

  const handleReset = () => {
    if (window.confirm("¿Estás seguro de iniciar un NUEVO backup? Se perderá el progreso actual no guardado.")) {
        localStorage.removeItem('podio_active_backup');
        window.location.reload(); // Hard reset easiest way to clean state
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <header className="bg-white border-b border-gray-200 py-4 px-6 shadow-sm sticky top-0 z-10">
        <div className="max-w-6xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="bg-green-600 text-white w-9 h-9 rounded-lg flex items-center justify-center font-bold text-lg shadow-sm">
              <i className="fa-solid fa-hard-drive"></i>
            </div>
            <div>
               <h1 className="text-xl font-bold text-gray-800">Podio <span className="text-green-600">Disk Backup</span></h1>
               <p className="text-xs text-gray-400 font-mono">Direct Write Technology</p>
            </div>
          </div>
          <div className="text-xs text-gray-400">
             {status !== AppStatus.IDLE && (
                 <span className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${status === AppStatus.READY_TO_BACKUP ? 'bg-yellow-500' : 'bg-green-500'} animate-pulse`}></div> 
                    {status === AppStatus.RESTORE_SESSION ? 'Recuperación de Sesión' : status}
                 </span>
             )}
          </div>
        </div>
      </header>

      <main className="flex-1 p-6 flex flex-col items-center justify-center">
        {status === AppStatus.IDLE ? (
          <div className="w-full flex justify-center fade-in">
             <CredentialsForm onSubmit={handleConnect} isLoading={false} />
          </div>
        ) : (
          <ProcessDashboard 
            status={status}
            stats={stats}
            apiStats={apiStats}
            logs={logs}
            onDownload={handleSelectFolder} 
            onReset={handleReset}
            onPause={handlePause}
            onResume={handleResume}
            onCancel={handleCancel}
          />
        )}
      </main>

      <footer className="bg-white border-t border-gray-200 py-6 text-center text-gray-400 text-sm">
        <p>© {new Date().getFullYear()} Podio Backup Tool. <span className="text-blue-500"><i className="fa-solid fa-check-circle"></i> Escribe directamente en tu Disco Duro.</span></p>
      </footer>
    </div>
  );
};

export default App;