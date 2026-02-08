#!/bin/bash
# PlexGuard Setup Script

set -e

echo "🎬 PlexGuard Setup"
echo "==================="
echo ""

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed"
    exit 1
fi

if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose is not installed"
    exit 1
fi

# Check if .env.local exists
if [ ! -f .env.local ]; then
    echo "⚠️  .env.local not found. Creating from example..."
    cp .env.example .env.local
    echo ""
    echo "📝 IMPORTANT: Edit .env.local and add:"
    echo "   - Your Plex admin token"
    echo "   - A random secret for NEXTAUTH_SECRET"
    echo "   - Your domain (plexguard.williamrdodd.com)"
    echo ""
    exit 1
fi

# Check if required vars are set
if grep -q "your_plex_admin_token_here" .env.local || grep -q "your_random_secret_here" .env.local; then
    echo "⚠️  Please update .env.local with your actual values"
    exit 1
fi

echo "✅ Environment configured"
echo ""

# Create data directory
mkdir -p data

# Build and start
echo "🔨 Building PlexGuard..."
docker-compose build --no-cache

echo ""
echo "🚀 Starting PlexGuard..."
docker-compose up -d

echo ""
echo "✅ PlexGuard is running!"
echo ""
echo "📱 Access the app at:"
echo "   Local: http://localhost:4600"
echo "   Domain: https://plexguard.williamrdodd.com (if configured)"
echo ""
echo "📝 First-time setup:"
echo "   1. Get your Plex admin token:"
echo "      https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/"
echo "   2. Sign in with your Plex token"
echo "   3. Configure users and restriction rules"
echo ""
echo "🪵 View logs: docker-compose logs -f"
echo "🛑 Stop: docker-compose down"
