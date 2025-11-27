import React, { useState, useCallback, useRef } from 'react';
import { PodioGlobalCredentials, AppStatus, ProcessLog, BackupStats, FileSystemDirectoryHandle, ApiStats, BackupPlan } from './types';
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

  // --- CONTROL HANDLERS ---
  const handlePause = () => {
    controlRef.current.isPaused = true;
    setStatus(AppStatus.PAUSED);
    addLog("=== PROCESO PAUSADO POR USUARIO ===", 'warning');
  };

  const handleResume = () => {
    controlRef.current.isPaused = false;
    setStatus(AppStatus.WRITING_TO_DISK); // Or previous status
    addLog("=== REANUDANDO PROCESO ===", 'success');
  };

  const handleCancel = () => {
    if (window.confirm("¿Seguro que deseas cancelar el backup? El progreso actual se mantendrá en disco.")) {
        controlRef.current.isCancelled = true;
        controlRef.current.isPaused = false; // Unpause to let loop exit
        setStatus(AppStatus.CANCELLED);
        addLog("!!! CANCELANDO... ESPERANDO A QUE TERMINE LA TAREA ACTUAL !!!", 'error');
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
        setStatus(AppStatus.READY_TO_BACKUP);
      } else {
        addLog(`Selección de carpeta cancelada: ${err.message}`, "warning");
        setStatus(AppStatus.READY_TO_BACKUP);
      }
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
      // En modo test no limitamos apps, escaneamos hasta encontrar 10 archivos
      const MAX_APPS = 9999; 
      
      const EXCEL_LIMIT = isTestMode ? 50 : 20000;
      const FILES_LIMIT_PER_APP = isTestMode ? 10 : 5000; 
      const GLOBAL_FILES_STOP_LIMIT = isTestMode ? 10 : 99999999;

      // --- FASE 1: DESCUBRIMIENTO ---
      addLog("=== FASE 1: ESCANEO DE ESTRUCTURA ===", "info");
      await checkControlFlow();

      const orgs = await podio.getOrganizations();
      const backupPlan: BackupPlan[] = [];
      let totalAppsCount = 0;
      let totalSpacesCount = 0;
      let totalItemsCount = 0;

      setStats(prev => ({ ...prev, totalOrgs: orgs.length }));
      addLog(`Se encontraron ${orgs.length} organizaciones.`, "info");

      for (const org of orgs) {
          await checkControlFlow(); // Checkpoint
          
          const allSpaces = await podio.getSpaces(org.org_id);
          const spacesToProcess = allSpaces.slice(0, MAX_SPACES);
          
          const spacePlans = [];
          
          totalSpacesCount += spacesToProcess.length;
          setStats(prev => ({ ...prev, totalSpaces: totalSpacesCount }));

          for (const space of spacesToProcess) {
              await checkControlFlow(); // Checkpoint
              
              const allApps = await podio.getApps(space.space_id);
              // Si es test mode, tomamos todas las apps de ese espacio, 
              // pero pararemos en la Fase 2 cuando lleguemos a los 10 archivos.
              const appsToProcess = allApps.slice(0, MAX_APPS);

              totalAppsCount += appsToProcess.length;
              
              // Sumamos los items reportados por Podio (sin hacer llamadas extra)
              appsToProcess.forEach(app => {
                  totalItemsCount += (app.item_count || 0);
              });

              setStats(prev => ({ 
                  ...prev, 
                  totalApps: totalAppsCount,
                  totalItems: totalItemsCount
              }));
              
              spacePlans.push({ space, apps: appsToProcess });
          }
          
          backupPlan.push({ org, spaces: spacePlans });
      }

      addLog(`ESCANEADO COMPLETO: ${totalItemsCount} Registros (Items) en ${totalAppsCount} Apps.`, "success");
      
      // --- FASE 2: EJECUCIÓN ---
      setStatus(AppStatus.WRITING_TO_DISK);
      addLog("=== FASE 2: INICIANDO DESCARGA ===", "info");

      // Usamos una variable local para tracking rápido dentro de loops
      let downloadedFilesGlobal = 0;

      for (const orgPlan of backupPlan) {
        // BREAK DE MODO TEST
        if (isTestMode && downloadedFilesGlobal >= GLOBAL_FILES_STOP_LIMIT) break;

        await checkControlFlow(); // Checkpoint

        const { org, spaces } = orgPlan;
        setStats(prev => ({ ...prev, currentOrg: org.name }));
        
        let orgDir: FileSystemDirectoryHandle;
        try {
             orgDir = await fs.getDirectory(rootDir, org.name);
        } catch (e: any) {
             throw new Error(`No se pudo crear carpeta para Organización ${org.name}. Verifica permisos. Error: ${e.message}`);
        }
        
        for (const spacePlan of spaces) {
          // BREAK DE MODO TEST
          if (isTestMode && downloadedFilesGlobal >= GLOBAL_FILES_STOP_LIMIT) break;

          await checkControlFlow(); // Checkpoint

          const { space, apps } = spacePlan;
          setStats(prev => ({ ...prev, currentSpace: space.name }));
          
          const spaceDir = await fs.getDirectory(orgDir, space.name);

          for (const app of apps) {
            // BREAK DE MODO TEST
            if (isTestMode && downloadedFilesGlobal >= GLOBAL_FILES_STOP_LIMIT) {
                 addLog(`Límite de Modo Test alcanzado (${GLOBAL_FILES_STOP_LIMIT} archivos). Deteniendo...`, "warning");
                 break;
            }

            await checkControlFlow(); // Checkpoint

            setStats(prev => ({ ...prev, currentApp: app.config.name }));
            const appDir = await fs.getDirectory(spaceDir, app.config.name);
            
            // --- EXCEL ---
            addLog(`Solicitando Excel para '${app.config.name}'...`, "network");
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

            // --- FILES ---
            await checkControlFlow(); // Checkpoint
            
            // Si es test mode, pedimos pocos para no saturar.
            // Si es full, pedimos por lotes grandes.
            const files = await podio.getAppFiles(app.app_id, FILES_LIMIT_PER_APP);
            
            setStats(prev => ({ ...prev, totalFilesFound: prev.totalFilesFound + files.length }));
            
            if (files.length > 0) {
              const filesDir = await fs.getDirectory(appDir, "Files");
              
              for (const file of files) {
                  // BREAK DE MODO TEST (Nivel Archivo)
                  if (isTestMode && downloadedFilesGlobal >= GLOBAL_FILES_STOP_LIMIT) break;

                  await checkControlFlow(); // Checkpoint per file

                  try {
                      const fileBlob = await podio.downloadFileContent(file.link);
                      if (fileBlob) {
                        await fs.writeFile(filesDir, file.name, fileBlob);
                        
                        downloadedFilesGlobal++; // Increment local counter
                        setStats(prev => ({ ...prev, totalFilesDownloaded: prev.totalFilesDownloaded + 1 }));
                      }
                  } catch (e: any) {
                      addLog(`Falló escritura ${file.name}: ${e.message}`, "error");
                  }
              }
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

    } catch (error: any) {
      if (error.message === "CANCELLED_BY_USER") {
          addLog("Proceso detenido por el usuario.", "error");
          setStatus(AppStatus.CANCELLED);
      } else {
          console.error(error);
          addLog(`Error fatal durante el proceso: ${error.message}`, "error");
          setStatus(AppStatus.ERROR);
      }
    }
  };

  const runZipBackup = async (podio: PodioService) => {
      // Fallback ZIP en memoria (sin FileSystemAccess)
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
                    
                    // Solo descargamos Excel en modo ZIP para no explotar la memoria
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
    setStatus(AppStatus.IDLE);
    setLogs([]);
    controlRef.current = { isPaused: false, isCancelled: false };
    setStats({ 
        totalOrgs: 0, processedOrgs: 0,
        totalSpaces: 0, processedSpaces: 0,
        totalApps: 0, processedApps: 0, 
        totalItems: 0,
        totalExcelsGenerated: 0, totalFilesFound: 0, totalFilesDownloaded: 0 
    });
    setApiStats({ totalRequests: 0, rateLimitLimit: null, rateLimitRemaining: null });
    podioServiceRef.current = null;
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
                    {status === AppStatus.READY_TO_BACKUP ? 'Esperando Acción' : 'Active Session'}
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