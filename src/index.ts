import { Bot, GrammyError, Context, InputFile, InlineKeyboard } from "grammy";
import "dotenv/config";
import { generateGeminiImage, generatePromoMessage } from "./providers/gemini.js";
import { isGroupChat, isPrivateChat, extractBotMention, validatePrompt, formatError, formatGeminiError, log } from "./utils.js";
import { uploadImageToFirebase, createTwitterCard as createTwitterCardPage } from "./services/firebase.js";
import sharp from 'sharp';

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

function createSharingButtons(promoText: string, cachedMessageId: string): InlineKeyboard {
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
  
  // Create Twitter Intent URL (Twitter Cards will be handled when user clicks)
  const encodedText = encodeURIComponent(twitterVersion);
  let twitterUrl = `https://twitter.com/intent/tweet?text=${encodedText}`;
  
  // Fallback for very long URLs
  if (twitterUrl.length > 2000) {
    const fallbackText = `🐸 Check out $PEPE.MP3 - AI-generated Pepe memes! @PEPEGOTAVOICE #TON #PepeMP3`;
    twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(fallbackText)}`;
  }
  
  // Use Switch Inline Query for Telegram sharing (will trigger lazy Firebase upload)
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
    const sharingButtons = createSharingButtons(promo, promoMessageId);
    
    await ctx.reply(promo, { 
      parse_mode: "Markdown",
      reply_markup: sharingButtons
    });
  } catch (error) {
    log(`Error generating promo: ${error}`, "error");
    await ctx.reply("❌ Ошибка при генерации промо-сообщения. Попробуйте позже.");
  }
});

// Main image generation handler
bot.on("message:text", async (ctx) => {
  const prompt = ctx.message.text;
  const isGroup = isGroupChat(ctx);
  const isPrivate = isPrivateChat(ctx);

  // Skip if it's a group and bot is not mentioned
  if (isGroup && !extractBotMention(prompt, bot.botInfo.username)) {
    return;
  }

  // Extract clean prompt (remove bot mention if present)
  const cleanPrompt = extractBotMention(prompt, bot.botInfo.username) || prompt;
  
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
  // Send "generating" message
  const generatingMessage = await ctx.reply("🎨 Генерирую изображение Pepe...", {
    reply_to_message_id: replyToMessageId
  });
  
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
    const sharingButtons = promoMessage ? createSharingButtons(promoMessage, messageId) : undefined;
    
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

  } catch (error) {
    log(`Error generating content: ${error}`, "error");
    
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
bot.on("callback_query:data", async (ctx) => {
  const data = ctx.callbackQuery.data;
  const userId = ctx.from.id.toString();
  const userName = ctx.from.first_name || ctx.from.username || "Unknown";
  
  // Legacy handler for old Twitter confirmation buttons (can be removed later)
  if (data === "twitter_confirmed") {
    await ctx.answerCallbackQuery({
      text: "✅ Спасибо за использование бота!",
      show_alert: false
    });
  }
});

// Handle inline queries (for sharing content)
bot.on("inline_query", async (ctx) => {
  const query = ctx.inlineQuery.query;
  
  console.log(`🔍 Inline query received: "${query}"`);
  
  // Handle sharing queries
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
  
  // Default inline query response
  await ctx.answerInlineQuery([
    {
      type: "article",
      id: "default",
      title: "🤖 ShillBot - AI Pepe Generator",
      description: "Отправьте запрос боту для генерации AI изображений Pepe",
      input_message_content: {
        message_text: "🐸 **ShillBot** - генератор AI изображений Pepe\n\n🎨 Напишите боту что должен делать Pepe!\n\n💬 [Telegram](https://t.me/pepemp3) • 🐦 [X/Twitter](https://x.com/pepegotavoice)",
        parse_mode: "Markdown"
      }
    }
  ]);
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

// Start the bot
log("ShillBot is running...");
bot.start();