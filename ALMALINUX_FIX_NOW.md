# ⚡ ALMALINUX FIX - DO THIS NOW!

Your VPS is **AlmaLinux**, not Ubuntu. The original scripts don't work.

---

## 🎯 IMMEDIATE ACTION REQUIRED

### ✅ NEW FILES CREATED FOR ALMALINUX

I've created **3 new files** specifically for AlmaLinux:

1. **`vps-deploy-almalinux.sh`** ⭐ - Automated setup script (THIS IS KEY!)
2. **`VPS_QUICK_REFERENCE_ALMALINUX.md`** - AlmaLinux commands
3. **`ALMALINUX_DEPLOYMENT.md`** - Complete AlmaLinux guide

---

## 🚀 FIX YOUR DEPLOYMENT - 3 STEPS

### STEP 1: You're Already SSH'd Into VPS ✅

You're at:
```
[root@123techgroup tmp]#
```

Good! Stay here.

---

### STEP 2: Download the AlmaLinux Script

**Copy and paste this command:**

```bash
curl -O https://raw.githubusercontent.com/YOUR_USERNAME/options-strategy-app/main/vps-deploy-almalinux.sh && chmod +x vps-deploy-almalinux.sh
```

**IMPORTANT:** Replace `YOUR_USERNAME` with your actual GitHub username!

**Example:**
```bash
curl -O https://raw.githubusercontent.com/rginvestor67/options-strategy-app/main/vps-deploy-almalinux.sh && chmod +x vps-deploy-almalinux.sh
```

---

### STEP 3: Run the Script

**Copy and paste:**

```bash
bash vps-deploy-almalinux.sh
```

**Expected output:**
```
🚀 AlmaLinux VPS Deployment Script
=====================================

📦 Step 1: Updating system...
✅ System updated

📦 Step 2: Installing Node.js 18+...
✅ Node.js installed: v18.x.x

📦 Step 3: Installing PostgreSQL 15...
✅ PostgreSQL installed

... (continues for ~10 minutes)

✅ ALL SERVICES INSTALLED SUCCESSFULLY!
```

---

## ✅ When That Completes

Once the script finishes with ✅, follow these steps:

### Create Database

```bash
sudo -u postgres /usr/pgsql-15/bin/psql

# Then type each line:
CREATE USER trading_user WITH PASSWORD 'trading_password_123';
CREATE DATABASE trading_platform OWNER trading_user;
ALTER ROLE trading_user CREATEDB;
\q
```

### Then Follow This File

👉 **Open:** `VPS_QUICK_REFERENCE_ALMALINUX.md`

👉 **Start from:** STEP 5: Clone Application from GitHub

---

## 🔑 Key Differences (AlmaLinux vs Ubuntu)

| What | Ubuntu | AlmaLinux |
|------|--------|-----------|
| Package install | `apt install` | `yum install` |
| PostgreSQL service | `postgresql` | `postgresql-15` |
| Connect to PostgreSQL | `psql -U user` | `/usr/pgsql-15/bin/psql -U user` |
| Redis service | `redis-server` | `redis` |
| Update system | `apt update && apt upgrade` | `yum update` |

---

## 🎯 Complete Checklist

- [ ] On VPS? (You are at `[root@...tmp]#`)
- [ ] Download AlmaLinux script with correct GitHub username
- [ ] Run `bash vps-deploy-almalinux.sh` (wait ~10 minutes)
- [ ] See ✅ **ALL SERVICES INSTALLED SUCCESSFULLY**
- [ ] Create database with PostgreSQL commands
- [ ] Continue with `VPS_QUICK_REFERENCE_ALMALINUX.md` Step 5

---

## 📂 Files to Use on AlmaLinux

**USE THESE:**
- ✅ `vps-deploy-almalinux.sh`
- ✅ `VPS_QUICK_REFERENCE_ALMALINUX.md`
- ✅ `ALMALINUX_DEPLOYMENT.md`
- ✅ `ecosystem.config.js` (same for all OS)

**DON'T USE THESE:**
- ❌ `vps-deploy.sh` (Ubuntu only)
- ❌ `VPS_QUICK_REFERENCE.md` (Ubuntu commands)
- ❌ `VPS_DEPLOYMENT.md` (uses `apt-get`)

---

## 💡 Example Commands for AlmaLinux

```bash
# ✅ Check PostgreSQL (AlmaLinux)
/usr/pgsql-15/bin/psql -U trading_user -d trading_platform -c "SELECT 1;"

# ✅ Start/stop services (AlmaLinux)
systemctl start postgresql-15
systemctl start redis
systemctl start nginx

# ✅ Check status
systemctl status postgresql-15
systemctl is-active redis

# ✅ View logs
tail -f /var/log/nginx/error.log
tail -f /var/log/redis/redis.log
```

---

## 🆘 If Download Fails

**If you see 404 error:**

1. Make sure you replaced `YOUR_USERNAME` with your actual GitHub username
2. Make sure your code is already pushed to GitHub
3. If not pushed yet, do this on your local computer:

```bash
cd "C:\Claude Projects\Options Strategy App"
./push-to-github.bat
```

Then wait a few seconds and try downloading from VPS again.

---

## 🚀 Next Command (Right Now!)

**Run this on your VPS:**

```bash
curl -O https://raw.githubusercontent.com/YOUR_USERNAME/options-strategy-app/main/vps-deploy-almalinux.sh && chmod +x vps-deploy-almalinux.sh && bash vps-deploy-almalinux.sh
```

(Replace `YOUR_USERNAME` with your GitHub username!)

---

## 📞 Need Help?

See [ALMALINUX_DEPLOYMENT.md](ALMALINUX_DEPLOYMENT.md) for detailed troubleshooting.

---

**Good luck! You've got this! 🚀**

