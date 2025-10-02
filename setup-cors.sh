#!/bin/bash

echo "🔧 Setting up Firebase Storage CORS policy..."

# Apply CORS configuration to Firebase Storage bucket
gsutil cors set storage-cors.json gs://pepe-shillbot.firebasestorage.app

echo "✅ CORS policy applied to Firebase Storage bucket"
echo "🔗 Your bucket should now allow cross-origin requests from your web app"

# Test CORS policy
echo "🧪 Testing CORS policy..."
gsutil cors get gs://pepe-shillbot.firebasestorage.app