import { Bot, GrammyError, Context, InputFile, InlineKeyboard } from "grammy";
import "dotenv/config";
import { generateGeminiImage, generatePromoMessage } from "./providers/gemini.js";
import { isGroupChat, isPrivateChat, extractBotMention, validatePrompt, formatError, formatGeminiError, log } from "./utils.js";
import { uploadImageToFirebase, createTwitterCard as createTwitterCardPage } from "./services/firebase.js";
import sharp from 'sharp';

// Concurrent generation management
interface ActiveGeneration {
  userId: number;
  chatId: number;
  prompt: string;
  startTime: number;
  generatingMessageId: number;
}

const activeGenerations = new Map<string, ActiveGeneration>();
const userLastRequest = new Map<number, number>(); // userId -> timestamp

// Cache for inline query prompts (to bypass callback_data 64 byte limit)
interface InlinePromptCache {
  prompt: string;
  userId: number;
  userName: string;
  timestamp: number;
}
const inlinePromptCache = new Map<string, InlinePromptCache>();

// Cleanup old inline prompt cache entries (older than 1 hour)
setInterval(() => {
  const now = Date.now();
  const MAX_CACHE_AGE = 60 * 60 * 1000; // 1 hour
  
  for (const [key, entry] of inlinePromptCache.entries()) {
    if (now - entry.timestamp > MAX_CACHE_AGE) {
      inlinePromptCache.delete(key);
    }
  }
}, 5 * 60 * 1000); // Check every 5 minutes

// Rate limiting and concurrent generation control
async function canUserGenerate(ctx: Context, userId: number): Promise<{ allowed: boolean; reason?: string; remaining?: number }> {
  const now = Date.now();
  const lastRequest = userLastRequest.get(userId) || 0;
  const timeSinceLastRequest = now - lastRequest;
  
  // Check channel membership first
  const membershipCheck = await checkChannelMembership(ctx, userId);
  if (!membershipCheck.allowed) {
    return membershipCheck;
  }
  
  // Check daily generation limit
  const dailyCheck = checkDailyLimit(userId);
  if (!dailyCheck.allowed) {
    return dailyCheck;
  }
  
  // Rate limit: 30 seconds between requests per user
  if (timeSinceLastRequest < 30000) {
    const waitTime = Math.ceil((30000 - timeSinceLastRequest) / 1000);
    return { 
      allowed: false, 
      reason: `⏰ Подождите ${waitTime} секунд перед новым запросом` 
    };
  }

  // Check if user has active generation
  const userActiveGeneration = Array.from(activeGenerations.values())
    .find(gen => gen.userId === userId);
    
  if (userActiveGeneration) {
    return { 
      allowed: false, 
      reason: `🎨 У вас уже идет генерация изображения. Подождите её завершения.` 
    };
  }

  return { allowed: true, remaining: dailyCheck.remaining };
}

function addActiveGeneration(key: string, generation: ActiveGeneration): void {
  activeGenerations.set(key, generation);
  userLastRequest.set(generation.userId, generation.startTime);
}

function removeActiveGeneration(key: string): void {
  activeGenerations.delete(key);
}

// Cleanup old generations (in case of crashes)
setInterval(() => {
  const now = Date.now();
  const MAX_GENERATION_TIME = 5 * 60 * 1000; // 5 minutes
  
  for (const [key, generation] of activeGenerations.entries()) {
    if (now - generation.startTime > MAX_GENERATION_TIME) {
      console.log(`🧹 Cleaning up stale generation: ${key}`);
      removeActiveGeneration(key);
    }
  }
}, 60000); // Check every minute

// Daily generation limits
interface UserDailyStats {
  date: string; // YYYY-MM-DD format
  generations: number;
}

const userDailyGenerations = new Map<number, UserDailyStats>();
const DAILY_GENERATION_LIMIT = 10;
const REQUIRED_CHANNEL = "@pepemp3";

// Check daily generation limit
function checkDailyLimit(userId: number): { allowed: boolean; remaining?: number; reason?: string } {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const userStats = userDailyGenerations.get(userId);
  
  if (!userStats || userStats.date !== today) {
    // New day or first time user
    return { allowed: true, remaining: DAILY_GENERATION_LIMIT - 1 };
  }
  
  if (userStats.generations >= DAILY_GENERATION_LIMIT) {
    return {
      allowed: false,
      reason: `📊 Дневной лимит исчерпан! Вы можете создать ${DAILY_GENERATION_LIMIT} изображений в день. Попробуйте завтра.`
    };
  }
  
  return { allowed: true, remaining: DAILY_GENERATION_LIMIT - userStats.generations - 1 };
}

// Update daily generation count
function updateDailyGenerations(userId: number): void {
  const today = new Date().toISOString().split('T')[0];
  const userStats = userDailyGenerations.get(userId);
  
  if (!userStats || userStats.date !== today) {
    userDailyGenerations.set(userId, { date: today, generations: 1 });
  } else {
    userStats.generations += 1;
    userDailyGenerations.set(userId, userStats);
  }
}

