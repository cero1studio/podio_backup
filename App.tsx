import React, { useState, useCallback, useRef } from 'react';
import { PodioGlobalCredentials, AppStatus, ProcessLog, BackupStats, FileSystemDirectoryHandle, ApiStats } from './types';
import { CredentialsForm } from './components/CredentialsForm';
import { ProcessDashboard } from './components/ProcessDashboard';
import { PodioService } from './services/podioService';
import { FileSystemService } from './services/fileSystemService';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import FileSaver from 'file-saver';

const App: React.FC = () => {
  const [status, setStatus] = useState<AppStatus>(AppStatus.IDLE);
  const [logs, setLogs] = useState<ProcessLog[]>([]);
  const [stats, setStats] = useState<BackupStats>({
    totalApps: 0,
    processedApps: 0,
    totalExcelsGenerated: 0,
    totalFilesFound: 0,
    totalFilesDownloaded: 0
  });
  const [apiStats, setApiStats] = useState<ApiStats>({
    totalRequests: 0,
    rateLimitLimit: null,
    rateLimitRemaining: null
  });
  
  // Mantener la instancia del servicio activa entre renders
  const podioServiceRef = useRef<PodioService | null>(null);

  const addLog = useCallback((message: string, type: ProcessLog['type'] = 'info') => {
    setLogs(prev => {
        const newLogs = [...prev, { timestamp: new Date(), message, type }];
        if (newLogs.length > 500) return newLogs.slice(newLogs.length - 500);
        return newLogs;
    });
  }, []);

  const handleConnect = async (creds: PodioGlobalCredentials) => {
    setStatus(AppStatus.AUTHENTICATING);
    setLogs([]);
    setStats({ totalApps: 0, processedApps: 0, totalExcelsGenerated: 0, totalFilesFound: 0, totalFilesDownloaded: 0 });
    setApiStats({ totalRequests: 0, rateLimitLimit: null, rateLimitRemaining: null });
    
    addLog(`Iniciando conexión con usuario: ${creds.username}...`, "info");
    if(creds.useProxy) addLog("Modo Proxy activado para evitar bloqueos CORS.", "info");
    
    // Instanciar y guardar en ref
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
      
      // CAMBIO IMPORTANTE: No llamamos a selectDirectory aquí.
      // Cambiamos el estado para mostrar el botón de selección manual.
      setStatus(AppStatus.READY_TO_BACKUP);

    } catch (error: any) {
      addLog(`Error de Conexión: ${error.message}`, "error");
      if (error.message.includes("Failed to fetch") && !creds.useProxy) {
         addLog("TIP: Activa la casilla 'Usar Proxy (CORS)' e intenta de nuevo.", "warning");
      }
      // Volver a IDLE tras error para permitir reintento
      setTimeout(() => setStatus(AppStatus.IDLE), 3000);
    }
  };

  const handleSelectFolder = async () => {
    if (!podioServiceRef.current) return;
    
    setStatus(AppStatus.SELECTING_DIR);
    const fsService = new FileSystemService();
    
    try {
      // Intentar acceso directo al disco
      const rootDirHandle = await fsService.selectDirectory();
      addLog("Carpeta seleccionada correctamente. Iniciando escaneo...", "success");
      await runDiskBackup(podioServiceRef.current, fsService, rootDirHandle);
    } catch (err: any) {
      // Si falla por CORS/Iframe (Cross origin sub frames...), fallback a ZIP
      if (err.message && (err.message.includes('Cross origin') || err.message.includes('security'))) {
        addLog("! Detectado bloqueo de seguridad del navegador (Iframe).", "warning");
        addLog(">>> Cambiando a MODO COMPATIBILIDAD (ZIP en Memoria)...", "info");
        await runZipBackup(podioServiceRef.current);
      } else {
        addLog(`Selección de carpeta cancelada: ${err.message}`, "warning");
        setStatus(AppStatus.READY_TO_BACKUP); // Volver al paso anterior
      }
    }
  };

  // --- MODO DISCO DURO (PREFERIDO) ---
  const runDiskBackup = async (
    podio: PodioService, 
    fs: FileSystemService, 
    rootDir: FileSystemDirectoryHandle
  ) => {
    setStatus(AppStatus.DISCOVERING_STRUCTURE);
    
    try {
      addLog("Buscando organizaciones...", "info");
      const orgs = await podio.getOrganizations();
      addLog(`Se encontraron ${orgs.length} organizaciones.`, "success");

      for (const org of orgs) {
        setStats(prev => ({ ...prev, currentOrg: org.name }));
        const orgDir = await fs.getDirectory(rootDir, org.name);

        const spaces = await podio.getSpaces(org.org_id);
        addLog(`[${org.name}] ${spaces.length} espacios de trabajo detectados.`, "info");

        for (const space of spaces) {
          setStats(prev => ({ ...prev, currentSpace: space.name }));
          const spaceDir = await fs.getDirectory(orgDir, space.name);

          const apps = await podio.getApps(space.space_id);
          setStats(prev => ({ ...prev, totalApps: prev.totalApps + apps.length }));
          
          setStatus(AppStatus.WRITING_TO_DISK);

          for (const app of apps) {
            setStats(prev => ({ ...prev, currentApp: app.config.name }));
            const appDir = await fs.getDirectory(spaceDir, app.config.name);
            
            // --- EXCEL ---
            addLog(`Solicitando Excel para '${app.config.name}'...`, "network");
            const batchId = await podio.triggerAppExcelExport(app.app_id);
            
            if (batchId !== -1) {
              const batchResult = await podio.waitForBatch(batchId);
              if (batchResult && batchResult.file) {
                 const excelBlob = await podio.downloadFileContent(batchResult.file.link);
                 await fs.writeFile(appDir, `${app.config.name}.xlsx`, excelBlob);
                 setStats(prev => ({ ...prev, totalExcelsGenerated: prev.totalExcelsGenerated + 1 }));
                 addLog(`Excel guardado: ${app.config.name}.xlsx`, "success");
              } else {
                 addLog(`⚠ Error en Excel para '${app.config.name}'`, "warning");
              }
            } else {
              addLog(`⚠ App vacía o error al exportar '${app.config.name}'`, "warning");
            }

            // --- FILES ---
            const files = await podio.getAppFiles(app.app_id);
            setStats(prev => ({ ...prev, totalFilesFound: prev.totalFilesFound + files.length }));
            
            if (files.length > 0) {
              addLog(`Encontrados ${files.length} adjuntos en '${app.config.name}'.`, "info");
              const filesDir = await fs.getDirectory(appDir, "Files");
              
              for (const file of files) {
                  try {
                      const fileBlob = await podio.downloadFileContent(file.link);
                      await fs.writeFile(filesDir, file.name, fileBlob);
                      setStats(prev => ({ ...prev, totalFilesDownloaded: prev.totalFilesDownloaded + 1 }));
                  } catch (e: any) {
                      addLog(`Falló descarga ${file.name}: ${e.message}`, "error");
                  }
              }

              const metadata = JSON.stringify(files, null, 2);
              await fs.writeFile(appDir, "_files_metadata.json", metadata);
            }

            setStats(prev => ({ ...prev, processedApps: prev.processedApps + 1 }));
          }
        }
      }
      
      addLog("¡Backup Completo Finalizado Exitosamente!", "success");
      setStatus(AppStatus.COMPLETED);

    } catch (error: any) {
      console.error(error);
      addLog(`Error fatal durante el proceso: ${error.message}`, "error");
      setStatus(AppStatus.ERROR);
    }
  };

  // --- MODO FALLBACK (ZIP EN MEMORIA) ---
  const runZipBackup = async (podio: PodioService) => {
    setStatus(AppStatus.DISCOVERING_STRUCTURE);
    const zip = new JSZip();

    try {
       addLog("Buscando organizaciones...", "info");
       const orgs = await podio.getOrganizations();
       
       for (const org of orgs) {
         setStats(prev => ({ ...prev, currentOrg: org.name }));
         const spaces = await podio.getSpaces(org.org_id);
         
         for (const space of spaces) {
            setStats(prev => ({ ...prev, currentSpace: space.name }));
            const apps = await podio.getApps(space.space_id);
            setStats(prev => ({ ...prev, totalApps: prev.totalApps + apps.length }));
            
            setStatus(AppStatus.WRITING_TO_DISK); // Reusamos estado para indicar progreso

            for (const app of apps) {
               setStats(prev => ({ ...prev, currentApp: app.config.name }));
               const folderPath = `${org.name}/${space.name}/${app.config.name}`;
               
               // Excel
               const batchId = await podio.triggerAppExcelExport(app.app_id);
               if (batchId !== -1) {
                 const batchResult = await podio.waitForBatch(batchId);
                 if (batchResult && batchResult.file) {
                    const excelBlob = await podio.downloadFileContent(batchResult.file.link);
                    zip.file(`${folderPath}/${app.config.name}.xlsx`, excelBlob);
                    setStats(prev => ({ ...prev, totalExcelsGenerated: prev.totalExcelsGenerated + 1 }));
                 }
               }

               // Files List (No binary download to avoid crash)
               const files = await podio.getAppFiles(app.app_id);
               setStats(prev => ({ ...prev, totalFilesFound: prev.totalFilesFound + files.length }));
               
               if (files.length > 0) {
                 let htmlContent = `<html><h1>Archivos Adjuntos: ${app.config.name}</h1><ul>`;
                 files.forEach(f => {
                    htmlContent += `<li><a href="${f.link}">${f.name}</a> (${(f.size/1024).toFixed(2)} KB)</li>`;
                 });
                 htmlContent += "</ul></html>";
                 zip.file(`${folderPath}/Descargar_Adjuntos.html`, htmlContent);
                 addLog(`Generado índice de ${files.length} archivos para '${app.config.name}'`, "info");
               }

               setStats(prev => ({ ...prev, processedApps: prev.processedApps + 1 }));
            }
         }
       }

       addLog("Comprimiendo archivo ZIP final...", "info");
       const content = await zip.generateAsync({ type: "blob" });
       
       // Handle file-saver import differences
       const saveAs = (FileSaver as any).saveAs || FileSaver;
       saveAs(content, "Podio_Backup_Compatibility.zip");
       
       addLog("Backup descargado como ZIP.", "success");
       setStatus(AppStatus.COMPLETED);

    } catch (error: any) {
       addLog(`Error en modo compatibilidad: ${error.message}`, "error");
       setStatus(AppStatus.ERROR);
    }
  };

  const handleReset = () => {
    setStatus(AppStatus.IDLE);
    setLogs([]);
    setStats({ totalApps: 0, processedApps: 0, totalExcelsGenerated: 0, totalFilesFound: 0, totalFilesDownloaded: 0 });
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