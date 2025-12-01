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
        console.error(`Error escribiendo archivo ${filename} -> ${sanitized}:`, error);
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
    if (!name) return "Untitled";

    // 1. Reemplazo agresivo de caracteres prohibidos en Windows/Unix
    // Windows prohibidos: < > : " / \ | ? *
    // También eliminamos caracteres de control (0-31)
    let sanitized = name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
    
    // 2. Recortar espacios y puntos al inicio/final (Windows no le gustan los puntos al final)
    sanitized = sanitized.trim().replace(/\.+$/, '');

    // 3. Verificar nombres reservados de Windows (CON, PRN, AUX, NUL, COM1-9, LPT1-9)
    const reserved = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;
    if (reserved.test(sanitized)) {
        sanitized = '_' + sanitized + '_';
    }

    // 4. Limitar longitud (NTFS soporta 255, pero safe 150 para la ruta completa)
    if (sanitized.length > 120) {
        // Mantenemos la extensión si existe
        const parts = sanitized.split('.');
        if (parts.length > 1) {
            const ext = parts.pop();
            const base = parts.join('.').substring(0, 110);
            sanitized = `${base}.${ext}`;
        } else {
            sanitized = sanitized.substring(0, 120);
        }
    }

    // 5. Fallback si quedó vacío
    if (sanitized.length === 0) sanitized = "Untitled_File";

    return sanitized;
  }
}