// Check if user is member of required channel
async function checkChannelMembership(ctx: Context, userId: number): Promise<{ allowed: boolean; reason?: string }> {
  try {
    const member = await ctx.api.getChatMember(REQUIRED_CHANNEL, userId);
    const allowedStatuses = ['member', 'administrator', 'creator'];
    
    if (allowedStatuses.includes(member.status)) {
      return { allowed: true };
    } else {
      return {
        allowed: false,
        reason: `🔒 Для использования бота необходимо подписаться на канал ${REQUIRED_CHANNEL}\n\nПосле подписки попробуйте снова.`
      };
    }
  } catch (error) {
    // If we can't check (user blocked bot, channel is private, etc.)
    console.log(`❌ Failed to check membership for user ${userId}: ${error}`);
    return {
      allowed: false,
      reason: `🔒 Не удалось проверить подписку на ${REQUIRED_CHANNEL}. Убедитесь, что вы подписаны на канал и попробуйте снова.`
    };
  }
}

// Clean up old daily stats (run once per day)
setInterval(() => {
  const today = new Date().toISOString().split('T')[0];
  for (const [userId, stats] of userDailyGenerations.entries()) {
    if (stats.date !== today) {
      userDailyGenerations.delete(userId);
    }
  }
}, 24 * 60 * 60 * 1000); // Check every 24 hours

// Image caching system for lazy Firebase upload
interface CachedImage {
  originalBuffer: Buffer;
  compressedBuffer: Buffer;
  filename: string;
  firebaseUrl?: string; // Uploaded only when needed
}

const imageCache = new Map<string, CachedImage>();

// Lazy Firebase upload - uploads only when needed
async function ensureFirebaseUpload(messageId: string): Promise<string | null> {
  const cached = imageCache.get(messageId);
  if (!cached) {
    console.log(`❌ No cached image found for ${messageId}`);
    return null;
  }

  // If already uploaded, return existing URL
  if (cached.firebaseUrl) {
    console.log(`✅ Using cached Firebase URL for ${messageId}`);
    return cached.firebaseUrl;
  }

  // Upload compressed image to Firebase
  try {
    console.log(`🔄 Lazy uploading image to Firebase for ${messageId}`);
    const firebaseUrl = await uploadImageToFirebase(cached.compressedBuffer, cached.filename);
    
    // Cache the URL for future use
    cached.firebaseUrl = firebaseUrl;
    firebaseImageUrls[messageId] = firebaseUrl;
    
    console.log(`✅ Lazy upload complete: ${firebaseUrl}`);
    return firebaseUrl;
  } catch (error) {
    console.error(`❌ Lazy upload failed for ${messageId}:`, error);
    return null;
  }
}

// Compress image for optimal Telegram sharing
async function compressImageForTelegram(imageBuffer: Buffer): Promise<Buffer> {
  console.log(`🗜️ Compressing image for Telegram inline sharing...`);
  const compressedBuffer = await sharp(imageBuffer)
    .resize(1024, 1024, { 
      fit: 'inside', 
      withoutEnlargement: true 
    })
    .jpeg({ 
      quality: 85,
      mozjpeg: true 
    })
    .toBuffer();
  
  const originalSize = Math.round(imageBuffer.length / 1024);
  const compressedSize = Math.round(compressedBuffer.length / 1024);
  console.log(`📏 Image size: ${originalSize}KB → ${compressedSize}KB`);
  
  return compressedBuffer;
}

// Twitter Card creation function
async function createTwitterCardLegacy(shareData: {imageUrl: string, title: string, description: string, twitterText: string}): Promise<string> {
  try {
    // In production, this would call your Firebase Functions or web service
    // For now, we'll create a simple encoded URL
    const encodedData = Buffer.from(JSON.stringify(shareData)).toString('base64url');
    const firebaseWebAppUrl = process.env.FIREBASE_WEB_APP_URL || 'https://your-project.web.app';
    return `${firebaseWebAppUrl}/twitter/${encodedData}`;
  } catch (error) {
    log(`❌ Error creating Twitter card: ${error}`);
    // Fallback to direct image URL
    return shareData.imageUrl;
  }
}

// Simple in-memory storage for user points and promo messages (in production use database)
const userPoints: Record<string, number> = {};
const promoMessages: Record<string, string> = {};
const firebaseImageUrls: Record<string, string> = {};
let messageIdCounter = 1;

function addPoints(userId: string, points: number): number {
  if (!userPoints[userId]) {
    userPoints[userId] = 0;
  }
  userPoints[userId] += points;
  return userPoints[userId];
}

function getLeaderboard(): Array<{name: string, points: number}> {
  return Object.entries(userPoints)
    .map(([userId, points]) => ({
      name: `User ${userId}`, // In production, get real names
      points
    }))
    .sort((a, b) => b.points - a.points)
    .slice(0, 10);
}

