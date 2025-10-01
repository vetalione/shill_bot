import { Bot, GrammyError, Context, InputFile, InlineKeyboard } from "grammy";
import "dotenv/config";
import { generateGeminiImage, generatePromoMessage } from "./providers/gemini.js";
import { isGroupChat, isPrivateChat, extractBotMention, validatePrompt, formatError, formatGeminiError, log } from "./utils.js";
import { uploadImageToFirebase } from "./services/firebase.js";

// Twitter Card creation function
async function createTwitterCard(shareData: {imageUrl: string, title: string, description: string, twitterText: string}): Promise<string> {
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

function createSharingButtons(promoText: string, firebaseImageUrl?: string): InlineKeyboard {
  // Store promo message with short ID for sharing
  const messageId = `msg${messageIdCounter++}`;
  promoMessages[messageId] = promoText;
  
  // Store Firebase image URL if available
  if (firebaseImageUrl) {
    firebaseImageUrls[messageId] = firebaseImageUrl;
  }
  
  return new InlineKeyboard()
    .text('🫂 Поделиться в Telegram', `share_tg:${messageId}`)
    .row()
    .text('🐦 Поделиться в Twitter', `share_twitter:${messageId}`);
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
    await ctx.reply(promo, { parse_mode: "Markdown" });
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

    // Upload image to Firebase for Twitter sharing (if sharing enabled)
    let firebaseImageUrl: string | undefined;
    if (promoMessage) {
      try {
        const filename = `pepe_${Date.now()}_${Math.random().toString(36).substring(2)}.jpg`;
        firebaseImageUrl = await uploadImageToFirebase(Buffer.from(imageBuffer), filename);
        log(`🔥 Image uploaded to Firebase: ${firebaseImageUrl}`);
      } catch (error) {
        log(`❌ Firebase upload failed: ${error}`);
        // Continue without Firebase - sharing will work but without image preview
      }
    }

    // Create sharing buttons with Firebase URL
    const sharingButtons = promoMessage ? createSharingButtons(promoMessage, firebaseImageUrl) : undefined;
    
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
  
  if (data.startsWith("share_tg:")) {
    // Extract message ID for Telegram sharing
    const messageId = data.split("share_tg:")[1];
    const promoMessage = promoMessages[messageId];
    
    if (promoMessage) {
      // Award 1 point for Telegram sharing
      const totalPoints = addPoints(userId, 1);
      
      await ctx.answerCallbackQuery({
        text: `+1 очко! У вас ${totalPoints} очков. Просто перепошлите это сообщение!`,
        show_alert: true
      });
      
      // Send instruction message
      await ctx.reply(
        `📤 **Поделиться в Telegram:**\n\nПросто перепошлите сообщение с картинкой выше ↑ в любую группу или чат!\n\nℹ️ *Нажмите и удерживайте сообщение с картинкой, затем выберите "Перепослать"*`,
        {
          parse_mode: "Markdown",
          reply_to_message_id: ctx.callbackQuery.message?.message_id
        }
      );
      
      log(`User ${userName} (${userId}) earned 1 point for TG sharing. Total: ${totalPoints}`);
    } else {
      await ctx.answerCallbackQuery({
        text: "Сообщение не найдено",
        show_alert: true
      });
    }
    
  } else if (data.startsWith("share_twitter:")) {
    // Extract message ID and get promo message for Twitter sharing
    const messageId = data.split("share_twitter:")[1];
    const promoMessage = promoMessages[messageId];
    const firebaseImageUrl = firebaseImageUrls[messageId];
    
    if (promoMessage) {
      // Create Twitter version of the message
      const twitterVersion = promoMessage
        .replace(/💬 \[Telegram\]\(https:\/\/t\.me\/pepemp3\) • 🐦 \[X\/Twitter\]\(https:\/\/x\.com\/pepegotavoice\)/, '@PEPEGOTAVOICE')
        .replace(/\n\n💬.*$/, '\n\n@PEPEGOTAVOICE');
      
      await ctx.answerCallbackQuery({
        text: "Создаю Twitter Card с изображением...",
        show_alert: false
      });
      
      let twitterUrl: string;
      let instructions: string;
      
      if (firebaseImageUrl) {
        // Create Twitter Card URL with image preview
        const shareData = {
          imageUrl: firebaseImageUrl,
          title: "🐸 AI Generated Pepe",
          description: twitterVersion,
          twitterText: twitterVersion
        };
        
        // Create share card (would call our Firebase web service)
        const cardUrl = await createTwitterCard(shareData);
        twitterUrl = `https://twitter.com/intent/tweet?url=${encodeURIComponent(cardUrl)}`;
        
        instructions = `🐦 **Поделиться в Twitter с изображением:**\n\n✨ **Ваша ссылка с превью изображения готова!**\n\n1. [🔗 Открыть Twitter и опубликовать](${twitterUrl})\n2. Twitter автоматически покажет изображение в посте\n3. После публикации нажмите кнопку ниже\n\n🎯 *Теперь ваш пост будет с красивым превью Pepe!*`;
      } else {
        // Fallback to text-only sharing
        const twitterText = encodeURIComponent(twitterVersion);
        twitterUrl = `https://twitter.com/intent/tweet?text=${twitterText}`;
        
        instructions = `🐦 **Поделиться в Twitter:**\n\n📝 **Текстовый пост готов!**\n\n1. [Открыть Twitter и опубликовать](${twitterUrl})\n2. После публикации нажмите кнопку ниже\n\n💡 *Изображение не удалось загрузить, но текст готов к публикации*`;
      }
      
      // Send follow-up with Twitter link and confirmation button
      await ctx.reply(instructions, {
        parse_mode: "Markdown",
        reply_markup: new InlineKeyboard()
          .text('✅ Подтвердить публикацию (+2 балла)', 'twitter_confirmed'),
        reply_to_message_id: ctx.callbackQuery.message?.message_id
      });
      
      log(`User ${userName} (${userId}) requested Twitter sharing for message ${messageId}`);
    } else {
      await ctx.answerCallbackQuery({
        text: "Сообщение не найдено",
        show_alert: true
      });
    }
    
  } else if (data === "twitter_confirmed") {
    // Award 2 points when user confirms Twitter sharing
    const totalPoints = addPoints(userId, 2);
    
    await ctx.answerCallbackQuery({
      text: `+2 очка! У вас теперь ${totalPoints} очков за публикацию в Twitter!`,
      show_alert: true
    });
    
    log(`User ${userName} (${userId}) earned 2 points for confirmed Twitter sharing. Total: ${totalPoints}`);
  }
});

// Handle inline queries (simplified - mainly for bot info)
bot.on("inline_query", async (ctx) => {
  const query = ctx.inlineQuery.query;
  
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