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
  storageBucket: `${process.env.FIREBASE_PROJECT_ID}.firebasestorage.app`
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
    
    // Upload the image with metadata
    await file.save(imageBuffer, {
      metadata: {
        contentType: 'image/jpeg',
        cacheControl: 'public, max-age=86400', // 24 hours cache
        customMetadata: {
          'delete-after': String(Date.now() + 24 * 60 * 60 * 1000) // TTL 24 hours
        }
      },
    });
    
    console.log(`✅ File uploaded successfully`);
    
    // Make file publicly readable
    await file.makePublic();
    console.log(`🌍 File made public`);
    
    // Get public URL (simple version)
    const publicUrl = `https://storage.googleapis.com/${bucket.name}/temp-images/${filename}`;
    
    console.log(`✅ Image uploaded to Firebase: ${publicUrl}`);
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