async function createSharingButtons(promoText: string, cachedMessageId: string, userId?: number): Promise<InlineKeyboard> {
  // Store promo message for sharing
  promoMessages[cachedMessageId] = promoText;
  
  // Create Twitter version of the message
  let twitterVersion = promoText
    .replace(/💬 \[Telegram\]\(https:\/\/t\.me\/pepemp3\) • 🐦 \[X\/Twitter\]\(https:\/\/x\.com\/pepegotavoice\)/, '@PEPEGOTAVOICE')
    .replace(/\n\n💬.*$/, '\n\n@PEPEGOTAVOICE');
  
  // Clean up Markdown formatting for Twitter
  twitterVersion = twitterVersion
    .replace(/\*\*(.*?)\*\*/g, '$1')  // Remove bold **text**
    .replace(/\*(.*?)\*/g, '$1')      // Remove italic *text*
    .replace(/\[(.*?)\]\(.*?\)/g, '$1') // Remove links [text](url)
    .replace(/`(.*?)`/g, '$1')        // Remove code `text`
    .trim();
  
  // Ensure text fits Twitter's 280 character limit
  if (twitterVersion.length > 250) { // Leave some space for hashtags
    twitterVersion = twitterVersion.substring(0, 240) + '... @PEPEGOTAVOICE';
  }

  // Create Twitter Intent URL with Twitter Card for image preview
  let twitterUrl: string;
  
  // Check if we have cached image for Twitter Card
  const cachedImage = imageCache.get(cachedMessageId);
  if (cachedImage) {
    console.log(`🔄 Uploading image to Firebase before creating Twitter URL...`);
    
    // Wait for Firebase upload to complete BEFORE creating Twitter URL
    try {
      const firebaseUrl = await ensureFirebaseUpload(cachedMessageId);
      
      if (firebaseUrl) {
        console.log(`🃏 Firebase upload complete: ${firebaseUrl}`);
        
        // Create Twitter Card URL with actual image URL
        const cardTitle = encodeURIComponent("AI-Generated Pepe Meme");
        const shortDescription = encodeURIComponent("Check out this AI-generated Pepe meme! @PEPEGOTAVOICE #PepeMP3");
        const cardImageUrl = encodeURIComponent(firebaseUrl);
        const cardUrl = `https://us-central1-pepe-shillbot.cloudfunctions.net/twitterCard?imageUrl=${cardImageUrl}&title=${cardTitle}&description=${shortDescription}`;
        
        // Include Twitter Card URL in tweet for automatic image preview
        const tweetWithCard = `${twitterVersion}\n\n${cardUrl}`;
        const encodedText = encodeURIComponent(tweetWithCard);
        twitterUrl = `https://twitter.com/intent/tweet?text=${encodedText}`;
        
        // Award 2 points for Twitter sharing (Twitter Card generation indicates intent to share)
        if (userId) {
          const newPoints = addPoints(userId.toString(), 2);
          console.log(`🎯 User ${userId} earned 2 points for Twitter sharing (Twitter Card generated). Total: ${newPoints} points`);
        }
        
        console.log(`🃏 Twitter Card URL with real image: ${cardUrl}`);
        console.log(`📏 Total Twitter URL length: ${twitterUrl.length} characters`);
      } else {
        throw new Error('Firebase upload failed');
      }
    } catch (error) {
      console.error('❌ Firebase upload failed, falling back to text-only tweet:', error);
      // Fallback to text-only tweet if Firebase upload fails
      const encodedText = encodeURIComponent(twitterVersion);
      twitterUrl = `https://twitter.com/intent/tweet?text=${encodedText}`;
    }
  } else {
    // Fallback to text-only tweet if no cached image
    const encodedText = encodeURIComponent(twitterVersion);
    twitterUrl = `https://twitter.com/intent/tweet?text=${encodedText}`;
  }
  
  // Fallback for very long URLs
  if (twitterUrl.length > 2000) {
    const fallbackText = `🐸 Check out $PEPE.MP3 - AI-generated Pepe memes! @PEPEGOTAVOICE #TON #PepeMP3`;
    twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(fallbackText)}`;
  }
  
  // Direct sharing buttons without intermediate steps
  return new InlineKeyboard()
    .switchInline('🫂 Поделиться в Telegram', `share:${cachedMessageId}`)
    .row()
    .url('🐦 Поделиться в Twitter', twitterUrl);
}

// Bot configuration
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!BOT_TOKEN) {
  throw new Error("TELEGRAM_BOT_TOKEN environment variable is required");
}

const bot = new Bot(BOT_TOKEN);

// Error handling
bot.catch((err) => {
  const e = err.error;
  if (e instanceof GrammyError) {
    log(`Error in request: ${e.description}`, "error");
  } else {
    log(`Unknown error: ${e}`, "error");
  }
});

// Mood system data
const predefinedMoods = [
  // English moods
  "cheerful", "rich", "cool", "angry", "sad", "emotionless",
  
  // Russian moods  
  "веселый", "богатый", "крутой", "злой", "грустный", "безэмоциональный"
];

function getRandomMood(): string {
  return predefinedMoods[Math.floor(Math.random() * predefinedMoods.length)];
}

function extractMoodFromPrompt(prompt: string): string | null {
  const promptLower = prompt.toLowerCase();
  
  // Define mood synonyms for better recognition
  const moodSynonyms: Record<string, string[]> = {
    "cheerful": ["happy", "joyful", "cheerful"],
    "веселый": ["счастливый", "радостный", "веселый"],
    "rich": ["wealthy", "rich", "expensive"],
    "богатый": ["богатый", "состоятельный", "денежный"],
    "cool": ["cool", "awesome", "stylish"],
    "крутой": ["крутой", "классный", "стильный"],
    "angry": ["angry", "mad", "furious"],
    "злой": ["злой", "сердитый", "разъяренный"],
    "sad": ["sad", "depressed", "melancholy"],
    "грустный": ["грустный", "печальный", "унылый"],
    "emotionless": ["emotionless", "neutral", "blank"],
    "безэмоциональный": ["безэмоциональный", "нейтральный", "пустой"]
  };
  
  // Check for direct matches or synonyms
  for (const [baseMood, synonyms] of Object.entries(moodSynonyms)) {
    if (synonyms.some(synonym => promptLower.includes(synonym))) {
      return baseMood;
    }
  }
  
  return null;
}

function buildPepePrompt(userPrompt: string, mood: string): string {
  return `Create a high-quality 3D render of Pepe the Frog with large glossy eyes, wearing a holographic jacket and neon headphones. Style: synthwave + vaporwave aesthetic, minimalism. Bright neon colors, glossy reflections, Pixar animation style.

Scene: ${userPrompt}
Mood: ${mood}

Ensure Pepe is the main character and maintain the iconic frog appearance with the signature aesthetic.`;
}

// Commands
bot.command("start", async (ctx) => {
  const welcomeMessage = `🐸 Привет! Я ShillBot - генератор изображений Pepe с промо-сообщениями для $PEPE.MP3!

🎨 **Как пользоваться:**
• Просто напишите мне, что должен делать Pepe
• Пример: "Pepe играет в игры" или "Pepe coding"
• Я создам изображение + промо-сообщение + кнопки для шэринга

🎯 **Система баллов:**
• 🫂 Telegram: +1 балл (переслать сообщение с картинкой)
• 🐦 Twitter: +2 балла (опубликовать готовый твит)
• /leaderboard - таблица лидеров

📱 **Как делиться:**
• **Telegram:** Нажмите и удерживайте сообщение с картинкой → "Переслать"
• **Twitter:** Нажмите кнопку → откроется готовый твит → "Tweet"

🌟 **Дополнительные команды:**
• /moods - список всех настроений  
• /promo - получить промо-сообщение
• /points - проверить свои баллы
• /limit - проверить свои лимиты
• /leaderboard - таблица лидеров

📊 **Ограничения:**
• **${DAILY_GENERATION_LIMIT} генераций в день** на пользователя
• **Обязательная подписка на ${REQUIRED_CHANNEL}**
• **30 секунд** между запросами

Попробуйте написать что-то вроде "грустный Pepe" или "happy Pepe cooking"!`;

  await ctx.reply(welcomeMessage);
});

bot.command("moods", async (ctx) => {
  const message = `🎭 **Доступные настроения:**

🇺🇸 **English:** cheerful, rich, cool, angry, sad, emotionless
🇷🇺 **Русский:** веселый, богатый, крутой, злой, грустный, безэмоциональный

💡 **Как использовать:**
• Включите любое настроение в ваш запрос
• Пример: "cool Pepe at work" или "грустный Pepe дома"
• Если не указать настроение, я выберу случайное из 6 вариантов!`;

  await ctx.reply(message, { parse_mode: "Markdown" });
});

bot.command("promo", async (ctx) => {
  try {
    const language = /[а-яё]/i.test(ctx.message?.text || '') ? 'ru' : 'en';
    const promo = await generatePromoMessage(language);
    
    // Create temporary messageId for promo-only sharing
    const promoMessageId = `promo${Date.now()}`;
    
    // Create sharing buttons for the promo message
    const sharingButtons = await createSharingButtons(promo, promoMessageId, ctx.from?.id);
    
    await ctx.reply(promo, { 
      parse_mode: "Markdown",
      reply_markup: sharingButtons
    });
  } catch (error) {
    log(`Error generating promo: ${error}`, "error");
    await ctx.reply("❌ Ошибка при генерации промо-сообщения. Попробуйте позже.");
  }
});

// Points check command
bot.command("points", async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) {
    await ctx.reply("❌ Ошибка идентификации пользователя");
    return;
  }

  const currentPoints = userPoints[userId.toString()] || 0;
  const userName = ctx.from?.first_name || ctx.from?.username || "Unknown";
  
  let pointsMessage = `🎯 **Ваши баллы, ${userName}:**\n\n`;
  pointsMessage += `💰 Текущий баланс: **${currentPoints}** баллов\n\n`;
  
  pointsMessage += `📈 **Как заработать больше:**\n`;
  pointsMessage += `• 🫂 Telegram sharing: +1 балл\n`;
  pointsMessage += `• 🐦 Twitter sharing: +2 балла\n\n`;
  
  pointsMessage += `🏆 Посмотрите таблицу лидеров: /leaderboard`;
  
  await ctx.reply(pointsMessage, { parse_mode: "Markdown" });
});

// Leaderboard command
bot.command("leaderboard", async (ctx) => {
  const leaderboard = getLeaderboard();
  
  if (leaderboard.length === 0) {
    await ctx.reply("🏆 Таблица лидеров пуста! Начните делиться контентом, чтобы заработать очки!");
    return;
  }
  
  let message = "🏆 **Топ-10 лидеров по очкам:**\n\n";
  
  for (let i = 0; i < leaderboard.length; i++) {
    const { name, points } = leaderboard[i];
    const position = i + 1;
    const medal = position === 1 ? "🥇" : position === 2 ? "🥈" : position === 3 ? "🥉" : "📍";
    message += `${medal} ${position}. ${name}: **${points}** очков\n`;
  }
  
  message += "\n💡 Делитесь контентом, чтобы заработать больше очков!";
  
  await ctx.reply(message, { parse_mode: "Markdown" });
});

// Main image generation handler
bot.on("message:text", async (ctx) => {
  const prompt = ctx.message.text;
  
  // Skip if this is a command (let command handlers process it)
  if (prompt.startsWith('/')) {
    return;
  }
  
  const isGroup = isGroupChat(ctx);
  const isPrivate = isPrivateChat(ctx);
  
  // Get bot username (fallback to hardcoded if not available)
  const botUsername = ctx.me?.username || bot.botInfo?.username || "vibeshill_bot";

  // Log group messages for debugging
  if (isGroup) {
    console.log(`📨 Group message received: "${prompt.substring(0, 50)}..." from ${ctx.from?.first_name}`);
    console.log(`🤖 Bot username: @${botUsername}`);
  }

  // Skip if it's a group and bot is not mentioned
  if (isGroup) {
    const mentionedPrompt = extractBotMention(prompt, botUsername);
    if (!mentionedPrompt) {
      // Also check if message starts with @username
      if (!prompt.toLowerCase().includes(`@${botUsername.toLowerCase()}`)) {
        return;
      }
    }
    console.log(`✅ Bot mentioned in group! Processing...`);
  }

  // Extract clean prompt (remove bot mention if present)
  const cleanPrompt = extractBotMention(prompt, botUsername) || prompt.replace(new RegExp(`@${botUsername}\\s*`, 'gi'), '').trim();
  
  // Validate prompt
  const validation = validatePrompt(cleanPrompt);
  if (!validation.isValid) {
    await ctx.reply(`❌ ${validation.error}`, {
      reply_to_message_id: ctx.message.message_id
    });
    return;
  }

  await generateAndReply(ctx, cleanPrompt, ctx.message.message_id);
});

async function generateAndReply(ctx: Context, userPrompt: string, replyToMessageId?: number) {
  const userId = ctx.from?.id;
  const chatId = ctx.chat?.id;
  
  if (!userId || !chatId) {
    await ctx.reply("❌ Ошибка идентификации пользователя");
    return;
  }

  // Check if user can generate
  const generationCheck = await canUserGenerate(ctx, userId);
  if (!generationCheck.allowed) {
    await ctx.reply(generationCheck.reason!, {
      reply_to_message_id: replyToMessageId
    });
    return;
  }

  // Send "generating" message with remaining count
  const remainingText = generationCheck.remaining !== undefined ? 
    ` (Осталось генераций сегодня: ${generationCheck.remaining})` : '';
  const generatingMessage = await ctx.reply(`🎨 Генерирую изображение Pepe...${remainingText}`, {
    reply_to_message_id: replyToMessageId
  });

  // Create generation key and add to active generations
  const generationKey = `${userId}_${Date.now()}`;
  const generation: ActiveGeneration = {
    userId,
    chatId,
    prompt: userPrompt,
    startTime: Date.now(),
    generatingMessageId: generatingMessage.message_id
  };
  
  addActiveGeneration(generationKey, generation);
  
  try {
    log(`Generating image for prompt: "${userPrompt}"`);

    // Better language detection for promo generation
    const containsCyrillic = /[а-яё]/i.test(userPrompt);
    const language = containsCyrillic ? 'ru' : 'en';
    
    log(`Detected language: ${language} for prompt: "${userPrompt}"`);

    // Extract or assign mood
    let mood = extractMoodFromPrompt(userPrompt);
    if (!mood) {
      mood = getRandomMood();
    }
    
    log(`Selected mood: ${mood}`);

    // Create enhanced prompt with Pepe style and mood
    const enhancedPrompt = buildPepePrompt(userPrompt, mood);

    // Generate image and promo message in parallel
    const [imageBuffer, promoMessage] = await Promise.all([
      generateGeminiImage({ prompt: enhancedPrompt }),
      generatePromoMessage(language)
    ]);

    // Check if image was generated successfully
    if (!imageBuffer) {
      throw new Error("Failed to generate image");
    }

    // Compress image and store in cache for lazy Firebase upload
    const filename = `pepe_${Date.now()}_${Math.random().toString(36).substring(2)}.jpg`;
    const messageId = `msg${messageIdCounter++}`;
    
    try {
      // Compress image immediately
      const compressedBuffer = await compressImageForTelegram(Buffer.from(imageBuffer));
      
      // Store in cache for lazy upload
      imageCache.set(messageId, {
        originalBuffer: Buffer.from(imageBuffer),
        compressedBuffer: compressedBuffer,
        filename: filename
        // firebaseUrl will be set when uploaded lazily
      });
      
      console.log(`� Image cached for lazy upload: ${messageId}`);
      
    } catch (error) {
      log(`❌ Image compression failed: ${error}`);
      // Continue without caching - sharing will work but without optimization
    }

    // Create sharing buttons (Firebase upload will happen lazily)
    const sharingButtons = promoMessage ? await createSharingButtons(promoMessage, messageId, userId) : undefined;
    
    // Delete the "generating" message
    if (ctx.chat) {
      await ctx.api.deleteMessage(ctx.chat.id, generatingMessage.message_id).catch(() => {
        // Ignore errors if message already deleted or too old
      });
    }

    // Send image with promo message and sharing buttons
    await ctx.replyWithPhoto(new InputFile(imageBuffer), {
      caption: promoMessage,
      parse_mode: "Markdown",
      reply_to_message_id: replyToMessageId,
      reply_markup: sharingButtons
    });

    log(`Successfully generated image and promo for: "${userPrompt}" (language: ${language}, mood: ${mood})`);
    
    // Update daily generation count
    updateDailyGenerations(userId);
    
    // Remove from active generations
    removeActiveGeneration(generationKey);

  } catch (error) {
    log(`Error generating content: ${error}`, "error");
    
    // Remove from active generations on error
    removeActiveGeneration(generationKey);
    
    // Delete the "generating" message on error too
    if (ctx.chat) {
      await ctx.api.deleteMessage(ctx.chat.id, generatingMessage.message_id).catch(() => {
        // Ignore errors if message already deleted
      });
    }
    
    const errorMessage = error instanceof Error ? 
      formatGeminiError(error.message) : 
      "❌ Произошла ошибка при генерации. Попробуйте еще раз.";
    
    await ctx.reply(errorMessage, {
      reply_to_message_id: replyToMessageId
    });
  }
}

// Handle callback queries (button clicks)
// Handle chosen inline result (when user actually sends the shared content)
bot.on("chosen_inline_result", async (ctx) => {
  const resultId = ctx.chosenInlineResult.result_id;
  const userId = ctx.from?.id;
  
  if (userId && resultId.startsWith("share_")) {
    // User actually sent the shared content, award additional bonus
    const newPoints = addPoints(userId.toString(), 1);
    const userName = ctx.from?.first_name || ctx.from?.username || "Unknown";
    console.log(`🎯 ${userName} (${userId}) earned bonus 1 point for completing Telegram share. Total: ${newPoints} points`);
  }
});

// Handle inline queries (for sharing content and generating new images)
bot.on("inline_query", async (ctx) => {
  const query = ctx.inlineQuery.query.trim();
  const userId = ctx.from?.id;
  const userName = ctx.from?.first_name || ctx.from?.username || "Unknown";
  
  console.log(`🔍 Inline query received from ${userName} (${userId}): "${query}"`);
  
  // Handle sharing queries (existing functionality)
  if (query.startsWith("share:")) {
    const messageId = query.split("share:")[1];
    const promoMessage = promoMessages[messageId];
    
    console.log(`📝 Found promo message for ${messageId}:`, !!promoMessage);
    
    if (!promoMessage) {
      console.log(`❌ Message ${messageId} not found in storage`);
      console.log(`📋 Available messages:`, Object.keys(promoMessages));
      await ctx.answerInlineQuery([
        {
          type: "article",
          id: "not_found",
          title: "❌ Сообщение не найдено",
          description: "Сгенерируйте новое изображение для шеринга",
          input_message_content: {
            message_text: "🐸 **ShillBot** - генератор AI изображений Pepe\n\n🎨 Напишите боту что должен делать Pepe!\n\n💬 [Telegram](https://t.me/pepemp3) • 🐦 [X/Twitter](https://x.com/pepegotavoice)",
            parse_mode: "Markdown"
          }
        }
      ]);
      return;
    }

    // Try to get Firebase URL (lazy upload if needed)
    const firebaseImageUrl = await ensureFirebaseUpload(messageId);
    
    // Award 1 point for Telegram sharing (inline query indicates intent to share)
    const userId = ctx.from?.id;
    if (userId) {
      const newPoints = addPoints(userId.toString(), 1);
      const userName = ctx.from?.first_name || ctx.from?.username || "Unknown";
      console.log(`🎯 ${userName} (${userId}) earned 1 point for Telegram sharing (inline query). Total: ${newPoints} points`);
    }
    
    if (firebaseImageUrl) {
      // Return photo result with promo message
      console.log(`📸 Returning photo result with caption`);
      console.log(`🔗 Image URL: ${firebaseImageUrl}`);
      
      await ctx.answerInlineQuery([
        {
          type: "photo",
          id: `share_${messageId}`,
          photo_url: firebaseImageUrl,
          thumbnail_url: firebaseImageUrl,
          title: "🐸 Поделиться Pepe изображением",
          description: "AI-генерированный Pepe с промо-сообщением",
          caption: promoMessage,
          parse_mode: "Markdown"
        }
      ], {
        cache_time: 1,
        is_personal: true
      });
    } else {
      // Fallback to text-only if no image or upload failed
      console.log(`📝 Returning text-only result (no image available)`);
      await ctx.answerInlineQuery([
        {
          type: "article",
          id: `share_text_${messageId}`,
          title: "🐸 Поделиться промо-сообщением",
          description: "Текстовое промо-сообщение $PEPE.MP3",
          input_message_content: {
            message_text: promoMessage,
            parse_mode: "Markdown"
          }
        }
      ], {
        cache_time: 1,
        is_personal: true
      });
    }
    return;
  }
  
  // Handle image generation queries (when user types prompt in inline)
  // Instead of generating immediately (which times out), show a button to trigger generation
  if (query && query.length > 0) {
    const userId = ctx.from?.id;
    
    if (!userId) {
      await ctx.answerInlineQuery([
        {
          type: "article",
          id: "error",
          title: "❌ Ошибка",
          description: "Не удалось идентифицировать пользователя",
          input_message_content: {
            message_text: "❌ Ошибка идентификации пользователя",
          }
        }
      ]);
      return;
    }

    // Generate unique cache key for this prompt
    const cacheKey = `inl_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
    
    // Cache the prompt for later retrieval
    inlinePromptCache.set(cacheKey, {
      prompt: query,
      userId: userId,
      userName: userName,
      timestamp: Date.now()
    });
    
    console.log(`💾 Cached inline prompt: ${cacheKey} -> "${query}"`);
    
    // Determine language and mood for display
    const language: 'ru' | 'en' = /[а-яё]/i.test(query) ? 'ru' : 'en';
    const displayMood = extractMoodFromPrompt(query) || (language === 'ru' ? 'случайное' : 'random');
    
    // Return article with generate button
    await ctx.answerInlineQuery([
      {
        type: "article",
        id: `gen_${cacheKey}`,
        title: `🎨 Сгенерировать: ${query.substring(0, 40)}${query.length > 40 ? '...' : ''}`,
        description: `Нажмите чтобы создать AI Pepe • Настроение: ${displayMood}`,
        input_message_content: {
          message_text: `🎨 **Запрос на генерацию Pepe**\n\n📝 Промпт: _${query}_\n\n👇 Нажмите кнопку чтобы сгенерировать изображение`,
          parse_mode: "Markdown"
        },
        reply_markup: {
          inline_keyboard: [[
            { text: "🚀 Сгенерировать Pepe!", callback_data: `igen:${cacheKey}` }
          ]]
        }
      }
    ], {
      cache_time: 1,
      is_personal: true
    });
    
    console.log(`✅ Inline query answered with generate button for: "${query}"`);
    return;
  }
  
  // Default inline query response (when query is empty)
  await ctx.answerInlineQuery([
    {
      type: "article",
      id: "default",
      title: "🤖 ShillBot - AI Pepe Generator",
      description: "Введите описание для генерации AI изображения Pepe",
      input_message_content: {
        message_text: "🐸 **ShillBot** - генератор AI изображений Pepe\n\n🎨 Напишите боту что должен делать Pepe!\n\n💬 [Telegram](https://t.me/pepemp3) • 🐦 [X/Twitter](https://x.com/pepegotavoice)",
        parse_mode: "Markdown"
      }
    }
  ]);
});

