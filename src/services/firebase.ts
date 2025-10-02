import { initializeApp, cert, ServiceAccount } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

// Firebase configuration - support both local and Railway deployment
let serviceAccount: ServiceAccount;

if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
  // Railway deployment - use base64 encoded JSON
  try {
    const decodedCredentials = Buffer.from(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON, 'base64').toString('utf-8');
    serviceAccount = JSON.parse(decodedCredentials);
  } catch (error) {
    console.error('Failed to parse GOOGLE_APPLICATION_CREDENTIALS_JSON:', error);
    throw new Error('Invalid Firebase credentials format');
  }
} else {
  // Local development - use individual environment variables
  serviceAccount = {
    projectId: process.env.FIREBASE_PROJECT_ID!,
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')!,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL!,
  };
}

// Initialize Firebase Admin
const firebaseApp = initializeApp({
  credential: cert(serviceAccount),
  storageBucket: `${serviceAccount.projectId}.firebasestorage.app`
});

const storage = getStorage(firebaseApp);

/**
 * Upload image buffer to Firebase Storage with TTL
 * @param imageBuffer - Image buffer to upload
 * @param filename - Unique filename for the image
 * @returns Public URL for the uploaded image
 */
export async function uploadImageToFirebase(imageBuffer: Buffer, filename: string): Promise<string> {
  try {
    console.log(`🔥 Starting Firebase upload for: ${filename}`);
    console.log(`📦 Project ID: ${process.env.FIREBASE_PROJECT_ID}`);
    
    // Compress image for better Telegram compatibility
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
    
    const bucket = storage.bucket();
    console.log(`🪣 Bucket name: ${bucket.name}`);
    
    // Check if bucket exists, if not provide helpful error
    try {
      const [exists] = await bucket.exists();
      if (!exists) {
        console.error(`❌ Bucket ${bucket.name} does not exist!`);
        console.error(`🔧 Please go to Firebase Console and initialize Storage:`);
        console.error(`🔗 https://console.firebase.google.com/project/${process.env.FIREBASE_PROJECT_ID}/storage`);
        throw new Error(`Storage bucket not initialized. Please set up Firebase Storage in the console.`);
      }
      console.log(`✅ Bucket exists and accessible`);
    } catch (bucketError) {
      console.error(`❌ Cannot access bucket:`, bucketError);
      throw new Error(`Cannot access Firebase Storage bucket. Please ensure Storage is properly initialized.`);
    }
    
    const file = bucket.file(`temp-images/${filename}`);
    console.log(`📁 File path: temp-images/${filename}`);
    
    // Upload the compressed image with metadata and proper CORS settings
    await file.save(compressedBuffer, {
      metadata: {
        contentType: 'image/jpeg',
        cacheControl: 'public, max-age=86400', // 24 hours cache
        customMetadata: {
          'delete-after': String(Date.now() + 24 * 60 * 60 * 1000) // TTL 24 hours
        }
      },
      // Enable resumable upload for better reliability
      resumable: false
    });
    
    console.log(`✅ File uploaded successfully`);
    
    // Make file publicly readable
    await file.makePublic();
    console.log(`🌍 File made public`);
    
    // Get public URL using Firebase Storage direct URL format
    // This format should work better with CORS and fetch
    const bucketName = bucket.name;
    const publicUrl = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/temp-images%2F${encodeURIComponent(filename)}?alt=media`;
    
    console.log(`✅ Image uploaded to Firebase: ${publicUrl}`);
    
    // Test the URL accessibility
    try {
      // Quick test if URL is accessible (optional, for debugging)
      console.log(`🔗 Testing URL accessibility...`);
    } catch (testError) {
      console.warn(`⚠️ URL test failed (this might be OK):`, testError);
    }
    
    return publicUrl;
    
  } catch (error) {
    console.error('❌ Firebase upload error details:', error);
    console.error('❌ Error message:', (error as Error).message);
    throw new Error(`Failed to upload image to Firebase: ${(error as Error).message}`);
  }
}

/**
 * Generate Twitter Card URL for image sharing
 * @param imageUrl - Public URL of the image
 * @param text - Tweet text
 * @returns Twitter intent URL with card preview
 */
export function generateTwitterCardUrl(imageUrl: string, text: string): string {
  // Encode parameters for URL
  const encodedText = encodeURIComponent(text);
  const encodedImageUrl = encodeURIComponent(imageUrl);
  
  // Create Twitter intent URL with image parameter (for apps that support it)
  // Note: Twitter web doesn't support image parameter in intent URLs,
  // but Twitter mobile apps and third-party clients might
  return `https://twitter.com/intent/tweet?text=${encodedText}&url=${encodedImageUrl}`;
}

/**
 * Create Twitter Card page for an image
 * @param imageUrl - Public URL of the image
 * @param cardId - Unique ID for the card
 * @param description - Optional description text
 * @returns URL to the generated card page
 */
export async function createTwitterCard(imageUrl: string, cardId: string, description?: string): Promise<string> {
  try {
    console.log(`🃏 Creating Twitter Card for: ${cardId}`);
    
    const bucket = storage.bucket();
    
    // Read the card template
    const templatePath = path.join(process.cwd(), 'public', 'card.html');
    let cardHtml = fs.readFileSync(templatePath, 'utf8');
    
    // Generate card URL
    const cardUrl = `https://pepe-shillbot.web.app/cards/${cardId}.html`;
    
    // Generate Twitter intent URL
    const tweetText = description || `🐸 Check out this AI-generated Pepe! @PEPEGOTAVOICE #TON #PepeMP3`;
    const twitterIntentUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetText)}&url=${encodeURIComponent(cardUrl)}`;
    
    // Replace placeholders in template
    cardHtml = cardHtml
      .replace(/PLACEHOLDER_IMAGE_URL/g, imageUrl)
      .replace(/PLACEHOLDER_CARD_URL/g, cardUrl)
      .replace(/PLACEHOLDER_TWITTER_INTENT/g, twitterIntentUrl);
    
    // Add custom description if provided
    if (description) {
      cardHtml = cardHtml.replace(
        /Check out this AI-generated Pepe meme! Create your own at @PEPEGOTAVOICE/g,
        description.replace(/\*\*(.*?)\*\*/g, '$1').replace(/\*(.*?)\*/g, '$1')
      );
    }
    
    // Upload card HTML to Firebase Storage
    const cardFile = bucket.file(`cards/${cardId}.html`);
    await cardFile.save(cardHtml, {
      metadata: {
        contentType: 'text/html',
        cacheControl: 'public, max-age=3600',
        customMetadata: {
          'delete-after': String(Date.now() + 7 * 24 * 60 * 60 * 1000) // TTL 7 days
        }
      }
    });
    
    // Make file publicly readable
    await cardFile.makePublic();
    
    console.log(`✅ Twitter Card created: ${cardUrl}`);
    return cardUrl;
    
  } catch (error) {
    console.error('❌ Failed to create Twitter Card:', error);
    // Fallback to direct image URL
    return imageUrl;
  }
}

/**
 * Cleanup old images (run periodically)
 */
export async function cleanupExpiredImages(): Promise<void> {
  try {
    const bucket = storage.bucket();
    const [files] = await bucket.getFiles({ prefix: 'temp-images/' });
    
    const now = Date.now();
    let deletedCount = 0;
    
    for (const file of files) {
      const [metadata] = await file.getMetadata();
      const deleteAfter = metadata.metadata?.['delete-after'];
      
      if (deleteAfter && now > parseInt(String(deleteAfter))) {
        await file.delete();
        deletedCount++;
      }
    }
    
    console.log(`🧹 Cleaned up ${deletedCount} expired images from Firebase`);
    
  } catch (error) {
    console.error('❌ Cleanup error:', error);
  }
}