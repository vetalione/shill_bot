/// <reference types="node" />

const IMAGE_MODEL_ID = "gemini-2.5-flash-image-preview";
const TEXT_MODEL_ID = "gemini-2.0-flash-exp";
const IMAGE_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${IMAGE_MODEL_ID}:generateContent`;
const TEXT_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${TEXT_MODEL_ID}:generateContent`;

export async function generateGeminiImage({ prompt }: { prompt: string }): Promise<Uint8Array | null> {
  const apiKey = process.env.GEMINI_API_KEY as string | undefined;
  if (!apiKey) throw new Error("GEMINI_API_KEY not set");

  const payload = {
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }]
      }
    ]
  };

  const headers = {
    "x-goog-api-key": apiKey,
    "Content-Type": "application/json",
  };

  const resp = await fetch(IMAGE_API_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const errorText = await resp.text();
    throw new Error(`Gemini HTTP ${resp.status}: ${errorText}`);
  }

  const data = await resp.json();
  
  try {
    const parts = data.candidates[0].content.parts;
    for (const part of parts) {
      // Check for inline_data or inlineData (both formats possible)
      const inline = part.inline_data || part.inlineData;
      if (inline?.data) {
        const b64 = inline.data as string;
        return Uint8Array.from(Buffer.from(b64, "base64"));
      }
    }
  } catch (error) {
    console.error("Error parsing Gemini response:", error);
    console.log("Full response:", JSON.stringify(data, null, 2));
  }
  
  return null;
}

