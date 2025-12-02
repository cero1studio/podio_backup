import { PodioGlobalCredentials, PodioOrg, PodioSpace, PodioApp, PodioBatch, PodioFile, ApiStats } from '../types';

// USAMOS RUTAS RELATIVAS PARA QUE EL PROXY DE VITE (vite.config.ts) INTERCEPTE LAS LLAMADAS
const API_PREFIX = '/podio-api';
const FILES_PREFIX = '/podio-files';

type ApiStatsCallback = (stats: ApiStats) => void;
type LogCallback = (msg: string) => void;

export class PodioService {
  private accessToken: string | null = null;
  private credentials: PodioGlobalCredentials;
  
  // Estado interno de API
  private requestCount = 0;
  
  // Caché de Rate Limit para evitar parpadeos (--/--)
  private lastRateLimitLimit: number | null = null;
  private lastRateLimitRemaining: number | null = null;

  private onStatsUpdate: ApiStatsCallback | null = null;
  private onNetworkLog: LogCallback | null = null;

  constructor(
    credentials: PodioGlobalCredentials, 
    onStatsUpdate?: ApiStatsCallback,
    onNetworkLog?: LogCallback
  ) {
    this.credentials = credentials;
    this.onStatsUpdate = onStatsUpdate || null;
    this.onNetworkLog = onNetworkLog || null;
  }

  // --- MÉTODOS PARA PERSISTENCIA ---
  public getSession(): string | null {
    return this.accessToken;
  }

  public setSession(token: string) {
    this.accessToken = token;
  }
  // --------------------------------

  /**
   * Convierte una URL absoluta de Podio en una URL relativa que pase por nuestro Proxy local.
   */
  private proxifyUrl(url: string): string {
    if (url.includes('api.podio.com')) {
      return url.replace('https://api.podio.com', API_PREFIX);
    }
    if (url.includes('files.podio.com')) {
      return url.replace('https://files.podio.com', FILES_PREFIX);
    }
    // Si ya es relativa o desconocida, la dejamos (o intentamos pasarla por api)
    if (url.startsWith('http')) return url; 
    return `${API_PREFIX}${url.startsWith('/') ? '' : '/'}${url}`;
  }

  private async request(endpoint: string, options: RequestInit = {}, isFullUrl = false): Promise<Response> {
    // Calcular URL final usando el Proxy Local
    let targetUrl = isFullUrl ? this.proxifyUrl(endpoint) : `${API_PREFIX}${endpoint}`;

    const headers: any = {
      'Accept': 'application/json',
      ...options.headers
    };

    if (this.accessToken) {
      headers['Authorization'] = `OAuth2 ${this.accessToken}`;
    }

    if (!headers['Content-Type'] && options.method !== 'GET') {
      headers['Content-Type'] = 'application/json';
    }

    // Logging para debug visual
    this.requestCount++;
    if (this.onNetworkLog) {
      const method = options.method || 'GET';
      const logUrl = targetUrl.length > 60 ? '...' + targetUrl.slice(-60) : targetUrl;
      this.onNetworkLog(`[PROXY] ${method} ${logUrl}`);
    }

    // Bucle infinito para manejo robusto de Rate Limit (429)
    while (true) {
        try {
            const response = await fetch(targetUrl, { ...options, headers });
            
            // MANEJO DE RATE LIMIT (429)
            if (response.status === 429) {
                const waitMinutes = 10;
                // Añadir Jitter (aleatoriedad) de 0 a 5 segundos para que los 3 hilos no despierten al mismo tiempo
                const jitter = Math.floor(Math.random() * 5000); 
                const waitMs = (waitMinutes * 60 * 1000) + jitter;
                
                if (this.onNetworkLog) {
                    this.onNetworkLog(`⚠ Rate Limit Crítico (429). Pausando hilo por ${waitMinutes}m...`);
                }
                
                // Esperar 10 minutos + jitter
                await new Promise(resolve => setTimeout(resolve, waitMs));
                
                if (this.onNetworkLog) {
                    this.onNetworkLog(`♻ Reanudando petición tras pausa de ${waitMinutes}m...`);
                }
                
                // Volver al inicio del while para reintentar
                continue;
            }

            // ACTUALIZACIÓN INTELIGENTE DE RATE LIMITS
            // Solo actualizamos si los headers existen, si no, mantenemos el último valor conocido.
            const limitHeader = response.headers.get('X-Rate-Limit-Limit');
            const remainingHeader = response.headers.get('X-Rate-Limit-Remaining');

            if (limitHeader) this.lastRateLimitLimit = parseInt(limitHeader);
            if (remainingHeader) this.lastRateLimitRemaining = parseInt(remainingHeader);

            if (this.onStatsUpdate) {
                this.onStatsUpdate({
                    totalRequests: this.requestCount,
                    // Enviamos siempre el último valor conocido para evitar parpadeos a null
                    rateLimitLimit: this.lastRateLimitLimit,
                    rateLimitRemaining: this.lastRateLimitRemaining
                });
            }

            if (response.status === 401) {
                throw new Error("Token expirado o credenciales inválidas (401).");
            }
            
            return response;
        } catch (error) {
            // Errores de red (fetch fail) no relacionados con 429 se lanzan
            throw error;
        }
    }
  }

