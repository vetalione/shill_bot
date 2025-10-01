import { Context } from "grammy";

// Type guards
export function isGroupChat(ctx: Context): boolean {
  return ctx.chat?.type === "group" || ctx.chat?.type === "supergroup";
}

export function isPrivateChat(ctx: Context): boolean {
  return ctx.chat?.type === "private";
}

// Extract bot mention from message
export function extractBotMention(text: string, botUsername: string): string | null {
  const mentionPattern = new RegExp(`@${botUsername}\\s+(.+)`, "i");
  const match = text.match(mentionPattern);
  return match ? match[1].trim() : null;
}

// Format error message
export function formatError(error: any): string {
  if (error?.message) return error.message;
  if (typeof error === "string") return error;
  return "Неизвестная ошибка";
}

// Format Gemini API error with policy violation detection
export function formatGeminiError(error: any): string {
  const errorMsg = error?.message || error?.toString() || "Unknown error";
  
  // Check for common Gemini policy violations
  if (errorMsg.toLowerCase().includes("safety") || 
      errorMsg.toLowerCase().includes("policy") ||
      errorMsg.toLowerCase().includes("harmful") ||
      errorMsg.toLowerCase().includes("inappropriate") ||
      errorMsg.toLowerCase().includes("blocked")) {
    
    return "🚫 Sorry, I can't generate this image due to Gemini's safety policies. The requested content might be:\n" +
           "• Inappropriate or harmful\n" +
           "• Against content guidelines\n" +
           "• Potentially unsafe\n\n" +
           "Please try a different, family-friendly prompt! 😊";
  }
  
  // Check for quota/rate limit errors
  if (errorMsg.toLowerCase().includes("quota") || 
      errorMsg.toLowerCase().includes("rate limit") ||
      errorMsg.toLowerCase().includes("too many requests")) {
    return "⏰ Too many requests! Please wait a moment and try again.";
  }
  
  // Check for API key issues
  if (errorMsg.toLowerCase().includes("api key") || 
      errorMsg.toLowerCase().includes("authentication") ||
      errorMsg.toLowerCase().includes("unauthorized")) {
    return "🔑 API configuration error. Please contact the bot administrator.";
  }
  
  // Generic Gemini error
  if (errorMsg.includes("Gemini")) {
    return `❌ Gemini API Error: ${errorMsg}`;
  }
  
  // Fallback for other errors
  return `❌ Error: ${errorMsg}`;
}

// Validate prompt
export function validatePrompt(prompt: string): { isValid: boolean; error?: string } {
  const trimmed = prompt.trim();
  
  if (!trimmed) {
    return { isValid: false, error: "Image description cannot be empty / Описание изображения не может быть пустым" };
  }
  
  if (trimmed.length < 3) {
    return { isValid: false, error: "Description too short (minimum 3 characters) / Описание слишком короткое (минимум 3 символа)" };
  }
  
  if (trimmed.length > 500) {
    return { isValid: false, error: "Description too long (maximum 500 characters) / Описание слишком длинное (максимум 500 символов)" };
  }
  
  return { isValid: true };
}

// Log function with timestamp
export function log(message: string, level: "info" | "warn" | "error" = "info") {
  const timestamp = new Date().toISOString();
  const emoji = level === "error" ? "❌" : level === "warn" ? "⚠️" : "ℹ️";
  console.log(`${timestamp} ${emoji} ${message}`);
}