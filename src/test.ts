import { validatePrompt, extractBotMention, formatError } from "./utils.js";

// Test validation
console.log("🧪 Testing prompt validation:");
console.log(validatePrompt(""));  // Should be invalid
console.log(validatePrompt("hi"));  // Should be invalid (too short)
console.log(validatePrompt("красивый закат над морем"));  // Should be valid
console.log(validatePrompt("a".repeat(501)));  // Should be invalid (too long)

// Test bot mention extraction
console.log("\n🧪 Testing bot mention extraction:");
console.log(extractBotMention("@testbot привет", "testbot"));  // Should return "привет"
console.log(extractBotMention("@testbot красивый закат", "testbot"));  // Should return "красивый закат"
console.log(extractBotMention("просто текст", "testbot"));  // Should return null
console.log(extractBotMention("@otherbot текст", "testbot"));  // Should return null

// Test error formatting
console.log("\n🧪 Testing error formatting:");
console.log(formatError(new Error("Test error")));  // Should return "Test error"
console.log(formatError("String error"));  // Should return "String error"
console.log(formatError({ random: "object" }));  // Should return "Неизвестная ошибка"

console.log("\n✅ All tests completed!");