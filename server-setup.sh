#!/bin/bash

# Server Setup Script for Backend Manajemen Sekolah
# This script automates the initial server setup
# Run this on a fresh Ubuntu 20.04+ server
# Usage: bash server-setup.sh

set -e  # Exit on error

echo "=========================================="
echo "🚀 Backend Manajemen Sekolah"
echo "    Server Setup Script"
echo "=========================================="
echo ""

# Check if running as root
if [ "$EUID" -eq 0 ]; then 
    echo "⚠️  Please run this script as a regular user with sudo privileges, not as root."
    exit 1
fi

# Update system
echo "📦 Updating system packages..."
sudo apt update
sudo apt upgrade -y

# Install Node.js
echo "📦 Installing Node.js..."
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    sudo apt install -y nodejs
    echo "✅ Node.js installed: $(node --version)"
else
    echo "✅ Node.js already installed: $(node --version)"
fi

# Install Git
echo "📦 Installing Git..."
if ! command -v git &> /dev/null; then
    sudo apt install -y git
    echo "✅ Git installed: $(git --version)"
else
    echo "✅ Git already installed: $(git --version)"
fi

# Install PM2
echo "📦 Installing PM2..."
if ! command -v pm2 &> /dev/null; then
    sudo npm install -g pm2
    echo "✅ PM2 installed: $(pm2 --version)"
else
    echo "✅ PM2 already installed: $(pm2 --version)"
fi

# Install Nginx
echo "📦 Installing Nginx..."
if ! command -v nginx &> /dev/null; then
    sudo apt install -y nginx
    sudo systemctl enable nginx
    echo "✅ Nginx installed"
else
    echo "✅ Nginx already installed"
fi

# Install MySQL client (optional, for testing connection)
echo "📦 Installing MySQL client..."
if ! command -v mysql &> /dev/null; then
    sudo apt install -y mysql-client
    echo "✅ MySQL client installed"
else
    echo "✅ MySQL client already installed"
fi

# Create application directory
echo "📁 Creating application directory..."
APP_DIR="/var/www/backend-sekolah"
if [ ! -d "$APP_DIR" ]; then
    sudo mkdir -p "$APP_DIR"
    sudo chown -R $USER:$USER "$APP_DIR"
    echo "✅ Created directory: $APP_DIR"
else
    echo "✅ Directory already exists: $APP_DIR"
    sudo chown -R $USER:$USER "$APP_DIR"
fi

# Setup firewall
echo "🔥 Configuring firewall..."
if command -v ufw &> /dev/null; then
    # Check if UFW is already enabled
    if sudo ufw status | grep -q "Status: active"; then
        echo "✅ UFW is already enabled"
    else
        sudo ufw allow OpenSSH
        sudo ufw allow 'Nginx Full'
        echo "UFW will be enabled. Current SSH connections will be maintained."
        read -p "Enable UFW firewall? (y/n) " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            sudo ufw --force enable
            echo "✅ Firewall configured"
        else
            echo "⚠️  Skipping firewall configuration"
        fi
    fi
else
    echo "⚠️  UFW not available"
fi

# Install additional utilities
echo "📦 Installing additional utilities..."
sudo apt install -y curl wget htop

# Setup log rotation for PM2
echo "📝 Setting up PM2 log rotation..."
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
pm2 set pm2-logrotate:compress true

echo ""
echo "=========================================="
echo "✅ Server setup completed successfully!"
echo "=========================================="
echo ""
echo "📋 Next steps:"
echo ""
echo "1. Navigate to application directory:"
echo "   cd $APP_DIR"
echo ""
echo "2. Clone or upload your application code"
echo "   - Using Git: git clone <your-repo-url> ."
echo "   - Or upload files via SCP/SFTP"
echo ""
echo "3. Install dependencies:"
echo "   npm install --production"
echo ""
echo "4. Create .env file:"
echo "   nano .env"
echo "   (Use .env.example as template)"
echo ""
echo "5. Start application with PM2:"
echo "   pm2 start ecosystem.config.js"
echo "   pm2 save"
echo "   pm2 startup (then run the command it shows)"
echo ""
echo "6. Configure Nginx:"
echo "   sudo nano /etc/nginx/sites-available/backend-sekolah"
echo "   (Use nginx.conf.example as template)"
echo ""
echo "7. Enable Nginx site:"
echo "   sudo ln -s /etc/nginx/sites-available/backend-sekolah /etc/nginx/sites-enabled/"
echo "   sudo nginx -t"
echo "   sudo systemctl restart nginx"
echo ""
echo "📚 For detailed instructions, see DEPLOYMENT_GUIDE.md"
echo ""
echo "🔧 Installed software versions:"
echo "   Node.js: $(node --version)"
echo "   npm: $(npm --version)"
echo "   PM2: $(pm2 --version)"
echo "   Git: $(git --version)"
echo "   Nginx: $(nginx -v 2>&1 | cut -d'/' -f2)"
echo ""
echo "=========================================="

