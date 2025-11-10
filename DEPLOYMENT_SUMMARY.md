# 📦 Deployment Package Summary

This package includes everything you need to deploy your Backend Manajemen Sekolah to a VM server.

## 📄 Files Included

### Documentation
| File | Description |
|------|-------------|
| `README.md` | Main project documentation with overview, features, and API endpoints |
| `DEPLOYMENT_GUIDE.md` | Complete step-by-step deployment guide (comprehensive) |
| `QUICK_START.md` | Condensed deployment guide for quick reference |
| `DEPLOYMENT_SUMMARY.md` | This file - overview of deployment package |

### Configuration Files
| File | Description |
|------|-------------|
| `ecosystem.config.js` | PM2 process manager configuration |
| `nginx.conf.example` | Nginx reverse proxy configuration template |
| `.env.example` | Environment variables template |
| `.gitignore` | Git ignore rules |
| `vercel.json` | Vercel deployment configuration (alternative) |

### Scripts
| File | Description |
|------|-------------|
| `server-setup.sh` | Automated server setup script (run first) |
| `deploy.sh` | Application deployment/update script |

### Application Files
| File | Description |
|------|-------------|
| `index.js` | Main application file (3482 lines) |
| `package.json` | Node.js dependencies and scripts |

## 🎯 Deployment Options

### Option 1: Traditional VM/VPS (Recommended)
Best for: Full control, custom domain, SSL, production use

**Quick Path:**
1. Run `server-setup.sh` on your VM
2. Upload application files
3. Configure `.env` file
4. Start with PM2
5. Configure Nginx

**Guides:** See `DEPLOYMENT_GUIDE.md` or `QUICK_START.md`

### Option 2: Vercel Serverless
Best for: Quick deployment, automatic scaling

```bash
npm i -g vercel
vercel --prod
```

**Note:** Ensure database allows external connections

## 🚀 Quick Deployment Steps

### For Complete Beginners (Step-by-Step)
Follow **DEPLOYMENT_GUIDE.md** - includes:
- Prerequisites installation
- Server configuration
- Application setup
- Security best practices
- Troubleshooting
- Monitoring setup

**Time Required:** 30-45 minutes

### For Experienced Users (Fast Track)
Follow **QUICK_START.md** - includes:
- One-line installations
- Essential configurations
- Quick commands

**Time Required:** 10-15 minutes

## 📋 Pre-Deployment Checklist

Before starting deployment:

- [ ] VM/VPS server ready with Ubuntu 20.04+
- [ ] SSH access to server configured
- [ ] Domain name (optional but recommended)
- [ ] Database credentials handy
- [ ] Database allows remote connections
- [ ] Database tables created
- [ ] Generated secure JWT secret

## 🛠️ What Gets Installed

The deployment sets up:

1. **Node.js 18.x** - JavaScript runtime
2. **PM2** - Process manager for Node.js
3. **Nginx** - Reverse proxy and web server
4. **Git** - Version control
5. **MySQL Client** - Database connection testing
6. **Certbot** - SSL certificates (optional)
7. **UFW Firewall** - Security

## 📁 Server Directory Structure

After deployment:
```
/var/www/backend-sekolah/
├── index.js              # Main app
├── package.json
├── ecosystem.config.js
├── .env                  # Your config (create this)
├── node_modules/         # Dependencies
├── logs/                 # Application logs
│   ├── err.log
│   ├── out.log
│   └── combined.log
└── uploads/              # File uploads
```

## 🔐 Security Considerations

### Must Do (Critical):
- ✅ Change JWT_SECRET to a strong random string
- ✅ Use strong database passwords
- ✅ Setup firewall (UFW)
- ✅ Keep system updated
- ✅ Use HTTPS/SSL in production

### Recommended:
- ✅ Use SSH keys instead of passwords
- ✅ Install fail2ban
- ✅ Setup regular backups
- ✅ Monitor logs regularly
- ✅ Implement rate limiting

### In Your .env File:
```env
# ⚠️ CHANGE THESE VALUES!
JWT_SECRET=use_at_least_32_character_random_string_here
DB_PASSWORD=use_strong_password_here
```

Generate secure secret:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## 🔄 Update Process

When you need to update your application:

### Automated (Recommended):
```bash
cd /var/www/backend-sekolah
./deploy.sh
```

### Manual:
```bash
cd /var/www/backend-sekolah
git pull origin main
npm install --production
pm2 restart backend-sekolah
```

## 📊 Monitoring

### Check Application Status:
```bash
pm2 status
pm2 logs backend-sekolah
pm2 monit
```

### Check Server:
```bash
sudo systemctl status nginx
sudo netstat -tulpn | grep :3000
htop
```