  async authenticate(): Promise<boolean> {
    const params = new URLSearchParams();
    params.append('grant_type', 'password');
    params.append('client_id', this.credentials.clientId);
    params.append('client_secret', this.credentials.clientSecret);
    params.append('username', this.credentials.username);
    params.append('password', this.credentials.password);

    try {
      // POST a /podio-api/oauth/token
      const response = await fetch(`${API_PREFIX}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error_description: response.statusText }));
        throw new Error(`Auth Falló: ${err.error_description || response.statusText}`);
      }

      const data = await response.json();
      this.accessToken = data.access_token;
      return true;
    } catch (error) {
      console.error("Auth Error:", error);
      throw error;
    }
  }

  async getOrganizations(): Promise<PodioOrg[]> {
    const response = await this.request('/org/');
    if (!response.ok) throw new Error(`Error al obtener organizaciones: ${response.status}`);
    return await response.json();
  }

  async getSpaces(orgId: number): Promise<PodioSpace[]> {
    const response = await this.request(`/org/${orgId}/space/`);
    if (!response.ok) throw new Error(`Error al obtener espacios: ${response.status}`);
    return await response.json();
  }

  async getApps(spaceId: number): Promise<PodioApp[]> {
    // Agregamos include_inactive=false para intentar asegurar mejor data
    const response = await this.request(`/app/space/${spaceId}/?include_inactive=false`);
    if (!response.ok) throw new Error(`Error al obtener apps: ${response.status}`);
    return await response.json();
  }

  // Ahora acepta limitCount
  async triggerAppExcelExport(appId: number, limitCount: number = 20000): Promise<number> {
    try {
      // Endpoint oficial para batch export de items
      const response = await this.request(`/item/app/${appId}/export/xlsx`, {
        method: 'POST',
        body: JSON.stringify({ 
            limit: limitCount,
            sort_desc: true 
        })
      });
      
      if (!response.ok) {
        console.warn(`Excel Export Start Failed: ${response.status}`);
        return -1;
      }
      
      const data: any = await response.json();
      return data.batch_id;
    } catch (e) {
      console.error(`Excepción en triggerAppExcelExport:`, e);
      return -1;
    }
  }

  async waitForBatch(batchId: number): Promise<PodioBatch | null> {
    let attempts = 0;
    const maxAttempts = 120; // Aumentado a 4 minutos por seguridad en grandes cargas
    
    while (attempts < maxAttempts) {
      const response = await this.request(`/batch/${batchId}`);
      if (!response.ok) return null;
      
      const batch: PodioBatch = await response.json();
      
      if (this.onNetworkLog && attempts % 5 === 0) {
           this.onNetworkLog(`Batch ${batchId}: Estado '${batch.status}' (Intento ${attempts})`);
      }

      if (batch.status === 'completed') {
        return batch;
      } else if (batch.status === 'failed') {
        throw new Error("La generación del Excel falló en los servidores de Podio.");
      }

      await new Promise(resolve => setTimeout(resolve, 2000));
      attempts++;
    }
    return null; 
  }

  // Ahora acepta limit
  async getAppFiles(appId: number, limit: number = 100): Promise<PodioFile[]> {
    let allFiles: PodioFile[] = [];
    let offset = 0;
    // Si el límite pedido es pequeño (ej test mode), usamos ese. Si es grande, paginamos de 100 en 100.
    const pageSize = limit < 100 ? limit : 100;
    let hasMore = true;

    try {
      while (hasMore) {
        // Respetamos el límite total solicitado
        if (allFiles.length >= limit) break;

        const response = await this.request(`/file/app/${appId}/?limit=${pageSize}&offset=${offset}&sort_by=created_on`);

        if (!response.ok) break;

        const files: PodioFile[] = await response.json();
        allFiles = [...allFiles, ...files];

        if (files.length < pageSize || allFiles.length >= limit) {
          hasMore = false;
        } else {
          offset += pageSize;
        }
      }
    } catch (e) {
      console.error("Error obteniendo lista de archivos:", e);
    }
    // Cortamos exacto por si nos pasamos en la última página
    return allFiles.slice(0, limit);
  }

  async downloadFileContent(link: string): Promise<Blob | null> {
    try {
      const response = await this.request(link, {}, true);
      if (!response.ok) {
        console.warn(`Download Failed (${response.status}): ${link}`);
        // Intentar leer el error si es JSON
        try {
            const err = await response.json();
            console.warn("Detalle error:", err);
        } catch {}
        return null;
      }
      return await response.blob();
    } catch (e) {
      console.warn(`Download Exception:`, e);
      return null;
    }
  }
}