// Handle inline generation button callback
bot.on("callback_query:data", async (ctx) => {
  const data = ctx.callbackQuery.data;
  
  // Handle inline generation button (igen:cacheKey)
  if (data.startsWith("igen:")) {
    const cacheKey = data.replace("igen:", "");
    const cachedPrompt = inlinePromptCache.get(cacheKey);
    
    console.log(`🔘 Generate button clicked: ${cacheKey}`);
    
    if (!cachedPrompt) {
      await ctx.answerCallbackQuery({
        text: "❌ Запрос устарел. Попробуйте снова.",
        show_alert: true
      });
      return;
    }
    
    const userId = ctx.from?.id;
    const userName = ctx.from?.first_name || ctx.from?.username || "Unknown";
    
    if (!userId) {
      await ctx.answerCallbackQuery({
        text: "❌ Ошибка идентификации",
        show_alert: true
      });
      return;
    }
    
    // Check membership
    try {
      const membershipCheck = await checkChannelMembership(ctx, userId);
      if (!membershipCheck.allowed) {
        await ctx.answerCallbackQuery({
          text: "🔒 Подпишитесь на @pepemp3 для использования бота",
          show_alert: true
        });
        return;
      }
    } catch (error) {
      console.log(`⚠️ Membership check failed, allowing anyway:`, error);
    }
    
    // Check daily limits
    try {
      const dailyCheck = checkDailyLimit(userId);
      if (!dailyCheck.allowed) {
        await ctx.answerCallbackQuery({
          text: dailyCheck.reason || "📊 Дневной лимит исчерпан",
          show_alert: true
        });
        return;
      }
    } catch (error) {
      console.log(`⚠️ Daily limit check failed, allowing anyway:`, error);
    }
    
    // Answer callback immediately to prevent timeout
    await ctx.answerCallbackQuery({
      text: "🎨 Генерирую изображение..."
    });
    
    // Update message to show generating status
    try {
      await ctx.editMessageText(
        `🎨 **Генерация Pepe...**\n\n📝 Промпт: _${cachedPrompt.prompt}_\n\n⏳ Пожалуйста, подождите...`,
        { parse_mode: "Markdown" }
      );
    } catch (error) {
      console.log(`⚠️ Could not edit message:`, error);
    }
    
    try {
      console.log(`🎨 Starting inline generation for ${userName}: "${cachedPrompt.prompt}"`);
      
      const language: 'ru' | 'en' = /[а-яё]/i.test(cachedPrompt.prompt) ? 'ru' : 'en';
      const userMood = extractMoodFromPrompt(cachedPrompt.prompt);
      const mood = userMood || getRandomMood();
      
      const pepePrompt = buildPepePrompt(cachedPrompt.prompt, mood);
      const imageResult = await generateGeminiImage({ prompt: pepePrompt });
      
      if (!imageResult) {
        throw new Error("Failed to generate image");
      }
      
      console.log(`✅ Image generated, size: ${imageResult.length} bytes`);
      
      const imageBuffer = Buffer.from(imageResult);
      
      // Generate promo message
      const promo = await generatePromoMessage(language);
      
      // Create unique message ID
      const messageId = `inlbtn${Date.now()}`;
      
      // Cache image and promo
      const compressedBuffer = await compressImageForTelegram(imageBuffer);
      const filename = `pepe_${Date.now()}_${Math.random().toString(36).substr(2, 11)}.jpg`;
      
      imageCache.set(messageId, {
        originalBuffer: imageBuffer,
        compressedBuffer: compressedBuffer,
        filename: filename
      });
      
      promoMessages[messageId] = promo;
      
      // Award points
      updateDailyGenerations(userId);
      const newPoints = addPoints(userId.toString(), 1);
      console.log(`🎯 User ${userName} earned 1 point. Total: ${newPoints} points`);
      
      // Create sharing buttons
      const sharingButtons = await createSharingButtons(promo, messageId, userId);
      
      // Delete the "generating" message
      try {
        await ctx.deleteMessage();
      } catch (error) {
        console.log(`⚠️ Could not delete message:`, error);
      }
      
      // Send the generated image
      const chatId = ctx.chat?.id || ctx.from.id;
      await ctx.api.sendPhoto(chatId, new InputFile(compressedBuffer, filename), {
        caption: promo,
        parse_mode: "Markdown",
        reply_markup: sharingButtons
      });
      
      console.log(`✅ Inline button generation complete for: "${cachedPrompt.prompt}"`);
      
      // Cleanup cache
      inlinePromptCache.delete(cacheKey);
      
    } catch (error) {
      console.error(`❌ Inline button generation failed:`, error);
      
      try {
        await ctx.editMessageText(
          `❌ **Ошибка генерации**\n\n📝 Промпт: _${cachedPrompt.prompt}_\n\nПопробуйте снова позже.`,
          { parse_mode: "Markdown" }
        );
      } catch (e) {
        console.log(`⚠️ Could not edit error message:`, e);
      }
    }
    
    return;
  }
  
  // Handle other callback queries (existing functionality)
  await ctx.answerCallbackQuery();
});

