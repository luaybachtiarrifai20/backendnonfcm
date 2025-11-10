# 🚀 Deployment Guide - Backend Manajemen Sekolah

## Prerequisites on VM Server

Your VM server should have:
- Ubuntu 20.04+ or similar Linux distribution
- Root or sudo access
- At least 1GB RAM
- Open ports: 80 (HTTP), 443 (HTTPS), and your app port (e.g., 3000)

---

## Step 1: Server Initial Setup

### 1.1 Update System Packages
```bash
sudo apt update && sudo apt upgrade -y
```

### 1.2 Install Node.js (v18 LTS or higher)
```bash
# Install Node.js 18.x
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Verify installation
node --version
npm --version
```

### 1.3 Install Git
```bash
sudo apt install -y git
```

### 1.4 Install PM2 (Process Manager)
```bash
sudo npm install -g pm2
```

### 1.5 Install Nginx (Reverse Proxy)
```bash
sudo apt install -y nginx
```

---

## Step 2: Setup Application

### 2.1 Create Application Directory
```bash
# Create directory for your app
sudo mkdir -p /var/www/backend-sekolah
cd /var/www/backend-sekolah

# Set ownership
sudo chown -R $USER:$USER /var/www/backend-sekolah
```

### 2.2 Clone or Upload Your Code

**Option A: Using Git (Recommended)**
```bash
cd /var/www/backend-sekolah
git clone <your-repository-url> .
```

**Option B: Using SCP/SFTP**
```bash
# From your local machine:
scp -r /Users/yahyaalhasymi/Projects/backendmanajemensekolah/* user@your-server-ip:/var/www/backend-sekolah/
```

### 2.3 Install Dependencies
```bash
cd /var/www/backend-sekolah
npm install --production
```

---

## Step 3: Environment Configuration

### 3.1 Create Environment Variables File

Create `.env` file:
```bash
nano .env
```

Add the following content:
```env
# Server Configuration
NODE_ENV=production
PORT=3000

# Database Configuration
DB_HOST=Libra.web.id
DB_USER=vldgkamz_luay
DB_PASSWORD=libraayra20
DB_NAME=vldgkamz_manajemensekolah
DB_PORT=3306

# JWT Secret
JWT_SECRET=your_secure_jwt_secret_key_here_change_this

# Application URL
APP_URL=http://your-domain.com
```

**⚠️ IMPORTANT**: Change the JWT_SECRET to a secure random string!

### 3.2 Update index.js to Use Environment Variables

You should update your `index.js` to read from environment variables instead of hardcoded values. I'll create a separate file for this.

---

## Step 4: Setup PM2 Process Manager

### 4.1 Create PM2 Ecosystem File

Create `ecosystem.config.js`:
```bash
nano ecosystem.config.js
```

Add the following:
```javascript
module.exports = {
  apps: [{
    name: 'backend-sekolah',
    script: './index.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true
  }]
};
```

### 4.2 Create Logs Directory
```bash
mkdir -p /var/www/backend-sekolah/logs
```

### 4.3 Start Application with PM2
```bash
cd /var/www/backend-sekolah
pm2 start ecosystem.config.js

# Save PM2 configuration
pm2 save

# Setup PM2 to start on system boot
pm2 startup
# Follow the instructions from the output
```

### 4.4 Useful PM2 Commands
```bash
# Check application status
pm2 status

# View logs
pm2 logs backend-sekolah

# Restart application
pm2 restart backend-sekolah

# Stop application
pm2 stop backend-sekolah

# Monitor
pm2 monit
```

---

## Step 5: Setup Nginx Reverse Proxy

### 5.1 Create Nginx Configuration

```bash
sudo nano /etc/nginx/sites-available/backend-sekolah
```

Add the following configuration:
```nginx
server {
    listen 80;
    server_name your-domain.com www.your-domain.com;  # Replace with your domain

    # Increase upload size limit
    client_max_body_size 100M;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # Timeout settings
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # Optional: Serve static files directly (if any)
    location /uploads {
        alias /var/www/backend-sekolah/uploads;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
```

### 5.2 Enable the Site
```bash
# Create symbolic link
sudo ln -s /etc/nginx/sites-available/backend-sekolah /etc/nginx/sites-enabled/

# Test Nginx configuration
sudo nginx -t

# Restart Nginx
sudo systemctl restart nginx
```

### 5.3 Enable Nginx on Boot
```bash
sudo systemctl enable nginx
```

---

## Step 6: Setup SSL with Let's Encrypt (Optional but Recommended)

### 6.1 Install Certbot
```bash
sudo apt install -y certbot python3-certbot-nginx
```

### 6.2 Obtain SSL Certificate
```bash
sudo certbot --nginx -d your-domain.com -d www.your-domain.com
```

Follow the prompts. Certbot will automatically configure Nginx for HTTPS.

### 6.3 Auto-Renewal
Certbot automatically sets up a cron job for renewal. Test it:
```bash
sudo certbot renew --dry-run
```

---

## Step 7: Setup Firewall (UFW)

### 7.1 Configure Firewall
```bash
# Allow SSH (important! Don't lock yourself out)
sudo ufw allow OpenSSH

# Allow HTTP and HTTPS
sudo ufw allow 'Nginx Full'

# Enable firewall
sudo ufw enable

# Check status
sudo ufw status
```