### Check Logs:
```bash
# Application logs
pm2 logs backend-sekolah --lines 100

# Nginx access logs
sudo tail -f /var/log/nginx/access.log

# Nginx error logs
sudo tail -f /var/log/nginx/error.log

# System logs
sudo journalctl -xe
```

## 🆘 Common Issues & Solutions

### Issue: "Cannot connect to database"
**Solution:**
- Verify database credentials in `.env`
- Check if database allows connections from your server IP
- Test connection: `mysql -h HOST -u USER -p DATABASE`

### Issue: "Port 3000 already in use"
**Solution:**
```bash
sudo lsof -i :3000
sudo kill -9 <PID>
pm2 restart backend-sekolah
```

### Issue: "502 Bad Gateway"
**Solution:**
```bash
pm2 status  # Check if app is running
pm2 logs    # Check for errors
pm2 restart backend-sekolah
sudo systemctl restart nginx
```

### Issue: "Permission denied"
**Solution:**
```bash
sudo chown -R $USER:$USER /var/www/backend-sekolah
chmod +x deploy.sh
```

## 🧪 Testing Deployment

After deployment, test these:

### 1. Application Running:
```bash
curl http://localhost:3000
```

### 2. Through Nginx:
```bash
curl http://your-domain.com
```

### 3. Database Connection:
```bash
mysql -h Libra.web.id -u vldgkamz_luay -p vldgkamz_manajemensekolah
```

### 4. API Endpoints:
```bash
# Test login endpoint
curl -X POST http://your-domain.com/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password"}'
```

## 📞 Getting Help

### Documentation Order:
1. **QUICK_START.md** - Fast reference
2. **DEPLOYMENT_GUIDE.md** - Detailed instructions
3. **README.md** - Project overview

### Troubleshooting:
- Check application logs: `pm2 logs`
- Check Nginx logs: `sudo tail -f /var/log/nginx/error.log`
- Check system logs: `sudo journalctl -xe`
- Verify all services running: `pm2 status && sudo systemctl status nginx`

## 🎓 Deployment Workflow

```
┌─────────────────────────────────────┐
│ 1. Prepare VM Server                │
│    - Run server-setup.sh            │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│ 2. Upload Application Code          │
│    - Git clone or SCP               │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│ 3. Configure Environment            │
│    - Create .env file               │
│    - Set database credentials       │
│    - Set JWT secret                 │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│ 4. Install & Start                  │
│    - npm install                    │
│    - pm2 start ecosystem.config.js  │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│ 5. Configure Nginx                  │
│    - Setup reverse proxy            │
│    - Configure domain               │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│ 6. Setup SSL (Optional)             │
│    - Install certbot                │
│    - Get SSL certificate            │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│ 7. Test & Monitor                   │
│    - Test API endpoints             │
│    - Monitor logs                   │
│    - Setup backups                  │
└─────────────────────────────────────┘
```

## 💡 Pro Tips

1. **Always backup** before major updates
2. **Test in staging** environment first if possible
3. **Monitor logs** regularly for errors
4. **Keep dependencies** updated for security
5. **Use environment variables** for sensitive data
6. **Document changes** you make to the server
7. **Setup alerts** for downtime (e.g., UptimeRobot)
8. **Regular backups** of database and application files

## 📈 Performance Optimization

### For Production:
- Use PM2 cluster mode for multiple CPU cores
- Enable Nginx caching
- Setup CDN for static files
- Optimize database queries
- Use connection pooling
- Enable gzip compression in Nginx

### PM2 Cluster Mode:
```javascript
// ecosystem.config.js
instances: 'max',  // Use all CPU cores
exec_mode: 'cluster'
```

## 🎉 Success Indicators

Your deployment is successful when:
- ✅ Application accessible via domain/IP
- ✅ PM2 shows app as "online"
- ✅ Nginx returns 200 status
- ✅ Database connections working
- ✅ Login/authentication working
- ✅ File uploads working
- ✅ SSL certificate active (if configured)
- ✅ Logs showing no errors

## 📅 Maintenance Schedule

### Daily:
- Monitor PM2 status
- Check error logs

### Weekly:
- Review application logs
- Check disk space
- Review security updates

### Monthly:
- Update dependencies
- Database backup verification
- Security audit
- Performance review

---

## 🚀 Ready to Deploy?

Choose your path:
- **First time?** → Start with `server-setup.sh`, then follow `DEPLOYMENT_GUIDE.md`
- **Experienced?** → Run `server-setup.sh`, then use `QUICK_START.md`
- **Need help?** → Read `DEPLOYMENT_GUIDE.md` thoroughly

**Good luck with your deployment! 🎉**

---

*Last updated: October 2025*