// Leaderboard command
// Status command for monitoring (admin only)
bot.command("status", async (ctx) => {
  const userId = ctx.from?.id;
  // Simple admin check - you can enhance this with proper admin list
  const adminIds: number[] = []; // Add your admin user IDs here
  
  if (!userId || !adminIds.includes(userId)) {
    await ctx.reply("❌ Команда доступна только администраторам");
    return;
  }

  const activeCount = activeGenerations.size;
  const now = Date.now();
  
  let statusMessage = `📊 **Статус бота:**\n\n`;
  statusMessage += `🎨 Активных генераций: **${activeCount}**\n`;
  statusMessage += `💾 Изображений в кэше: **${imageCache.size}**\n`;
  statusMessage += `👥 Пользователей с дневными лимитами: **${userDailyGenerations.size}**\n`;
  statusMessage += `📊 Дневной лимит: **${DAILY_GENERATION_LIMIT}** генераций\n`;
  statusMessage += `📢 Обязательный канал: **${REQUIRED_CHANNEL}**\n\n`;
  
  if (activeCount > 0) {
    statusMessage += `**Активные генерации:**\n`;
    for (const [key, gen] of activeGenerations.entries()) {
      const duration = Math.round((now - gen.startTime) / 1000);
      statusMessage += `• User ${gen.userId}: "${gen.prompt.slice(0, 30)}..." (${duration}s)\n`;
    }
  }
  
  await ctx.reply(statusMessage, { parse_mode: "Markdown" });
});

