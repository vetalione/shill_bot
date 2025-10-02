# 🚂 Railway Deployment Guide

## Pre-deployment Setup

### 1. Prepare Firebase Service Account
1. Go to Firebase Console → Project Settings → Service Accounts
2. Generate new private key (downloads JSON file)
3. Convert JSON to base64:
   ```bash
   base64 -i path/to/service-account.json | tr -d '\n'
   ```
4. Copy the base64 string for Railway environment variables

### 2. Get Telegram Bot Token
1. Message @BotFather on Telegram
2. Copy your bot token

### 3. Get Gemini API Key
1. Go to Google AI Studio
2. Get your API key

## Railway Deployment Steps

### 1. Connect GitHub Repository
1. Go to [railway.app](https://railway.app)
2. Sign up/in with GitHub
3. Click "Deploy from GitHub repo"
4. Select your `shill_bot` repository
5. Choose `feature/minor-improvements` branch

### 2. Set Environment Variables
In Railway dashboard, go to Variables tab and add:

**Option 1: Base64 Firebase JSON (Recommended)**
```
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
GEMINI_API_KEY=your_gemini_api_key  
GOOGLE_APPLICATION_CREDENTIALS_JSON=your_base64_encoded_service_account_json
NODE_ENV=production
```

**Option 2: Individual Firebase Variables (Fallback)**
```
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
GEMINI_API_KEY=your_gemini_api_key
FIREBASE_PROJECT_ID=pepe-shillbot
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-fbsvc@pepe-shillbot.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_PRIVATE_KEY_HERE\n-----END PRIVATE KEY-----"
NODE_ENV=production
```

**Note:** Make sure the base64 string is complete and doesn't have line breaks!

### 3. Deploy
1. Railway will automatically build and deploy
2. Check logs for any errors
3. Test bot functionality

## Monitoring

### Check Logs
```bash
railway logs
```

### Resource Usage
Monitor your $5 credit usage in Railway dashboard

### Bot Status
Use `/status` command (admin only) to check bot health

## Troubleshooting

### Common Issues:
1. **Firebase credentials error** - Check base64 encoding
2. **Bot not responding** - Verify TELEGRAM_BOT_TOKEN
3. **Image generation fails** - Check GEMINI_API_KEY
4. **Out of credits** - Upgrade to paid plan ($5/month)

### Support
- Railway docs: docs.railway.app
- Bot logs: `railway logs --follow`