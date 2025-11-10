# 🚀 Quick Start Guide - VM Deployment

This is a condensed version of the deployment guide for quick reference.

## Prerequisites
- Ubuntu 20.04+ VM with sudo access
- Domain name pointing to your server IP (optional but recommended)
- Open ports: 80, 443, 3000

## Quick Deployment (5 Steps)

### 1. Install Required Software (One Command)
```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash - && \
sudo apt update && \
sudo apt install -y nodejs nginx git && \
sudo npm install -g pm2
```

### 2. Setup Application
```bash
# Create directory
sudo mkdir -p /var/www/backend-sekolah
sudo chown -R $USER:$USER /var/www/backend-sekolah
cd /var/www/backend-sekolah

# Upload your code here (git clone or scp)
# Then:
npm install --production
```

### 3. Configure Environment
```bash
# Create .env file
nano .env
```

Paste this (update values):
```env
NODE_ENV=production
PORT=3000
DB_HOST=Libra.web.id
DB_USER=vldgkamz_luay
DB_PASSWORD=your_password
DB_NAME=vldgkamz_manajemensekolah
DB_PORT=3306
JWT_SECRET=change_this_to_secure_random_string
APP_URL=http://your-domain.com
```

### 4. Start with PM2
```bash
# Create logs directory
mkdir -p logs

# Start application
pm2 start ecosystem.config.js

# Save PM2 configuration
pm2 save

# Enable PM2 on boot
pm2 startup
# Run the command that PM2 shows you
```

### 5. Setup Nginx
```bash
# Create Nginx config
sudo nano /etc/nginx/sites-available/backend-sekolah
```

Copy the content from `nginx.conf.example` (update your-domain.com)

```bash
# Enable site
sudo ln -s /etc/nginx/sites-available/backend-sekolah /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

## Done! 🎉

Test your API:
```bash
curl http://your-domain.com
```

## Useful Commands

```bash
# Check status
pm2 status

# View logs
pm2 logs backend-sekolah

# Restart app
pm2 restart backend-sekolah

# Check Nginx
sudo systemctl status nginx

# View Nginx errors
sudo tail -f /var/log/nginx/error.log
```

## SSL (Optional but Recommended)

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com -d www.your-domain.com
```

## Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

## Update Deployment

When you need to update:
```bash
cd /var/www/backend-sekolah
git pull  # if using Git
npm install --production
pm2 restart backend-sekolah
```

Or use the provided script:
```bash
./deploy.sh
```

---

For detailed instructions, see **DEPLOYMENT_GUIDE.md**