// Promo message generation function with forced randomization
export async function generatePromoMessage(language: 'ru' | 'en' = 'en'): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY as string | undefined;
  if (!apiKey) throw new Error("GEMINI_API_KEY not set");

  // Force randomization by selecting narrative beforehand in JavaScript
  const narratives = [
    "TRADING_STATS", "LOCKED_SUPPLY", "MINI_APP", "AI_AGENT", "AI_PODCAST", 
    "AMBASSADOR", "KOL_TRACTION", "PEPE_SIMILARITY", "TON_TREND", 
    "BIBLE_VIBE", "ROADMAP", "MEME_CULTURE"
  ] as const;
  
  type NarrativeType = typeof narratives[number];
  
  const randomNarrative = narratives[Math.floor(Math.random() * narratives.length)];
  
  // Define prompts for each language
  const narrativePrompts: Record<'ru' | 'en', Record<NarrativeType, string>> = {
    ru: {
      TRADING_STATS: `Создай продающий промо-твит о торговой статистике $PEPE.MP3 на русском языке. Используй факты: $830K общий объём торгов, 5,189 транзакций, $220K исторический максимум капитализации, 260 diamond holders, $236 средняя инвестиция на холдера. Стиль: уверенный, с конкретными цифрами, вызывающий доверие.`,
      
      LOCKED_SUPPLY: `Создай промо-твит о стратегии блокировки токенов $PEPE.MP3 на русском языке. Используй факты: 25% от общего количества заблокировано на 20 месяцев, команда выкупила 50% токенов за $20K после честного запуска, долгосрочная стратегия развития. Стиль: надёжность, стабильность, доверие к команде.`,
      
      MINI_APP: `Создай весёлый промо-твит о Telegram Mini App $PEPE.MP3 на русском языке. Используй фичи: голосовые пранки друзей, шифрование голоса в "язык лягушек", декодирование за токены, вирусная реферальная система. Стиль: игривый, интерактивный, молодёжный.`,
      
      AI_AGENT: `Создай промо-твит о Voice AI Agent $PEPE.MP3 на русском языке. Используй факты: протестирован 499 раз, 360 минут общения с пользователями, обучен на философии "Bible of Vibe", даёт эмоциональную поддержку. Стиль: инновационный, душевный, технологичный.`,
      
      AI_PODCAST: `Создай футуристичный промо-твит о планируемом AI Podcast $PEPE.MP3 на русском языке. Используй концепцию: два AI агента ведут диалоги, первый подкаст где искусственный интеллект обсуждает Web3, инновационный медиа-формат будущего. Стиль: передовой, экспериментальный.`,
      
      AMBASSADOR: `Создай вовлекающий промо-твит о программе амбассадоров $PEPE.MP3 на русском языке. Используй факты: 15 активных амбассадоров, 90 выполненных заданий, награды для участников сообщества, открытый набор в программу. Стиль: сообщество, участие, возможности.`,
      
      KOL_TRACTION: `Создай промо-твит о медийном влиянии $PEPE.MP3 на русском языке. Используй данные: 28% подписчиков - верифицированные инфлюенсеры, охват аудитории 2.41M человек, 50K просмотров в X, упоминания от ключевых лидеров мнений. Стиль: влиятельность, рост, признание.`,
      
      PEPE_SIMILARITY: `Создай промо-твит о преемственности $PEPE.MP3 с оригинальным $PEPE на русском языке. Используй идею: повторяет паттерн успеха $PEPE на Ethereum, сильный мемный нарратив, проверенная формула успеха, история повторяется на TON. Стиль: преемственность, потенциал роста.`,
      
      TON_TREND: `Создай трендовый промо-твит о позиционировании $PEPE.MP3 в экосистеме TON на русском языке. Используй факты: 900M пользователей TON, быстрорастущая мем-экосистема, мем-капитализация стремится к 100B, идеальный тайминг для входа. Стиль: трендовость, возможности, рост рынка.`,
      
      BIBLE_VIBE: `Создай философский промо-твит о ценностях $PEPE.MP3 на русском языке. Используй концепцию: "Bible of Vibe" как основополагающая философия проекта, культура поддержки и позитива, ценности сообщества, правильный вайб. Стиль: вдохновляющий, ценностный, философский.`,
      
      ROADMAP: `Создай амбициозный промо-твит о планах развития $PEPE.MP3 на русском языке. Используй планы: полная экосистема из Mini App, AI Agent и Podcast, будущие партнёрства и коллаборации, инновационное развитие продуктов. Стиль: перспективный, амбициозный, развитие.`,
      
      MEME_CULTURE: `Создай мемный промо-твит о культуре $PEPE.MP3 на русском языке. Используй идеи: аудио-мемы как новый тренд, культура лягушек в Web3, голосовые мемы, юмор и развлечения в криптопространстве. Стиль: весёлый, мемный, трендовый.`
    },
    en: {
      TRADING_STATS: `Create a convincing promo tweet about $PEPE.MP3 trading statistics in English. Use facts: $830K total trading volume, 5,189 transactions, $220K ATH market cap, 260 diamond holders, $236 average investment per holder. Style: confident with concrete numbers, trust-building.`,
      
      LOCKED_SUPPLY: `Create a promo tweet about $PEPE.MP3 token locking strategy in English. Use facts: 25% of total supply locked for 20 months, team bought 50% of tokens for $20K after fair launch, long-term development strategy. Style: reliability, stability, team trust.`,
      
      MINI_APP: `Create a fun promo tweet about $PEPE.MP3 Telegram Mini App in English. Use features: voice pranks for friends, voice encryption into "frog language", decoding with tokens, viral referral system. Style: playful, interactive, youthful.`,
      
      AI_AGENT: `Create a promo tweet about $PEPE.MP3 Voice AI Agent in English. Use facts: tested 499 times, 360 minutes of user conversations, trained on "Bible of Vibe" philosophy, provides emotional support. Style: innovative, soulful, tech-forward.`,
      
      AI_PODCAST: `Create a futuristic promo tweet about planned $PEPE.MP3 AI Podcast in English. Use concept: two AI agents conducting dialogues, first podcast where artificial intelligence discusses Web3, innovative future media format. Style: cutting-edge, experimental.`,
      
      AMBASSADOR: `Create an engaging promo tweet about $PEPE.MP3 ambassador program in English. Use facts: 15 active ambassadors, 90 completed tasks, community rewards, open program enrollment. Style: community-focused, participation, opportunities.`,
      
      KOL_TRACTION: `Create a promo tweet about $PEPE.MP3 media influence in English. Use data: 28% followers are verified influencers, 2.41M audience reach, 50K views on X, mentions from key opinion leaders. Style: influential, growth, recognition.`,
      
      PEPE_SIMILARITY: `Create a promo tweet about $PEPE.MP3 following original $PEPE success in English. Use idea: follows $PEPE on Ethereum success pattern, strong meme narrative, proven success formula, history repeating on TON. Style: legacy, growth potential.`,
      
      TON_TREND: `Create a trending promo tweet about $PEPE.MP3 positioning in TON ecosystem in English. Use facts: 900M TON users, rapidly growing meme ecosystem, meme cap approaching 100B, perfect entry timing. Style: trendy, opportunities, market growth.`,
      
      BIBLE_VIBE: `Create a philosophical promo tweet about $PEPE.MP3 values in English. Use concept: "Bible of Vibe" as foundational project philosophy, culture of support and positivity, community values, right vibe. Style: inspiring, value-driven, philosophical.`,
      
      ROADMAP: `Create an ambitious promo tweet about $PEPE.MP3 development plans in English. Use plans: complete ecosystem of Mini App, AI Agent and Podcast, future partnerships and collaborations, innovative product development. Style: forward-looking, ambitious, development-focused.`,
      
      MEME_CULTURE: `Create a meme promo tweet about $PEPE.MP3 culture in English. Use ideas: audio memes as new trend, frog culture in Web3, voice memes, humor and entertainment in crypto space. Style: fun, meme-worthy, trendy.`
    }
  };

  const PROMO_PROMPT = `${narrativePrompts[language][randomNarrative]}

ТРЕБОВАНИЯ:
- Максимум 240 символов (оставляем место для ссылок)
- Используй эмодзи и хештеги (#TON #PepeMP3 #MemeCoin)
- Добавь призыв к действию БЕЗ конкретных ссылок
- НЕ добавляй ссылки типа [ССЫЛКА], [СЮДА ССЫЛКУ] или подобные
- НЕ объясняй процесс, выдай только готовый твит
- Стиль: Web3 маркетинг, мемный но профессиональный
- Язык: ${language === 'ru' ? 'русский' : 'английский'}
- Естественность: звучи как нативный спикер, избегай переводных конструкций`;

  const payload = {
    contents: [
      {
        role: "user",
        parts: [{ text: PROMO_PROMPT }]
      }
    ]
  };

  const headers = {
    "x-goog-api-key": apiKey,
    "Content-Type": "application/json",
  };

  const resp = await fetch(TEXT_API_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const errorText = await resp.text();
    throw new Error(`Gemini HTTP ${resp.status}: ${errorText}`);
  }

  const data = await resp.json();
  
  try {
    const text = data.candidates[0].content.parts[0].text;
    const promoText = text.trim();
    
    // Add clickable links at the end of promo message (URLs are hidden)
    const linksText = `\n\n💬 [Telegram](https://t.me/pepemp3) • 🐦 [X/Twitter](https://x.com/pepegotavoice)`;
    
    return promoText + linksText;
  } catch (error) {
    console.error("Error parsing Gemini response:", error);
    throw new Error("Failed to parse promo message from Gemini response");
  }
}