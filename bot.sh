#!/bin/bash

# ShillBot Management Script

case "$1" in
  start)
    echo "🚀 Starting ShillBot..."
    npm start
    ;;
  dev)
    echo "🔧 Starting ShillBot in development mode..."
    npm run dev
    ;;
  build)
    echo "🏗️ Building ShillBot..."
    npm run build
    ;;
  stop)
    echo "🛑 Stopping ShillBot..."
    pkill -f "tsx.*src/index.ts" || pkill -f "node.*dist/index.js"
    echo "ShillBot stopped."
    ;;
  restart)
    echo "🔄 Restarting ShillBot..."
    $0 stop
    sleep 2
    $0 start
    ;;
  logs)
    echo "📋 Showing logs..."
    # If running with pm2 or similar, show logs
    # Otherwise, just show running processes
    ps aux | grep -E "(tsx.*src/index.ts|node.*dist/index.js)" | grep -v grep
    ;;
  *)
    echo "ShillBot Management Script"
    echo ""
    echo "Usage: $0 {start|dev|build|stop|restart|logs}"
    echo ""
    echo "Commands:"
    echo "  start   - Start the bot in production mode"
    echo "  dev     - Start the bot in development mode with auto-reload"
    echo "  build   - Build the TypeScript code"
    echo "  stop    - Stop the running bot"
    echo "  restart - Restart the bot"
    echo "  logs    - Show running bot processes"
    exit 1
esac