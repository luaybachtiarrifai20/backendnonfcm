# 🎓 Backend Manajemen Sekolah

Backend API untuk sistem manajemen sekolah yang dibangun dengan Express.js dan MySQL.

## 📋 Features

- 🔐 Authentication & Authorization (JWT)
- 👥 User Management (Admin, Guru, Siswa, Orang Tua)
- 🏫 School Management (Kelas, Mata Pelajaran, Jadwal)
- 📊 Academic Management (Nilai, Tugas, Ujian)
- 💰 Financial Management (Pembayaran, SPP)
- 📱 Announcements & Notifications
- 📤 File Upload Support
- 🔒 Role-based Access Control

## 🛠️ Tech Stack

- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: MySQL
- **Authentication**: JWT (JSON Web Tokens)
- **Password Hashing**: bcrypt
- **File Upload**: Multer
- **CORS**: Enabled

## 📦 Dependencies

```json
{
  "express": "^5.1.0",
  "mysql2": "^3.14.5",
  "jsonwebtoken": "^9.0.2",
  "bcryptjs": "^3.0.2",
  "cors": "^2.8.5",
  "multer": "^2.0.2"
}
```

## 🚀 Quick Start (Local Development)

### Prerequisites
- Node.js 16+ installed
- MySQL database access
- npm or yarn

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd backendmanajemensekolah
```

2. Install dependencies:
```bash
npm install
```

3. Create `.env` file:
```bash
cp .env.example .env
```

4. Update `.env` with your database credentials:
```env
DB_HOST=your-database-host
DB_USER=your-database-user
DB_PASSWORD=your-database-password
DB_NAME=your-database-name
DB_PORT=3306
JWT_SECRET=your-secret-key
```

5. Start the development server:
```bash
npm run dev
```

The API will be available at `http://localhost:3000`

## 🚀 Production Deployment

### Option 1: VM/VPS Server (Recommended for Full Control)

We provide comprehensive deployment guides:

1. **[📖 Full Deployment Guide](DEPLOYMENT_GUIDE.md)** - Complete step-by-step instructions
2. **[⚡ Quick Start Guide](QUICK_START.md)** - Condensed version for experienced users

**Quick Overview:**
- Setup Ubuntu server with Node.js, PM2, and Nginx
- Deploy application and configure environment
- Setup reverse proxy and SSL
- Configure process management and monitoring

### Option 2: Vercel (Serverless)

This project includes Vercel configuration (`vercel.json`):

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel --prod
```

**Note**: For Vercel deployment, ensure your database allows external connections.

### Option 3: Docker (Coming Soon)

Docker support is planned for future releases.

## 📁 Project Structure

```
backendmanajemensekolah/
├── index.js              # Main application file
├── package.json          # Dependencies and scripts
├── ecosystem.config.js   # PM2 configuration
├── nginx.conf.example    # Nginx configuration template
├── deploy.sh            # Deployment automation script
├── .env.example         # Environment variables template
├── vercel.json          # Vercel deployment config
├── uploads/             # File uploads directory
└── logs/                # Application logs (PM2)
```

## 🔧 Available Scripts

```bash
# Development with auto-reload
npm run dev

# Production
npm start

