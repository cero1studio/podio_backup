import { PodioGlobalCredentials, PodioOrg, PodioSpace, PodioApp, PodioBatch, PodioFile, ApiStats } from '../types';

const BASE_URL = 'https://api.podio.com';
const PROXY_URL = 'https://corsproxy.io/?';

type ApiStatsCallback = (stats: ApiStats) => void;
type LogCallback = (msg: string) => void;

export class PodioService {
  private accessToken: string | null = null;
  private credentials: PodioGlobalCredentials;
  
  // Estado interno de API
  private requestCount = 0;
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

  /**
   * Wrapper centralizado para todas las peticiones a Podio.
   * Maneja Auth Headers, Conteo de Peticiones, Rate Limits y PROXY.
   */
  private async request(endpoint: string, options: RequestInit = {}, isFullUrl = false): Promise<Response> {
    let targetUrl = isFullUrl ? endpoint : `${BASE_URL}${endpoint}`;
    
    // Si usamos proxy, envolvemos la URL
    if (this.credentials.useProxy) {
      targetUrl = `${PROXY_URL}${encodeURIComponent(targetUrl)}`;
    }

    // Headers por defecto
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

    // Logging
    this.requestCount++;
    if (this.onNetworkLog) {
      const method = options.method || 'GET';
      const shortUrl = isFullUrl ? endpoint : endpoint; 
      this.onNetworkLog(`[API] ${method} ${shortUrl}`);
    }

    try {
      const response = await fetch(targetUrl, { ...options, headers });

      // Leer Rate Limits (A veces el proxy se come los headers, pero intentamos leerlos)
      const limit = response.headers.get('X-Rate-Limit-Limit');
      const remaining = response.headers.get('X-Rate-Limit-Remaining');

      if (this.onStatsUpdate) {
        this.onStatsUpdate({
          totalRequests: this.requestCount,
          rateLimitLimit: limit ? parseInt(limit) : null,
          rateLimitRemaining: remaining ? parseInt(remaining) : null
        });
      }

      if (response.status === 401) {
        throw new Error("Token expirado o inválido (401).");
      }
      
      if (response.status === 429) {
         throw new Error("Rate Limit Excedido (429). Esperando a Podio...");
      }

      return response;
    } catch (error) {
      throw error;
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
      // Endpoint de autenticación
      let authUrl = `${BASE_URL}/oauth/token`;
      
      // Aplicar Proxy si es necesario
      if (this.credentials.useProxy) {
        authUrl = `${PROXY_URL}${encodeURIComponent(authUrl)}`;
      }

      this.requestCount++;
      const response = await fetch(authUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error_description: response.statusText }));
        throw new Error(`Authentication failed: ${err.error_description || response.statusText}`);
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
    if (!response.ok) throw new Error("Failed to fetch organizations");
    return await response.json();
  }

  async getSpaces(orgId: number): Promise<PodioSpace[]> {
    const response = await this.request(`/org/${orgId}/space/`);
    if (!response.ok) throw new Error("Failed to fetch spaces");
    return await response.json();
  }

  async getApps(spaceId: number): Promise<PodioApp[]> {
    const response = await this.request(`/app/space/${spaceId}/`);
    if (!response.ok) throw new Error("Failed to fetch apps");
    return await response.json();
  }

  // --- MÉTODOS BATCH OPTIMIZADOS ---

  async triggerAppExcelExport(appId: number): Promise<number> {
    const response = await this.request(`/app/${appId}/xlsx/`, {
      method: 'POST',
      body: JSON.stringify({ limit: 20000 })
    });
    
    if (!response.ok) {
      console.warn(`No se pudo iniciar exportación para app ${appId}`);
      return -1;
    }
    
    const data: PodioBatch = await response.json();
    return data.batch_id;
  }

  async waitForBatch(batchId: number): Promise<PodioBatch | null> {
    let attempts = 0;
    const maxAttempts = 30; 
    
    while (attempts < maxAttempts) {
      const response = await this.request(`/batch/${batchId}`);
      if (!response.ok) return null;
      
      const batch: PodioBatch = await response.json();
      
      if (batch.status === 'completed') {
        return batch;
      } else if (batch.status === 'failed') {
        throw new Error("Batch export failed on Podio side");
      }

      await new Promise(resolve => setTimeout(resolve, 2000));
      attempts++;
    }
    return null; 
  }

  async getAppFiles(appId: number): Promise<PodioFile[]> {
    let allFiles: PodioFile[] = [];
    let offset = 0;
    const limit = 100;
    let hasMore = true;

    while (hasMore) {
      const response = await this.request(`/file/app/${appId}/?limit=${limit}&offset=${offset}&sort_by=created_on`);

      if (!response.ok) break;

      const files: PodioFile[] = await response.json();
      allFiles = [...allFiles, ...files];

      if (files.length < limit) {
        hasMore = false;
      } else {
        offset += limit;
      }
    }
    return allFiles;
  }

  async downloadFileContent(link: string): Promise<Blob> {
    // Usamos isFullUrl = true porque 'link' viene completo de Podio
    // El método request() se encargará de ponerle el proxy si es necesario
    const response = await this.request(link, {}, true);
    if (!response.ok) throw new Error("Download failed");
    return await response.blob();
  }
}