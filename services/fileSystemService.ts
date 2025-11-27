import { FileSystemDirectoryHandle } from '../types';

export class FileSystemService {
  
  /**
   * Solicita al usuario seleccionar una carpeta del disco.
   */
  async selectDirectory(): Promise<FileSystemDirectoryHandle> {
    if ('showDirectoryPicker' in window) {
      // @ts-ignore - Typescript a veces no reconoce esta API experimental
      return await window.showDirectoryPicker();
    } else {
      throw new Error("Tu navegador no soporta escritura directa en disco. Usa Chrome, Edge u Opera.");
    }
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
        const writable = await fileHandle.createWritable();
        await writable.write(content);
        await writable.close();
    } catch (error) {
        console.error(`Error escribiendo archivo ${filename}:`, error);
        // Intentamos con un nombre alternativo si falla (ej: nombres muy largos o caracteres prohibidos por OS)
        try {
            const fallbackName = `file_${Date.now()}_${Math.floor(Math.random() * 1000)}.dat`;
            const fileHandle = await directory.getFileHandle(fallbackName, { create: true });
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
    if (sanitized.length > 255) sanitized = sanitized.substring(0, 251) + "..." ; // Limite NTFS
    if (sanitized === '.' || sanitized === '..') sanitized = '_safe_name_';
    return sanitized || "Untitled";
  }
}