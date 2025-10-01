import { Bot, GrammyError, Context, InputFile, InlineKeyboard } from "grammy";
import "dotenv/config";
import { generateGeminiImage, generatePromoMessage } from "./providers/gemini.js";
import { isGroupChat, isPrivateChat, extractBotMention, validatePrompt, formatError, formatGeminiError, log } from "./utils.js";

// Simple in-memory storage for user points and promo messages (in production use database)
const userPoints: Record<string, number> = {};
const promoMessages: Record<string, string> = {};
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

function createSharingButtons(promoText: string): InlineKeyboard {
  // Store promo message with short ID for Telegram sharing
  const messageId = `msg${messageIdCounter++}`;
  promoMessages[messageId] = promoText;
  
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
• 🫂 Поделиться в Telegram: +1 балл
• 🐦 Поделиться в Twitter: +2 балла
• /leaderboard - таблица лидеров

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
  try {
    log(`Generating image for prompt: "${userPrompt}"`);

    // Detect language for promo generation
    const language = /[а-яё]/i.test(userPrompt) ? 'ru' : 'en';

    // Extract or assign mood
    let mood = extractMoodFromPrompt(userPrompt);
    if (!mood) {
      mood = getRandomMood();
    }

    // Create enhanced prompt with Pepe style and mood
    const enhancedPrompt = buildPepePrompt(userPrompt, mood);

    // Generate image and promo message in parallel
    const [imageBuffer, promoMessage] = await Promise.all([
      generateGeminiImage({ prompt: enhancedPrompt }),
      generatePromoMessage(language)
    ]);

    // Create sharing buttons
    const sharingButtons = promoMessage ? createSharingButtons(promoMessage) : undefined;

    // Check if image was generated successfully
    if (!imageBuffer) {
      throw new Error("Failed to generate image");
    }

    // Send image with promo message and sharing buttons
    await ctx.replyWithPhoto(new InputFile(imageBuffer), {
      caption: promoMessage,
      parse_mode: "Markdown",
      reply_to_message_id: replyToMessageId,
      reply_markup: sharingButtons
    });

    log(`Successfully generated image and promo for: "${userPrompt}"`);

  } catch (error) {
    log(`Error generating content: ${error}`, "error");
    
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
    // Extract message ID and get promo message for Telegram sharing
    const messageId = data.split("share_tg:")[1];
    const promoMessage = promoMessages[messageId];
    
    if (promoMessage) {
      // Award 1 point for Telegram sharing
      const totalPoints = addPoints(userId, 1);
      
      // Use switch_inline_query to open sharing menu
      await ctx.answerCallbackQuery({
        text: `+1 очко! У вас ${totalPoints} очков. Выберите чат для отправки!`,
        show_alert: false
      });
      
      // Send follow-up with inline share button
      await ctx.reply(
        `📤 Нажмите кнопку ниже, чтобы поделиться этим контентом в любом чате:`,
        {
          reply_markup: new InlineKeyboard()
            .switchInline('📤 Выбрать чат для отправки', `share_content_${messageId}`),
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
    
    if (promoMessage) {
      // Create Twitter version of the message
      const twitterVersion = promoMessage
        .replace(/💬 \[Telegram\]\(https:\/\/t\.me\/pepemp3\) • 🐦 \[X\/Twitter\]\(https:\/\/x\.com\/pepegotavoice\)/, '@PEPEGOTAVOICE')
        .replace(/\n\n💬.*$/, '\n\n@PEPEGOTAVOICE');
      
      const twitterText = encodeURIComponent(twitterVersion);
      const twitterUrl = `https://twitter.com/intent/tweet?text=${twitterText}`;
      
      await ctx.answerCallbackQuery({
        text: "Открываю Twitter для публикации...",
        show_alert: false
      });
      
      // Send follow-up with Twitter link and confirmation button
      await ctx.reply(
        `🐦 **Поделиться в Twitter:**\n\n1. [Открыть Twitter и опубликовать](${twitterUrl})\n2. После публикации нажмите кнопку ниже`,
        {
          parse_mode: "Markdown",
          reply_markup: new InlineKeyboard()
            .text('✅ Подтвердить публикацию (+2 балла)', 'twitter_confirmed'),
          reply_to_message_id: ctx.callbackQuery.message?.message_id
        }
      );
      
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

// Handle inline queries for sharing content
bot.on("inline_query", async (ctx) => {
  const query = ctx.inlineQuery.query;
  
  // Check if this is a sharing query
  if (query.startsWith("share_content_")) {
    const messageId = query.replace("share_content_", "");
    const promoMessage = promoMessages[messageId];
    
    if (promoMessage) {
      await ctx.answerInlineQuery([
        {
          type: "article",
          id: messageId,
          title: "🎉 Поделиться промо-сообщением $PEPE.MP3",
          description: "Нажмите, чтобы отправить промо-сообщение в этот чат",
          input_message_content: {
            message_text: promoMessage,
            parse_mode: "Markdown"
          }
        }
      ], {
        cache_time: 60, // Cache for 1 minute
        is_personal: true
      });
    } else {
      await ctx.answerInlineQuery([
        {
          type: "article", 
          id: "not_found",
          title: "❌ Сообщение не найдено",
          description: "Попробуйте сгенерировать новое изображение",
          input_message_content: {
            message_text: "Сообщение не найдено. Попробуйте сгенерировать новое изображение."
          }
        }
      ]);
    }
  } else {
    // Default inline query response
    await ctx.answerInlineQuery([
      {
        type: "article",
        id: "default",
        title: "🤖 ShillBot",
        description: "Отправьте запрос боту для генерации изображения Pepe",
        input_message_content: {
          message_text: "🤖 Используйте бота для генерации изображений Pepe с промо-сообщениями!"
        }
      }
    ]);
  }
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