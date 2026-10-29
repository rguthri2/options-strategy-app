#!/bin/bash

# 🚀 Push to GitHub Script
# Run this BEFORE deploying to VPS

set -e

echo "📦 Options Strategy App - GitHub Push"
echo ""

# Check if git is initialized
if [ ! -d .git ]; then
    echo "❌ Not a git repository. Initializing..."
    git init
fi

# Get GitHub repo URL
read -p "Enter your GitHub repository URL (https://github.com/USERNAME/REPO.git): " REPO_URL

# Configure git if needed
if [ -z "$(git config user.email)" ]; then
    read -p "Enter git email: " GIT_EMAIL
    git config --global user.email "$GIT_EMAIL"
fi

if [ -z "$(git config user.name)" ]; then
    read -p "Enter git name: " GIT_NAME
    git config --global user.name "$GIT_NAME"
fi

# Add remote
echo "Adding remote origin..."
git remote remove origin 2>/dev/null || true
git remote add origin "$REPO_URL"

# Create .gitignore if it doesn't exist
if [ ! -f .gitignore ]; then
    echo "Creating .gitignore..."
    cat > .gitignore << 'EOF'
# Dependencies
node_modules/
package-lock.json
yarn.lock

# Environment variables
.env
.env.local
.env.*.local

# Logs
logs/
*.log
npm-debug.log*

# Build output
dist/
build/
.next/

# IDE
.vscode/
.idea/
*.swp
*.swo
*~

# OS
.DS_Store
Thumbs.db

# Testing
.nyc_output/
coverage/

# Misc
.cache/
.parcel-cache/
.eslintcache
EOF
fi

# Add all files
echo "Staging files..."
git add .

# Commit
read -p "Enter commit message (default: 'Initial commit - Options Strategy App'): " COMMIT_MSG
COMMIT_MSG=${COMMIT_MSG:-"Initial commit - Options Strategy App"}

echo "Committing..."
git commit -m "$COMMIT_MSG" || echo "Nothing to commit"

# Push to GitHub
echo "Pushing to GitHub..."
git branch -M main
git push -u origin main

echo ""
echo "✅ Successfully pushed to GitHub!"
echo "Repository: $REPO_URL"
echo ""
echo "Next steps on VPS:"
echo "1. ssh root@70.36.114.244"
echo "2. cd /var/www/options-strategy-app"
echo "3. git clone $REPO_URL ."
echo ""
