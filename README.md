# TradingView Webhook Bot

This bot receives JSON alerts from TradingView and forwards them to Telegram channels. It supports multiple admins and persistent configuration.

### Setup Steps:
1. Create a Telegram Bot via @BotFather.
2. Get your **Admin Chat ID** (Send a message to @userinfobot to find yours).
3. Fill in the `.env` file (`ADMIN_CHAT_IDS` can be multiple, separated by commas).
4. Run the code and use the commands below in a private chat with the bot.

## 🕹️ Admin Commands
Only authorized admins can use these:
- `/on`: Enable signal forwarding.
- `/off`: Pause signal forwarding.
- `/addchannel <id>`: Add a channel (e.g., `-100123456789`).
- `/removechannel <id>`: Remove a channel.
- `/list`: See active channels and status.

## 🛡️ Stability Tips (TradingView Side)
If things "break" from TradingView, it's usually because of empty variables or incorrect names in Pine Script.

### Recommended TradingView JSON:
```json
{
  "ticker": "{{ticker}}",
  "direction": "{{strategy.order.action}}",
  "entry_price": "{{strategy.order.price}}",
  "sl": "{{strategy.order.stop_loss}}",
  "tp1": "{{strategy.order.take_profit}}"
}
```
