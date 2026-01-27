require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const { Telegraf } = require('telegraf');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(bodyParser.json());

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

bot.launch();

// --- Webhook Endpoint ---

app.post('/webhook', async (req, res) => {
    try {
        const config = getConfig();
        if (!config.enabled) {
            console.log('Bot is OFF. Skipping signal.');
            return res.status(200).json({ success: true, message: 'Bot is disabled' });
        }

        console.log('--- Incoming Webhook ---');
        console.log(JSON.stringify(req.body, null, 2));

        const data = req.body || {};
        const ticker = data.ticker || data.symbol || 'Unknown';

        let direction = 'Signal';
        if (data.direction) {
            direction = data.direction.toUpperCase().includes('BUY') ? 'Buy' :
                data.direction.toUpperCase().includes('SELL') ? 'Sell' :
                    data.direction;
        }

        const entryPrice = data.entry_price || data.price || 'N/A';
        const sl = data.sl || data.stop_loss || 'N/A';
        const tp1 = data.tp1 || data.take_profit || 'N/A';

        let message = `🚨 *NEW SIGNAL*\n`;
        message += `📈 *${direction.toUpperCase()} ${ticker} @ ${entryPrice}*\n`;
        if (sl !== 'N/A' && sl !== '') message += `🛑 *SL:* \`${sl}\` \n`;
        if (tp1 !== 'N/A' && tp1 !== '') message += `🎯 *TP1:* \`${tp1}\``;

        if (!data.ticker && !data.direction) {
            message = `⚠️ *Incomplete Alert Format*\nRaw: \`${JSON.stringify(data)}\``;
        }

        // Broadcast to all channels
        const sendPromises = config.channels.map(channelId =>
            bot.telegram.sendMessage(channelId, message, { parse_mode: 'Markdown' })
                .catch(err => console.error(`Error sending to ${channelId}:`, err.message))
        );

        await Promise.all(sendPromises);

        res.status(200).json({ success: true, message: `Signal sent to ${config.channels.length} channels` });
    } catch (error) {
        console.error('Webhook Error:', error.message);
        res.status(500).json({ success: false, error: 'Internal Error' });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
