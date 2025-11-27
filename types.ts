// Definiciones de tipos para la aplicación

export interface PodioGlobalCredentials {
  clientId: string;
  clientSecret: string;
  username: string; // Email
  password: string;
  useProxy: boolean; // Para bypass CORS
}

export interface PodioOrg {
  org_id: number;
  name: string;
  url_label: string;
}

export interface PodioSpace {
  space_id: number;
  org_id: number;
  name: string;
  url_label: string;
}

export interface PodioApp {
  app_id: number;
  space_id: number;
  config: {
    name: string;
    item_name: string;
    icon: string;
  };
}

export interface PodioFile {
  file_id: number;
  name: string;
  mimetype: string;
  size: number;
  link: string; // Enlace de descarga
  hosted_by: string; // 'podio' | 'google', etc.
  created_on: string;
}

export interface PodioField {
  field_id: number;
  type: string;
  label: string;
  values: any[];
  config?: any;
}

export interface PodioItem {
  item_id: number;
  app_item_id: number;
  app?: {
    app_id: number;
    name: string;
  };
  title: string;
  created_on: string;
  fields: PodioField[];
  files: PodioFile[];
}

// Estructura para el manejo de Batch en Podio
export interface PodioBatch {
  batch_id: number;
  status: 'created' | 'processing' | 'completed' | 'failed';
  file: {
    file_id: number;
    link: string;
  };
}

export interface ProcessLog {
  timestamp: Date;
  message: string;
  type: 'info' | 'success' | 'error' | 'warning' | 'network'; // Added network type
}

export enum AppStatus {
  IDLE = 'IDLE',
  AUTHENTICATING = 'AUTHENTICATING',
  READY_TO_BACKUP = 'READY_TO_BACKUP', // Nuevo estado intermedio
  SELECTING_DIR = 'SELECTING_DIR',
  DISCOVERING_STRUCTURE = 'DISCOVERING_STRUCTURE',
  PROCESSING_BATCHES = 'PROCESSING_BATCHES',
  WRITING_TO_DISK = 'WRITING_TO_DISK',
  COMPLETED = 'COMPLETED',
  ERROR = 'ERROR'
}

export interface BackupStats {
  currentOrg?: string;
  currentSpace?: string;
  currentApp?: string;
  totalApps: number;
  processedApps: number;
  totalExcelsGenerated: number;
  totalFilesFound: number;
  totalFilesDownloaded: number;
}

// Nuevo: Estadísticas de API en tiempo real
export interface ApiStats {
  totalRequests: number;
  rateLimitLimit: number | null;     // X-Rate-Limit-Limit
  rateLimitRemaining: number | null; // X-Rate-Limit-Remaining
}

// Tipos para File System Access API
export interface FileSystemHandle {
  kind: 'file' | 'directory';
  name: string;
}

export interface FileSystemDirectoryHandle extends FileSystemHandle {
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FileSystemDirectoryHandle>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandle>;
}

export interface FileSystemFileHandle extends FileSystemHandle {
  createWritable(): Promise<FileSystemWritableFileStream>;
}

export interface FileSystemWritableFileStream extends WritableStream {
  write(data: BufferSource | Blob | string): Promise<void>;
  close(): Promise<void>;
}