# Deploy (on server)
./deploy.sh
```

## 🔐 Security Features

- ✅ JWT-based authentication
- ✅ Password hashing with bcrypt
- ✅ Role-based access control
- ✅ CORS configuration
- ✅ SQL injection prevention (prepared statements)
- ⚠️ Make sure to change JWT_SECRET in production
- ⚠️ Use HTTPS in production
- ⚠️ Keep dependencies updated

## 📡 API Endpoints

### Authentication
- `POST /register` - Register new user
- `POST /login` - User login
- `POST /logout` - User logout

### Users
- `GET /users` - Get all users
- `GET /users/:id` - Get user by ID
- `PUT /users/:id` - Update user
- `DELETE /users/:id` - Delete user

### Classes
- `GET /kelas` - Get all classes
- `POST /kelas` - Create class
- `PUT /kelas/:id` - Update class
- `DELETE /kelas/:id` - Delete class

### Subjects
- `GET /mata-pelajaran` - Get all subjects
- `POST /mata-pelajaran` - Create subject
- `PUT /mata-pelajaran/:id` - Update subject

### Schedules
- `GET /jadwal` - Get all schedules
- `POST /jadwal` - Create schedule

### Grades
- `GET /nilai` - Get grades
- `POST /nilai` - Add grade
- `PUT /nilai/:id` - Update grade

### Payments
- `GET /pembayaran` - Get payments
- `POST /pembayaran` - Create payment

### Announcements
- `GET /pengumuman` - Get announcements
- `POST /pengumuman` - Create announcement

*And many more endpoints... (see index.js for complete list)*

## 🔑 Authentication

Most endpoints require authentication. Include JWT token in request headers:

```
Authorization: Bearer <your-jwt-token>
```

## 👥 User Roles

- **Admin**: Full system access
- **Guru** (Teacher): Manage classes, grades, assignments
- **Siswa** (Student): View grades, assignments, schedules
- **Orang Tua** (Parent): View child's academic information

## 🗄️ Database

This application uses MySQL database. The schema includes:

- Users (users)
- Classes (kelas)
- Subjects (mata_pelajaran)
- Schedules (jadwal)
- Grades (nilai)
- Assignments (tugas)
- Exams (ujian)
- Payments (pembayaran)
- Announcements (pengumuman)
- Attendance (absensi)

## 📝 Environment Variables

Required environment variables:

| Variable | Description | Example |
|----------|-------------|---------|
| `NODE_ENV` | Environment mode | production |
| `PORT` | Application port | 3000 |
| `DB_HOST` | Database host | localhost |
| `DB_USER` | Database user | root |
| `DB_PASSWORD` | Database password | secret |
| `DB_NAME` | Database name | school_db |
| `DB_PORT` | Database port | 3306 |
| `JWT_SECRET` | JWT secret key | your-secret-key |
| `APP_URL` | Application URL | http://localhost:3000 |

## 🔄 Updating the Application

When deployed on a server:

```bash
cd /var/www/backend-sekolah
./deploy.sh
```

Or manually:
```bash
git pull
npm install --production
pm2 restart backend-sekolah
```

## 📊 Monitoring

With PM2 on server:

```bash
# View status
pm2 status

# View logs
pm2 logs backend-sekolah

# Monitor resources
pm2 monit

# View specific log lines
pm2 logs backend-sekolah --lines 100
```

## 🐛 Troubleshooting

### Port already in use
```bash
lsof -i :3000
kill -9 <PID>
```

### Database connection failed
- Check database credentials in `.env`
- Verify database server is running
- Check firewall rules
- Ensure database user has proper permissions

### PM2 not starting
```bash
pm2 delete all
pm2 start ecosystem.config.js
pm2 save
```

### Nginx 502 Bad Gateway
```bash
pm2 status  # Check if app is running
pm2 logs    # Check for errors
sudo systemctl restart nginx
```

## 📚 Documentation

- **[Full Deployment Guide](DEPLOYMENT_GUIDE.md)** - Comprehensive deployment instructions
- **[Quick Start Guide](QUICK_START.md)** - Fast deployment reference
- **Nginx Configuration** - See `nginx.conf.example`
- **PM2 Configuration** - See `ecosystem.config.js`

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the ISC License.

## 👨‍💻 Author

Built with ❤️ for educational institutions

## 📞 Support

For deployment issues, refer to:
- [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) for detailed instructions
- [QUICK_START.md](QUICK_START.md) for quick reference

## 🔗 Related Projects

- Frontend (if applicable)
- Mobile App (if applicable)

---

**Happy Coding! 🚀**

