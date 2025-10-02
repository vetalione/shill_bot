import { onRequest } from "firebase-functions/v2/https";

// Twitter Card generator endpoint
export const twitterCard = onRequest((request, response) => {
  const { imageUrl, title, description, messageId } = request.query;

  // Construct image URL based on available parameters
  let finalImageUrl = imageUrl as string;
  
  // If messageId provided but no imageUrl, try to find recent Firebase upload
  if (messageId && !finalImageUrl) {
    // For messageId cases, the real imageUrl should be passed when available
    // This is a basic fallback scenario
    console.log(`Twitter Card requested for messageId: ${messageId}`);
    console.log(`imageUrl parameter: ${imageUrl}`);
  }

  const cardTitle = (title as string) || "AI-Generated Pepe Meme";
  let cardDescription = (description as string) || "Check out this AI-generated Pepe meme! Create your own with @PEPEGOTAVOICE";
  
  // If description is the default short one, use a more engaging description
  if (cardDescription.includes("Check out this AI-generated Pepe meme! @PEPEGOTAVOICE #PepeMP3")) {
    cardDescription = "🤖 AI-Generated Pepe Memes with $PEPE.MP3! Create hilarious crypto memes with advanced AI. Join the future of meme culture! #PepeMP3 #TON #MemeCoin";
  }

  // Use provided imageUrl or fallback to placeholder
  if (!finalImageUrl) {
    // Use a better placeholder image
    finalImageUrl = "https://firebasestorage.googleapis.com/v0/b/pepe-shillbot.firebasestorage.app/o/public%2Fpepe-placeholder.jpg?alt=media";
    console.log(`No image URL provided, using placeholder for messageId: ${messageId}`);
  } else {
    console.log(`Using provided image URL: ${finalImageUrl}`);
  }

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${cardTitle}</title>
    
    <!-- Twitter Card meta tags -->
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:site" content="@PEPEGOTAVOICE">
    <meta name="twitter:creator" content="@PEPEGOTAVOICE">
    <meta name="twitter:title" content="${cardTitle}">
    <meta name="twitter:description" content="${cardDescription}">
    <meta name="twitter:image" content="${finalImageUrl}">
    <meta name="twitter:image:alt" content="AI-Generated Pepe Meme">
    <meta name="twitter:image:width" content="1024">
    <meta name="twitter:image:height" content="1024">
    
    <!-- Open Graph meta tags -->
    <meta property="og:type" content="website">
    <meta property="og:title" content="${cardTitle}">
    <meta property="og:description" content="${cardDescription}">
    <meta property="og:image" content="${finalImageUrl}">
    <meta property="og:image:type" content="image/jpeg">
    <meta property="og:image:width" content="1024">
    <meta property="og:image:height" content="1024">
    <meta property="og:image:alt" content="AI-Generated Pepe Meme">
    <meta property="og:image:secure_url" content="${finalImageUrl}">
    <meta property="og:url" content="${request.url}">
    <meta property="og:site_name" content="PEPE.MP3 - AI Meme Generator">
    
    <!-- Additional meta tags -->
    <meta name="robots" content="index, follow">
    <meta name="author" content="PEPEGOTAVOICE">
    
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            text-align: center;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .card {
            background: rgba(255, 255, 255, 0.1);
            border-radius: 20px;
            padding: 40px;
            backdrop-filter: blur(15px);
            border: 1px solid rgba(255, 255, 255, 0.2);
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
        }
        .pepe-image {
            max-width: 100%;
            max-height: 400px;
            height: auto;
            border-radius: 15px;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
            margin: 20px 0;
            display: block;
            margin-left: auto;
            margin-right: auto;
        }
        .title {
            font-size: 2.8em;
            margin-bottom: 15px;
            text-shadow: 2px 2px 8px rgba(0, 0, 0, 0.6);
            font-weight: bold;
        }
        .description {
            font-size: 1.3em;
            margin-bottom: 35px;
            line-height: 1.7;
            opacity: 0.95;
        }
        .cta-button {
            display: inline-block;
            background: linear-gradient(45deg, #1DA1F2, #0d8bdb);
            color: white;
            padding: 18px 35px;
            text-decoration: none;
            border-radius: 30px;
            font-weight: bold;
            font-size: 1.2em;
            transition: all 0.3s ease;
            box-shadow: 0 5px 15px rgba(29, 161, 242, 0.4);
        }
        .cta-button:hover {
            transform: translateY(-3px);
            box-shadow: 0 8px 25px rgba(29, 161, 242, 0.6);
        }
        .footer {
            margin-top: 40px;
            opacity: 0.8;
            font-size: 0.9em;
        }
        @media (max-width: 600px) {
            .card { padding: 25px; }
            .title { font-size: 2.2em; }
            .description { font-size: 1.1em; }
        }
    </style>
</head>
<body>
    <div class="card">
        <h1 class="title">🐸 $PEPE.MP3</h1>
        ${finalImageUrl ? `<img src="${finalImageUrl}" alt="${cardTitle}" class="pepe-image" onerror="this.style.display='none'" />` : ''}
        <p class="description">${cardDescription}</p>
        <a href="https://t.me/pepemp3" class="cta-button">
            🎨 Create Your Own Pepe
        </a>
        <div class="footer">
            <p>AI-Generated Pepe Memes • @PEPEGOTAVOICE</p>
        </div>
    </div>
</body>
</html>
  `;

  response.set('Content-Type', 'text/html; charset=utf-8');
  response.set('Cache-Control', 'public, max-age=3600');
  response.send(html);
});