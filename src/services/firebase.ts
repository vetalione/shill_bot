import { initializeApp, cert, ServiceAccount } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';

// Firebase configuration
const serviceAccount: ServiceAccount = {
  projectId: process.env.FIREBASE_PROJECT_ID!,
  privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')!,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL!,
};

// Initialize Firebase Admin
const firebaseApp = initializeApp({
  credential: cert(serviceAccount),
  storageBucket: `${process.env.FIREBASE_PROJECT_ID}.appspot.com`
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
    const bucket = storage.bucket();
    const file = bucket.file(`temp-images/${filename}`);
    
    // Upload the image with metadata
    await file.save(imageBuffer, {
      metadata: {
        contentType: 'image/jpeg',
        cacheControl: 'public, max-age=86400', // 24 hours cache
        customMetadata: {
          'delete-after': String(Date.now() + 24 * 60 * 60 * 1000) // TTL 24 hours
        }
      },
      public: true, // Make publicly accessible
    });
    
    // Get public URL
    const [url] = await file.getSignedUrl({
      action: 'read',
      expires: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
    });
    
    console.log(`✅ Image uploaded to Firebase: ${filename}`);
    return url;
    
  } catch (error) {
    console.error('❌ Firebase upload error:', error);
    throw new Error('Failed to upload image to Firebase');
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