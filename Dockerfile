# Railway deployment config - v2
FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev deps for tsx)
RUN npm ci

# Copy source code
COPY . .

# Start the bot directly with tsx (no build needed)
CMD ["npm", "start"]