// User limit check command
bot.command("limit", async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) {
    await ctx.reply("❌ Ошибка идентификации пользователя");
    return;
  }

  const dailyCheck = checkDailyLimit(userId);
  const today = new Date().toISOString().split('T')[0];
  const userStats = userDailyGenerations.get(userId);
  const used = (userStats && userStats.date === today) ? userStats.generations : 0;
  
  let limitMessage = `📊 **Ваши лимиты:**\n\n`;
  limitMessage += `🎨 Использовано сегодня: **${used}/${DAILY_GENERATION_LIMIT}**\n`;
  limitMessage += `⏰ Лимит обновляется: **каждый день в 00:00 UTC**\n`;
  limitMessage += `📢 Обязательная подписка: **${REQUIRED_CHANNEL}**\n\n`;
  
  if (dailyCheck.allowed && dailyCheck.remaining !== undefined) {
    limitMessage += `✅ Осталось генераций: **${dailyCheck.remaining}**`;
  } else if (!dailyCheck.allowed) {
    limitMessage += `❌ ${dailyCheck.reason}`;
  }
  
  await ctx.reply(limitMessage, { parse_mode: "Markdown" });
});

// Start the bot
log("ShillBot is running...");
// Set bot commands for better UX
await bot.api.setMyCommands([
  { command: "start", description: "🚀 Начать работу с ботом" },
  { command: "help", description: "❓ Показать помощь" },
  { command: "points", description: "🎯 Проверить баллы" },
  { command: "leaderboard", description: "🏆 Таблица лидеров" },
  { command: "status", description: "📊 Статус бота (только для админов)" },
  { command: "limit", description: "📈 Проверить дневной лимит" }
]);

console.log("✅ Bot commands set successfully");

bot.start();