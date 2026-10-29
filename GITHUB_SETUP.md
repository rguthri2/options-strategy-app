# 📱 GitHub Setup Guide

Complete guide to push your Options Strategy App to GitHub and deploy from there.

## Step 1: Create GitHub Repository

1. Visit https://github.com/new
2. **Repository name:** `options-strategy-app`
3. **Description:** Real-time stock options trading platform
4. **Visibility:** Private (recommended for production)
5. Click **Create repository**

✅ Repository created!

---

## Step 2: Push Local Code to GitHub

### Option A: Using SSH (Recommended)

**Setup SSH Key (One-time):**

Windows PowerShell:
```powershell
# Generate SSH key
ssh-keygen -t ed25519 -C "your_email@example.com"

# View public key
Get-Content $env:USERPROFILE\.ssh\id_ed25519.pub
```

macOS/Linux:
```bash
ssh-keygen -t ed25519 -C "your_email@example.com"
cat ~/.ssh/id_ed25519.pub
```

**Add to GitHub:**
1. Visit https://github.com/settings/keys
2. Click **New SSH key**
3. Paste your public key
4. Click **Add SSH key**

**Push Code:**
```bash
cd "C:\Claude Projects\Options Strategy App"
git init
git add .
git commit -m "Initial commit - Options Strategy App"
git remote add origin git@github.com:YOUR_USERNAME/options-strategy-app.git
git branch -M main
git push -u origin main
```

### Option B: Using HTTPS (Easier if no SSH)

**Create Personal Access Token:**
1. Visit https://github.com/settings/tokens
2. Click **Generate new token (classic)**
3. Select: `repo` scope
4. Copy token

**Push Code:**
```bash
cd "C:\Claude Projects\Options Strategy App"
git init
git add .
git commit -m "Initial commit - Options Strategy App"
git remote add origin https://github.com/YOUR_USERNAME/options-strategy-app.git
git branch -M main
git push -u origin main

# When prompted for password, use your token
```

✅ Code on GitHub!

---

## Step 3: Prepare .gitignore

Create `.gitignore` at project root:

```
# Dependencies
node_modules/
package-lock.json
yarn.lock

# Environment
.env
.env.local
.env.*.local

# Logs
logs/
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Build
dist/
build/
.next/

# IDE
.vscode/
.idea/
*.swp
*.swo
*~
.DS_Store

# Testing
coverage/
.nyc_output/

# PM2
ecosystem-local.config.js
```

---

## Step 4: Create GitHub Secrets (Optional but Recommended)

If you want automated deployments later:

1. Go to: https://github.com/YOUR_USERNAME/options-strategy-app/settings/secrets/actions
2. Click **New repository secret**
3. Add secrets:
   - `FINNHUB_API_KEY` - Your Finnhub API key
   - `DB_PASSWORD` - Database password
   - `JWT_SECRET` - JWT signing secret

---

## Step 5: Verify on GitHub

1. Visit https://github.com/YOUR_USERNAME/options-strategy-app
2. Verify all files are there:
   - ✅ `backend/`
   - ✅ `frontend/`
   - ✅ `docs/`
   - ✅ `README.md`
   - ✅ All other files

---

## Step 6: Setup VPS Deployment from GitHub

### On VPS (ssh root@70.36.114.244):

```bash
# Create app directory
mkdir -p /var/www/options-strategy-app
cd /var/www/options-strategy-app

# Clone repository
git clone https://github.com/YOUR_USERNAME/options-strategy-app.git .

# Or if using SSH key:
git clone git@github.com:YOUR_USERNAME/options-strategy-app.git .
```

### Configure for Production:

```bash
# Backend setup
cd backend
cp .env.example .env

# Edit .env with production values
nano .env
```

**Production .env values:**
```
PORT=5000
NODE_ENV=production
DB_HOST=localhost
DB_PORT=5432
DB_USER=trading_user
DB_PASSWORD=your_secure_password
DB_NAME=trading_platform
FINNHUB_API_KEY=your_api_key
JWT_SECRET=generate_strong_random_string
REDIS_URL=redis://localhost:6379
FRONTEND_URL=https://optionstrategy.rginvestor67.com
```

### Install & Build:

```bash
# Install dependencies
npm install
npm run build

# Backend ready!
cd ../frontend
npm install
npm run build

# Frontend ready!
cd ..
```

### Start with PM2:

```bash
# Copy ecosystem config
cp ecosystem.config.js /var/www/options-strategy-app/

# Start services
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

✅ Application running on VPS!

---

## Step 7: Update Local Code Later

After making changes locally:

```bash
git add .
git commit -m "Feature: describe your changes"
git push origin main
```

**On VPS to pull updates:**

```bash
cd /var/www/options-strategy-app
git pull origin main
npm install  # If dependencies changed
npm run build
pm2 restart all
```

---

## 🔐 Security Best Practices

### 1. Never commit secrets:
```bash
# Good ✅
echo ".env" >> .gitignore

# Bad ❌
Don't push .env files to GitHub
```

### 2. Use GitHub Secrets for CI/CD:
- Store API keys in repository secrets
- Never put credentials in code

### 3. Keep dependencies updated:
```bash
npm audit
npm audit fix
npm update
```

### 4. Create branch protection:
1. Go to repository **Settings** → **Branches**
2. Add rule for `main` branch
3. Require PR reviews before merge

---

## 📊 Recommended GitHub Workflow

```
1. Create feature branch:
   git checkout -b feature/your-feature

2. Make changes and commit:
   git add .
   git commit -m "Feature: description"

3. Push to GitHub:
   git push origin feature/your-feature

4. Create Pull Request on GitHub

5. Review, test, and merge to main

6. Deploy to VPS:
   git pull origin main on VPS
   npm install (if needed)
   pm2 restart all
```

---

## 🚀 Automated Deployment (Optional)

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy to VPS

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      
      - name: Deploy to VPS
        uses: appleboy/ssh-action@master
        with:
          host: 70.36.114.244
          username: root
          key: ${{ secrets.VPS_SSH_KEY }}
          script: |
            cd /var/www/options-strategy-app
            git pull origin main
            cd backend
            npm install
            npm run build
            cd ../frontend
            npm install
            npm run build
            cd ..
            pm2 restart all
```

---

## 📞 Useful GitHub URLs

- Repository: https://github.com/YOUR_USERNAME/options-strategy-app
- Settings: https://github.com/YOUR_USERNAME/options-strategy-app/settings
- Actions: https://github.com/YOUR_USERNAME/options-strategy-app/actions
- Releases: https://github.com/YOUR_USERNAME/options-strategy-app/releases
- Issues: https://github.com/YOUR_USERNAME/options-strategy-app/issues

---

**Ready to push to GitHub? Let's go! 🚀**
