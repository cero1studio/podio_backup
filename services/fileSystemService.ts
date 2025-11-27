import { FileSystemDirectoryHandle, FileSystemHandle } from '../types';

export class FileSystemService {
  
  /**
   * Solicita al usuario seleccionar una carpeta del disco con permisos de escritura.
   */
  async selectDirectory(): Promise<FileSystemDirectoryHandle> {
    if ('showDirectoryPicker' in window) {
      // @ts-ignore - Solicitamos explícitamente modo lectura/escritura
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
      
      // Verificación adicional de seguridad
      const hasPermission = await this.verifyPermission(handle, true);
      if (!hasPermission) {
          throw new Error("Permiso de escritura denegado por el usuario.");
      }
      
      return handle;
    } else {
      throw new Error("Tu navegador no soporta escritura directa en disco. Usa Chrome, Edge u Opera.");
    }
  }

  /**
   * Verifica si tenemos permisos, y si no, intenta pedirlos (requiere clic del usuario).
   */
  async verifyPermission(fileHandle: any, withWrite: boolean): Promise<boolean> {
    const opts = { mode: withWrite ? 'readwrite' : 'read' };
    
    // 1. Chequear si ya lo tenemos
    if ((await fileHandle.queryPermission(opts)) === 'granted') {
      return true;
    }
    
    // 2. Si no, pedirlo (esto solo funciona si hay interacción de usuario reciente)
    if ((await fileHandle.requestPermission(opts)) === 'granted') {
      return true;
    }
    
    return false;
  }

  /**
   * Obtiene o crea un subdirectorio.
   */
  async getDirectory(parent: FileSystemDirectoryHandle, name: string): Promise<FileSystemDirectoryHandle> {
    const sanitized = this.sanitizeName(name);
    return await parent.getDirectoryHandle(sanitized, { create: true });
  }

  /**
   * Escribe un archivo en el directorio especificado.
   */
  async writeFile(directory: FileSystemDirectoryHandle, filename: string, content: Blob | string) {
    const sanitized = this.sanitizeName(filename);
    try {
        const fileHandle = await directory.getFileHandle(sanitized, { create: true });
        // @ts-ignore
        const writable = await fileHandle.createWritable();
        await writable.write(content);
        await writable.close();
    } catch (error) {
        console.error(`Error escribiendo archivo ${filename}:`, error);
        // Intentamos con un nombre alternativo si falla (ej: nombres muy largos o caracteres prohibidos por OS)
        try {
            const fallbackName = `file_${Date.now()}_${Math.floor(Math.random() * 1000)}.dat`;
            const fileHandle = await directory.getFileHandle(fallbackName, { create: true });
            // @ts-ignore
            const writable = await fileHandle.createWritable();
            await writable.write(content);
            await writable.close();
        } catch (e) {
            console.error("Fallo irrecuperable de escritura:", e);
        }
    }
  }

  private sanitizeName(name: string): string {
    // Reemplaza caracteres prohibidos en Windows/Unix
    // Mantiene letras, números, espacios y guiones comunes
    let sanitized = name.replace(/[<>:"/\\|?*]/g, '_');
    sanitized = sanitized.replace(/\s+/g, ' ').trim();
    if (sanitized.length > 200) sanitized = sanitized.substring(0, 190); // Limite NTFS conservador
    if (sanitized === '.' || sanitized === '..') sanitized = '_safe_name_';
    return sanitized || "Untitled";
  }
}