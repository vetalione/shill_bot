"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.twitterCard = void 0;
const https_1 = require("firebase-functions/v2/https");
// Twitter Card generator endpoint
exports.twitterCard = (0, https_1.onRequest)((request, response) => {
    const { imageUrl, title, description, messageId } = request.query;
    // If messageId provided, construct imageUrl from Firebase Storage pattern
    let finalImageUrl = imageUrl;
    if (messageId && !imageUrl) {
        // This is a simplified approach - in production you'd want to store this mapping
        finalImageUrl = `https://firebasestorage.googleapis.com/v0/b/pepe-shillbot.firebasestorage.app/o/temp-images%2Fpepe_${messageId}.jpg?alt=media`;
    }
    if (!finalImageUrl) {
        response.status(400).send("Missing imageUrl or messageId parameter");
        return;
    }
    const cardTitle = title || "AI-Generated Pepe Meme";
    const cardDescription = description || "Check out this AI-generated Pepe meme! Create your own with @PEPEGOTAVOICE";
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
    
    <!-- Open Graph meta tags -->
    <meta property="og:type" content="website">
    <meta property="og:title" content="${cardTitle}">
    <meta property="og:description" content="${cardDescription}">
    <meta property="og:image" content="${finalImageUrl}">
    <meta property="og:image:width" content="1024">
    <meta property="og:image:height" content="1024">
    <meta property="og:url" content="${request.url}">
    
    <style>
        body {
            font-family: Arial, sans-serif;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            text-align: center;
        }
        .card {
            background: rgba(255, 255, 255, 0.1);
            border-radius: 15px;
            padding: 30px;
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.2);
        }
        .pepe-image {
            max-width: 100%;
            height: auto;
            border-radius: 10px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
            margin: 20px 0;
        }
        .title {
            font-size: 2.5em;
            margin-bottom: 20px;
            text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.5);
        }
        .description {
            font-size: 1.2em;
            margin-bottom: 30px;
            line-height: 1.6;
        }
        .cta-button {
            display: inline-block;
            background: #1DA1F2;
            color: white;
            padding: 15px 30px;
            text-decoration: none;
            border-radius: 25px;
            font-weight: bold;
            font-size: 1.1em;
            transition: transform 0.3s ease;
        }
        .cta-button:hover {
            transform: translateY(-2px);
        }
        .footer {
            margin-top: 40px;
            opacity: 0.8;
        }
    </style>
</head>
<body>
    <div class="card">
        <h1 class="title">🐸 $PEPE.MP3</h1>
        <img src="${finalImageUrl}" alt="${cardTitle}" class="pepe-image" onerror="this.style.display='none'" />
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
    response.set('Content-Type', 'text/html');
    response.set('Cache-Control', 'public, max-age=3600');
    response.send(html);
});
//# sourceMappingURL=index.js.map