---

## Step 8: Create Uploads Directory

If your application handles file uploads:
```bash
mkdir -p /var/www/backend-sekolah/uploads
chmod 755 /var/www/backend-sekolah/uploads
```

---

## Step 9: Database Setup

### 9.1 Verify Database Connection
Your application connects to an external database at `Libra.web.id`. Make sure:
- The database server allows connections from your VM's IP address
- The database credentials are correct
- The database and tables exist

### 9.2 Test Connection
```bash
# Install MySQL client
sudo apt install -y mysql-client

# Test connection
mysql -h Libra.web.id -u vldgkamz_luay -p vldgkamz_manajemensekolah
```

---

## Step 10: Post-Deployment Verification

### 10.1 Check Application Status
```bash
# Check PM2
pm2 status

# Check logs
pm2 logs backend-sekolah --lines 50

# Check if port is listening
sudo netstat -tulpn | grep :3000
```

### 10.2 Check Nginx Status
```bash
sudo systemctl status nginx
```

### 10.3 Test API Endpoint
```bash
# Test locally
curl http://localhost:3000

# Test through Nginx
curl http://your-domain.com
```

---

## Step 11: Monitoring and Maintenance

### 11.1 Setup Log Rotation
```bash
sudo nano /etc/logrotate.d/backend-sekolah
```

Add:
```
/var/www/backend-sekolah/logs/*.log {
    daily
    rotate 14
    compress
    delaycompress
    notifempty
    create 0640 www-data www-data
    sharedscripts
    postrotate
        pm2 reloadLogs
    endscript
}
```

### 11.2 Setup Monitoring
```bash
# Install PM2 monitoring
pm2 install pm2-logrotate

# Configure
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
```

---

## Common Issues and Solutions

### Issue 1: Port Already in Use
```bash
# Find process using port 3000
sudo lsof -i :3000

# Kill process
sudo kill -9 <PID>
```

### Issue 2: Permission Denied
```bash
# Fix ownership
sudo chown -R $USER:$USER /var/www/backend-sekolah
```

### Issue 3: Nginx 502 Bad Gateway
- Check if the app is running: `pm2 status`
- Check app logs: `pm2 logs`
- Verify port in Nginx config matches your app

### Issue 4: Database Connection Failed
- Check database credentials in `.env`
- Verify VM IP is whitelisted on database server
- Test connection manually with mysql client

---

## Quick Deployment Checklist

- [ ] Server updated and Node.js installed
- [ ] Application code uploaded
- [ ] Dependencies installed (`npm install`)
- [ ] `.env` file created with correct values
- [ ] PM2 started and saved
- [ ] PM2 startup configured
- [ ] Nginx configured and running
- [ ] Firewall configured
- [ ] SSL certificate installed (optional)
- [ ] Database connection verified
- [ ] Uploads directory created
- [ ] Application tested and working

---

## Updating Your Application

When you need to deploy updates:

```bash
# Navigate to app directory
cd /var/www/backend-sekolah

# Pull latest code (if using Git)
git pull origin main

# Install any new dependencies
npm install --production

# Restart application
pm2 restart backend-sekolah

# Check status
pm2 status
pm2 logs backend-sekolah --lines 20
```

---

## Backup Strategy

### Backup Script Example
Create `backup.sh`:
```bash
#!/bin/bash
BACKUP_DIR="/var/backups/backend-sekolah"
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p $BACKUP_DIR

# Backup application files
tar -czf $BACKUP_DIR/app_$DATE.tar.gz /var/www/backend-sekolah \
    --exclude=node_modules \
    --exclude=logs

# Keep only last 7 backups
cd $BACKUP_DIR
ls -t | tail -n +8 | xargs rm -f
```

Make it executable and add to cron:
```bash
chmod +x backup.sh
crontab -e
# Add: 0 2 * * * /path/to/backup.sh
```

---

## Security Best Practices

1. **Change default passwords and secrets**
   - Update JWT_SECRET
   - Use strong database passwords

2. **Keep system updated**
   ```bash
   sudo apt update && sudo apt upgrade -y
   ```

3. **Use SSH keys instead of passwords**

4. **Setup fail2ban**
   ```bash
   sudo apt install -y fail2ban
   sudo systemctl enable fail2ban
   ```

5. **Regular backups**

6. **Monitor logs regularly**
   ```bash
   pm2 logs
   sudo tail -f /var/log/nginx/error.log
   ```

---

## Support and Troubleshooting

If you encounter issues:
1. Check PM2 logs: `pm2 logs backend-sekolah`
2. Check Nginx error logs: `sudo tail -f /var/log/nginx/error.log`
3. Check system logs: `sudo journalctl -xe`
4. Verify all services are running: `pm2 status && sudo systemctl status nginx`

---

## Additional Resources

- [PM2 Documentation](https://pm2.keymetrics.io/docs/usage/quick-start/)
- [Nginx Documentation](https://nginx.org/en/docs/)
- [Let's Encrypt Documentation](https://letsencrypt.org/docs/)
- [Node.js Best Practices](https://github.com/goldbergyoni/nodebestpractices)

---

**Good luck with your deployment! 🚀**

