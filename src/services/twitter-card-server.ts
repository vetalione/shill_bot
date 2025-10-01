import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files
app.use('/public', express.static(path.join(__dirname, '../public')));

/**
 * Twitter Card endpoint
 * Creates dynamic Open Graph meta tags for Twitter sharing
 */
app.get('/twitter/:shareId', async (req, res) => {
  try {
    const { shareId } = req.params;
    
    // In a real app, you'd fetch share data from a database
    // For now, we'll decode the shareId to get the data
    const shareData = decodeShareId(shareId);
    
    if (!shareData) {
      return res.status(404).send('Share not found');
    }
    
    // Read HTML template
    const htmlPath = path.join(__dirname, '../public/twitter-card.html');
    let html = fs.readFileSync(htmlPath, 'utf-8');
    
    // Replace placeholders with actual data
    html = html
      .replace(/{{TITLE}}/g, shareData.title)
      .replace(/{{DESCRIPTION}}/g, shareData.description)
      .replace(/{{IMAGE_URL}}/g, shareData.imageUrl)
      .replace(/{{PAGE_URL}}/g, `${req.protocol}://${req.get('host')}${req.originalUrl}`)
      .replace(/{{ENCODED_TEXT}}/g, encodeURIComponent(shareData.twitterText));
    
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
    
  } catch (error) {
    console.error('Error serving Twitter card:', error);
    res.status(500).send('Internal server error');
  }
});

/**
 * API endpoint to create share links
 */
app.post('/api/create-share', express.json(), (req, res) => {
  try {
    const { imageUrl, title, description, twitterText } = req.body;
    
    if (!imageUrl || !twitterText) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    // Create encoded share ID (in production, store in database)
    const shareData = { imageUrl, title, description, twitterText };
    const shareId = encodeShareData(shareData);
    
    const shareUrl = `${req.protocol}://${req.get('host')}/twitter/${shareId}`;
    
    res.json({ 
      shareUrl,
      shareId,
      twitterUrl: `https://twitter.com/intent/tweet?url=${encodeURIComponent(shareUrl)}`
    });
    
  } catch (error) {
    console.error('Error creating share:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * Encode share data into a URL-safe string
 */
function encodeShareData(data: any): string {
  const json = JSON.stringify(data);
  const base64 = Buffer.from(json).toString('base64');
  return base64.replace(/[+/=]/g, (char) => {
    return { '+': '-', '/': '_', '=': '' }[char] || char;
  });
}

/**
 * Decode share ID back to data
 */
function decodeShareId(shareId: string): any {
  try {
    const base64 = shareId.replace(/[-_]/g, (char) => {
      return { '-': '+', '_': '/' }[char] || char;
    });
    
    // Add padding if needed
    const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
    const json = Buffer.from(padded, 'base64').toString('utf-8');
    return JSON.parse(json);
    
  } catch (error) {
    console.error('Error decoding share ID:', error);
    return null;
  }
}

// Start server
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`🔥 Firebase Twitter Card server running on port ${PORT}`);
    console.log(`📱 Health check: http://localhost:${PORT}/health`);
  });
}

export default app;