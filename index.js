require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const { Telegraf } = require('telegraf');
const fs = require('fs');
const path = require('path');

const app = express();

// Parse JSON but also capture raw body for debugging
app.use(bodyParser.json({
    verify: (req, res, buf) => {
        req.rawBody = buf.toString();
    }
}));

// Also handle text/plain in case TradingView sends it as text
app.use(bodyParser.text({ type: 'text/plain' }));

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_IDS = (process.env.ADMIN_CHAT_IDS || '').split(',').map(id => id.trim());
const PORT = process.env.PORT || 3000;
const CONFIG_PATH = path.join(__dirname, 'config.json');

if (!BOT_TOKEN) {
    console.error('Error: BOT_TOKEN must be defined in .env');
    process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// Helper to load/save config
const getConfig = () => JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
const saveConfig = (config) => fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));

// Admin middleware
const isAdmin = (ctx, next) => {
    const userId = ctx.from.id.toString();
    if (ADMIN_CHAT_IDS.includes(userId)) {
        return next();
    }
    console.log(`Unauthorized access attempt by ${userId}`);
    ctx.reply('🚫 You are not authorized to use this command.');
};

// --- Bot Commands ---

bot.command('on', isAdmin, (ctx) => {
    const config = getConfig();
    config.enabled = true;
    saveConfig(config);
    ctx.reply('🟢 Bot is now ON. Signals will be forwarded.');
});

bot.command('off', isAdmin, (ctx) => {
    const config = getConfig();
    config.enabled = false;
    saveConfig(config);
    ctx.reply('🔴 Bot is now OFF. Signals are paused.');
});

bot.command('addchannel', isAdmin, (ctx) => {
    const args = ctx.message.text.split(' ');
    if (args.length < 2) return ctx.reply('Usage: /addchannel <channel_id>');

    const channelId = args[1];
    const config = getConfig();

    if (!config.channels.includes(channelId)) {
        config.channels.push(channelId);
        saveConfig(config);
        ctx.reply(`✅ Channel ${channelId} added.`);
    } else {
        ctx.reply('ℹ️ Channel already in list.');
    }
});

bot.command('removechannel', isAdmin, (ctx) => {
    const args = ctx.message.text.split(' ');
    if (args.length < 2) return ctx.reply('Usage: /removechannel <channel_id>');

    const channelId = args[1];
    const config = getConfig();

    config.channels = config.channels.filter(id => id !== channelId);
    saveConfig(config);
    ctx.reply(`❌ Channel ${channelId} removed.`);
});

bot.command('list', isAdmin, (ctx) => {
    const config = getConfig();
    const status = config.enabled ? '🟢 ON' : '🔴 OFF';
    let msg = `📊 *Bot Status:* ${status}\n\n*Channels:*`;

    if (config.channels.length === 0) {
        msg += '\nNone';
    } else {
        config.channels.forEach(id => msg += `\n- \`${id}\``);
    }

    ctx.replyWithMarkdown(msg);
});

bot.launch().catch(err => {
    if (err.response && err.response.error_code === 409) {
        console.error('CRITICAL: 409 Conflict detected! Another instance is running with this token.');
        console.error('Please stop any other running instances of this bot.');
    } else {
        console.error('Bot launch error:', err);
    }
});

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

// --- Webhook Endpoint ---

app.post('/webhook', async (req, res) => {
    try {
        const config = getConfig();

        // Get the raw body for logging/forwarding
        const rawBody = req.rawBody || (typeof req.body === 'string' ? req.body : JSON.stringify(req.body));

        console.log('=== INCOMING WEBHOOK ===');
        console.log('Time:', new Date().toISOString());
        console.log('Content-Type:', req.headers['content-type']);
        console.log('Raw Body:', rawBody);
        console.log('========================');

        if (!config.enabled) {
            console.log('Bot is OFF. Skipping signal.');
            return res.status(200).json({ success: true, message: 'Bot is disabled' });
        }

        // ALWAYS send the raw data to Telegram first (for debugging)
        const rawMessage = `📥 *WEBHOOK RECEIVED*\n\n\`\`\`\n${rawBody.substring(0, 800)}\n\`\`\``;

        for (const channelId of config.channels) {
            await bot.telegram.sendMessage(channelId, rawMessage, { parse_mode: 'Markdown' })
                .catch(err => console.error(`Error sending raw to ${channelId}:`, err.message));
        }

        // Now try to parse and send a formatted version
        let data = {};
        let parseSuccess = false;

        if (typeof req.body === 'string') {
            try {
                data = JSON.parse(req.body);
                parseSuccess = true;
            } catch (parseError) {
                console.error('JSON parse failed:', parseError.message);
            }
        } else if (req.body && typeof req.body === 'object') {
            data = req.body;
            parseSuccess = true;
        }

        // If we successfully parsed the data, also send a formatted message
        if (parseSuccess && Object.keys(data).length > 0) {
            const ticker = data.ticker || data.symbol || 'Unknown';

            let direction = 'Signal';
            if (data.direction) {
                direction = data.direction.toUpperCase().includes('BUY') ? 'Buy' :
                    data.direction.toUpperCase().includes('SELL') ? 'Sell' :
                        data.direction;
            }

            const entryPrice = data.entry_price || data.price || data.close || 'N/A';
            const sl = data.sl || data.stop_loss || 'N/A';
            const tp1 = data.tp1 || data.take_profit || 'N/A';
            const contracts = data.contracts || 'N/A';
            const strategy = data.strategy || 'N/A';
            const timeframe = data.timeframe || 'N/A';

            // Only send formatted message if we have meaningful data
            if (data.ticker || data.direction || data.symbol) {
                let message = `🚨 *FORMATTED SIGNAL*\n`;
                message += `📈 *${direction.toUpperCase()} ${ticker} @ ${entryPrice}*\n`;
                if (strategy !== 'N/A' && strategy !== '') message += `📊 *Strategy:* \`${strategy}\`\n`;
                if (timeframe !== 'N/A' && timeframe !== '') message += `⏰ *Timeframe:* \`${timeframe}\`\n`;
                if (contracts !== 'N/A' && contracts !== '') message += `📦 *Contracts:* \`${contracts}\`\n`;
                if (sl !== 'N/A' && sl !== '') message += `🛑 *SL:* \`${sl}\`\n`;
                if (tp1 !== 'N/A' && tp1 !== '') message += `🎯 *TP1:* \`${tp1}\``;

                for (const channelId of config.channels) {
                    await bot.telegram.sendMessage(channelId, message, { parse_mode: 'Markdown' })
                        .catch(err => console.error(`Error sending formatted to ${channelId}:`, err.message));
                }
            }
        }

        res.status(200).json({ success: true, message: `Signal sent to ${config.channels.length} channels` });
    } catch (error) {
        console.error('Webhook Error:', error.message);
        console.error('Full error:', error);

        // Even on error, try to notify the channel
        try {
            const config = getConfig();
            const errorMsg = `❌ *WEBHOOK ERROR*\n\n${error.message}`;
            for (const channelId of config.channels) {
                await bot.telegram.sendMessage(channelId, errorMsg, { parse_mode: 'Markdown' }).catch(() => { });
            }
        } catch (e) { }

        res.status(500).json({ success: false, error: 'Internal Error' });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
