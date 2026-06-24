const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const sharp = require('sharp');
const nodemailer = require('nodemailer');
const { getDistance } = require('geolib');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = 'your_jwt_secret_key';

// Настройка почтового транспорта
const transport = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'your-email@gmail.com',
    pass: 'your-app-password'
  }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Настройка multer для загрузки файлов
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Только изображения разрешены!'), false);
    }
  }
});

// Подключение к MongoDB
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// Обновленные схемы Mongoose
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, default: 'user' },
  status: { type: String, enum: ['active', 'banned'], default: 'active' },
  avatar: { type: String },
  bio: { type: String, default: '' },
  emailVerified: { type: Boolean, default: false },
  emailVerificationToken: { type: String },
  resetPasswordToken: { type: String },
  resetPasswordExpires: { type: Date },
  privacySettings: {
    profileVisible: { type: Boolean, default: true },
    activityVisible: { type: Boolean, default: true },
    emailVisible: { type: Boolean, default: false }
  },
  level: { type: Number, default: 1 },
  experience: { type: Number, default: 0 },
  achievements: [{
    achievement: { type: mongoose.Schema.Types.ObjectId, ref: 'Achievement' },
    unlockedAt: { type: Date, default: Date.now },
    progress: { type: Number, default: 0 }
  }],
  visitedLegends: [{ 
    legend: { type: mongoose.Schema.Types.ObjectId, ref: 'Legend' },
    visitedAt: { type: Date, default: Date.now }
  }],
  createdAt: { type: Date, default: Date.now },
  lastActive: { type: Date, default: Date.now }
});

const categorySchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  description: { type: String },
  icon: { type: String, default: 'fas fa-tag' },
  color: { type: String, default: '#6c757d' },
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  legendCount: { type: Number, default: 0 }
});

const legendSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, required: true },
  fullText: { type: String }, // Добавлено поле для полного текста
  category: { type: String, required: true },
  images: [{ type: String }],
  location: {
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    address: { type: String }
  },
  rating: { type: Number, default: 0 },
  ratings: [{
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    rating: { type: Number, required: true, min: 1, max: 5 }
  }],
  likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  status: { type: String, default: 'pending' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  tags: [{ type: String }],
  reports: [{
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    reason: { type: String, required: true },
    description: { type: String },
    createdAt: { type: Date, default: Date.now },
    status: { type: String, default: 'pending' }
  }],
  comments: [{
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    authorName: { type: String, required: true },
    text: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
    likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    dislikes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    parentComment: { type: mongoose.Schema.Types.ObjectId, ref: 'Comment' },
    replies: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Comment' }],
    isEdited: { type: Boolean, default: false }
  }],
  viewCount: { type: Number, default: 0 }
});

const achievementSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, required: true },
  icon: { type: String, required: true },
  type: { type: String, required: true }, // 'legend', 'comment', 'like', 'visit', 'level'
  requirement: { type: Number, required: true },
  points: { type: Number, default: 10 },
  rarity: { type: String, default: 'common' }, // common, rare, epic, legendary
  category: { type: String }
});

const reportSchema = new mongoose.Schema({
  type: { type: String, required: true }, // 'legend', 'comment'
  targetId: { type: mongoose.Schema.Types.ObjectId, required: true },
  reporter: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  reason: { type: String, required: true },
  description: { type: String },
  status: { type: String, default: 'pending' },
  moderator: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  moderatorNotes: { type: String },
  createdAt: { type: Date, default: Date.now },
  resolvedAt: { type: Date }
});

const activitySchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, required: true }, // 'legend_created', 'comment_added', 'achievement_unlocked', etc.
  data: { type: mongoose.Schema.Types.Mixed },
  createdAt: { type: Date, default: Date.now }
});

// Модели
const User = mongoose.model('User', userSchema);
const Category = mongoose.model('Category', categorySchema);
const Legend = mongoose.model('Legend', legendSchema);
const Achievement = mongoose.model('Achievement', achievementSchema);
const Report = mongoose.model('Report', reportSchema);
const Activity = mongoose.model('Activity', activitySchema);

// Middleware для проверки аутентификации
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Требуется аутентификация' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ message: 'Неверный токен' });
    }
    req.user = user;
    next();
  });
};

// Middleware для проверки прав администратора
const isAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Требуются права администратора' });
  }
  next();
};

// Middleware для проверки модератора
const isModerator = (req, res, next) => {
  if (req.user.role !== 'admin' && req.user.role !== 'moderator') {
    return res.status(403).json({ message: 'Требуются права модератора' });
  }
  next();
};

// Функции для системы достижений
const checkAndAwardAchievements = async (userId, type, count) => {
  try {
    const user = await User.findById(userId).populate('achievements.achievement');
    const achievements = await Achievement.find({ type });
    
    for (const achievement of achievements) {
      if (count >= achievement.requirement) {
        const hasAchievement = user.achievements.some(a => 
          a.achievement._id.toString() === achievement._id.toString()
        );
        
        if (!hasAchievement) {
          user.achievements.push({
            achievement: achievement._id,
            progress: achievement.requirement,
            unlockedAt: new Date()
          });
          
          // Добавляем опыт
          user.experience += achievement.points;
          
          // Проверяем повышение уровня (каждые 100 опыта = 1 уровень)
          const newLevel = Math.floor(user.experience / 100) + 1;
          if (newLevel > user.level) {
            user.level = newLevel;
          }
          
          await user.save();
          
          // Записываем активность
          await Activity.create({
            user: userId,
            type: 'achievement_unlocked',
            data: {
              achievementId: achievement._id,
              achievementTitle: achievement.title,
              level: user.level
            }
          });
        }
      }
    }
  } catch (error) {
    console.error('Ошибка при проверке достижений:', error);
  }
};

// Роуты для аутентификации
app.post('/api/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;

        const existingUser = await User.findOne({ $or: [{ email }, { username }] });
        if (existingUser) {
            return res.status(400).json({ message: 'Пользователь с таким email или именем уже существует' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const emailVerificationToken = jwt.sign({ email }, JWT_SECRET, { expiresIn: '24h' });

        const user = new User({
            username,
            email,
            password: hashedPassword,
            emailVerificationToken
        });

        await user.save();

        const token = jwt.sign(
            { id: user._id, username: user.username, role: user.role },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.status(201).json({
            message: 'Пользователь успешно зарегистрирован. Проверьте ваш email для подтверждения.',
            token,
            user: {
                id: user._id,
                username: user.username,
                email: user.email,
                role: user.role,
                emailVerified: user.emailVerified
            }
        });
    } catch (error) {
        console.error('Ошибка при регистрации:', error);
        res.status(500).json({ message: 'Ошибка сервера', error: error.message });
    }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email, status: 'active' });
    if (!user) {
      return res.status(400).json({ message: 'Неверный email или пароль, или аккаунт заблокирован' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(400).json({ message: 'Неверный email или пароль' });
    }

    // Обновляем время последней активности
    user.lastActive = new Date();
    await user.save();

    const token = jwt.sign(
      { id: user._id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      message: 'Успешный вход',
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
        avatar: user.avatar,
        level: user.level,
        emailVerified: user.emailVerified
      }
    });
  } catch (error) {
    console.error('Ошибка при входе:', error);
    res.status(500).json({ message: 'Ошибка сервера', error: error.message });
  }
});

// Восстановление пароля
app.post('/api/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: 'Пользователь с таким email не найден' });
    }

    const resetToken = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '1h' });
    user.resetPasswordToken = resetToken;
    user.resetPasswordExpires = Date.now() + 3600000; // 1 час
    
    await user.save();

    const resetUrl = `http://localhost:3000/reset-password?token=${resetToken}`;
    
    await transport.sendMail({
      from: '"UrbanLegends" <noreply@urbanlegends.com>',
      to: email,
      subject: 'Восстановление пароля - UrbanLegends',
      html: `
        <h2>Восстановление пароля</h2>
        <p>Для восстановления пароля перейдите по ссылке:</p>
        <a href="${resetUrl}">Восстановить пароль</a>
        <p>Ссылка действительна в течение 1 часа.</p>
        <p>Если вы не запрашивали восстановление пароля, проигнорируйте это письмо.</p>
      `
    });

    res.json({ message: 'Инструкции по восстановлению пароля отправлены на ваш email' });
  } catch (error) {
    console.error('Ошибка при восстановлении пароля:', error);
    res.status(500).json({ message: 'Ошибка сервера', error: error.message });
  }
});

app.post('/api/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    
    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: Date.now() }
    });
    
    if (!user) {
      return res.status(400).json({ message: 'Неверная или просроченная ссылка восстановления' });
    }

    user.password = await bcrypt.hash(password, 10);
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    
    await user.save();

    res.json({ message: 'Пароль успешно изменен' });
  } catch (error) {
    console.error('Ошибка при сбросе пароля:', error);
    res.status(500).json({ message: 'Ошибка сервера', error: error.message });
  }
});

// Верификация email
app.get('/api/verify-email', async (req, res) => {
  try {
    const { token } = req.query;
    
    const user = await User.findOne({ emailVerificationToken: token });
    if (!user) {
      return res.status(400).json({ message: 'Неверная ссылка верификации' });
    }

    user.emailVerified = true;
    user.emailVerificationToken = undefined;
    await user.save();

    res.json({ message: 'Email успешно подтвержден' });
  } catch (error) {
    console.error('Ошибка при верификации email:', error);
    res.status(500).json({ message: 'Ошибка сервера', error: error.message });
  }
});

// Роуты для профиля
app.get('/api/profile', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .select('-password -resetPasswordToken -emailVerificationToken')
      .populate('achievements.achievement')
      .populate('visitedLegends.legend');
    
    if (!user) {
      return res.status(404).json({ message: 'Пользователь не найден' });
    }

    res.json({ user });
  } catch (error) {
    console.error('Ошибка при получении профиля:', error);
    res.status(500).json({ message: 'Ошибка сервера', error: error.message });
  }
});

app.put('/api/profile', authenticateToken, async (req, res) => {
  try {
    const { username, bio, privacySettings } = req.body;
    
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'Пользователь не найден' });
    }

    if (username && username !== user.username) {
      const existingUser = await User.findOne({ username });
      if (existingUser) {
        return res.status(400).json({ message: 'Имя пользователя уже занято' });
      }
      user.username = username;
    }

    if (bio !== undefined) user.bio = bio;
    if (privacySettings) user.privacySettings = { ...user.privacySettings, ...privacySettings };
    
    await user.save();

    res.json({ 
      message: 'Профиль обновлен', 
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        avatar: user.avatar,
        bio: user.bio,
        level: user.level,
        privacySettings: user.privacySettings
      }
    });
  } catch (error) {
    console.error('Ошибка при обновлении профиля:', error);
    res.status(500).json({ message: 'Ошибка сервера', error: error.message });
  }
});

// Загрузка аватара
// В server.js добавьте этот маршрут для загрузки аватаров
app.post('/api/upload-avatar', authenticateToken, upload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'Файл не загружен' });
    }

    // Создаем папку uploads если её нет
    const uploadsDir = path.join(__dirname, 'uploads', 'avatars');
    require('fs').mkdirSync(uploadsDir, { recursive: true });

    // Обработка изображения
    const processedImage = await sharp(req.file.buffer)
      .resize(200, 200)
      .jpeg({ quality: 80 })
      .toBuffer();

    const filename = `avatar-${req.user.id}-${Date.now()}.jpg`;
    const filepath = path.join(uploadsDir, filename);

    require('fs').writeFileSync(filepath, processedImage);

    const user = await User.findById(req.user.id);
    user.avatar = `/uploads/avatars/${filename}`;
    await user.save();

    res.json({ 
      message: 'Аватар успешно загружен', 
      avatarUrl: user.avatar 
    });
  } catch (error) {
    console.error('Ошибка при загрузке аватара:', error);
    res.status(500).json({ message: 'Ошибка сервера', error: error.message });
  }
});

// Расширенные роуты для легенд с поиском и фильтрацией
app.get('/api/legends', async (req, res) => {
  try {
    const { 
      status = 'approved', 
      category, 
      search, 
      minRating, 
      maxDistance,
      userLat,
      userLng,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      page = 1,
      limit = 12
    } = req.query;
    
    let filter = { status };
    
    if (category && category !== 'all') filter.category = category;
    if (minRating) filter.rating = { $gte: parseFloat(minRating) };
    
    // Поиск по тексту
    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { fullText: { $regex: search, $options: 'i' } },
        { tags: { $in: [new RegExp(search, 'i')] } }
      ];
    }
    
    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;
    
    const skip = (page - 1) * limit;
    
    let legends = await Legend.find(filter)
      .populate('createdBy', 'username avatar')
      .sort(sortOptions)
      .skip(skip)
      .limit(parseInt(limit));
    
    // Фильтрация по расстоянию
    if (userLat && userLng && maxDistance) {
      legends = legends.filter(legend => {
        const distance = getDistance(
          { latitude: parseFloat(userLat), longitude: parseFloat(userLng) },
          { latitude: legend.location.lat, longitude: legend.location.lng }
        );
        return distance <= parseFloat(maxDistance) * 1000; // км в метры
      });
    }
    
    const total = await Legend.countDocuments(filter);
    
    res.json({
      legends,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Ошибка при получении легенд:', error);
    res.status(500).json({ message: 'Ошибка сервера', error: error.message });
  }
});

// Автодополнение для поиска
app.get('/api/legends/search/suggestions', async (req, res) => {
  try {
    const { q } = req.query;
    
    if (!q || q.length < 2) {
      return res.json([]);
    }
    
    const suggestions = await Legend.find({
      $or: [
        { title: { $regex: q, $options: 'i' } },
        { tags: { $in: [new RegExp(q, 'i')] } }
      ],
      status: 'approved'
    })
    .select('title category')
    .limit(10);
    
    res.json(suggestions);
  } catch (error) {
    console.error('Ошибка при поиске:', error);
    res.status(500).json({ message: 'Ошибка сервера', error: error.message });
  }
});

// Добавьте после функции setupAvatarUpload
function setupLegendImagesUpload() {
    const uploadArea = document.getElementById('legendImagesUploadArea');
    const fileInput = document.getElementById('modalLegendImages');
    
    uploadArea.addEventListener('click', () => fileInput.click());
    
    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.classList.add('dragover');
    });
    
    uploadArea.addEventListener('dragleave', () => {
        uploadArea.classList.remove('dragover');
    });
    
    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.classList.remove('dragover');
        
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            handleLegendImagesUpload(files);
        }
    });
    
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleLegendImagesUpload(e.target.files);
        }
    });
}

let legendImages = [];

function handleLegendImagesUpload(files) {
    const previewContainer = document.getElementById('legendImagesPreview');
    
    for (const file of files) {
        if (!file.type.startsWith('image/')) {
            alert('Пожалуйста, выбирайте только изображения');
            continue;
        }
        
        if (legendImages.length >= 5) {
            alert('Максимум 5 изображений');
            break;
        }
        
        const reader = new FileReader();
        reader.onload = function(e) {
            const imageData = {
                file: file,
                preview: e.target.result
            };
            legendImages.push(imageData);
            renderLegendImagesPreview();
        };
        reader.readAsDataURL(file);
    }
}

function renderLegendImagesPreview() {
    const previewContainer = document.getElementById('legendImagesPreview');
    previewContainer.innerHTML = '';
    
    legendImages.forEach((imageData, index) => {
        const preview = document.createElement('div');
        preview.className = 'image-preview';
        preview.innerHTML = `
            <img src="${imageData.preview}" alt="Preview">
            <button type="button" class="remove-image" onclick="removeLegendImage(${index})">&times;</button>
        `;
        previewContainer.appendChild(preview);
    });
}

function removeLegendImage(index) {
    legendImages.splice(index, 1);
    renderLegendImagesPreview();
}

function clearLegendImages() {
    legendImages = [];
    document.getElementById('legendImagesPreview').innerHTML = '';
    document.getElementById('modalLegendImages').value = '';
}
    

// Получение конкретной легенды
app.get('/api/legends/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const legend = await Legend.findById(id)
      .populate('createdBy', 'username avatar level')
      .populate('comments.author', 'username avatar');
    
    if (!legend) {
      return res.status(404).json({ message: 'Легенда не найдена' });
    }

    // Увеличиваем счетчик просмотров
    legend.viewCount += 1;
    await legend.save();

    res.json(legend);
  } catch (error) {
    console.error('Ошибка при получении легенды:', error);
    res.status(500).json({ message: 'Ошибка сервера', error: error.message });
  }
});
// Создание новой легенды
app.post('/api/legends', authenticateToken, upload.array('images', 5), async (req, res) => {
  try {
    const { title, description, fullText, category, lat, lng, address, tags } = req.body;
    
    const imageUrls = [];
    
    // Обработка загруженных изображений
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const processedImage = await sharp(file.buffer)
          .resize(800, 600)
          .jpeg({ quality: 85 })
          .toBuffer();

        const filename = `legend-${Date.now()}-${Math.random().toString(36).substring(7)}.jpg`;
        const filepath = path.join(__dirname, 'uploads', 'legends', filename);

        require('fs').mkdirSync(path.dirname(filepath), { recursive: true });
        require('fs').writeFileSync(filepath, processedImage);

        imageUrls.push(`/uploads/legends/${filename}`);
      }
    }
    
    const tagArray = tags ? tags.split(',').map(tag => tag.trim()) : [];
    
    const legend = new Legend({
      title,
      description,
      fullText,
      category,
      images: imageUrls,
      location: { lat: parseFloat(lat), lng: parseFloat(lng), address },
      tags: tagArray,
      createdBy: req.user.id
    });
    
    await legend.save();
    
    // ОБНОВЛЕНИЕ СЧЕТЧИКА КАТЕГОРИИ - ДОБАВЬТЕ ЭТОТ КОД:
    await Category.findOneAndUpdate(
      { name: category },
      { $inc: { legendCount: 1 } },
      { upsert: true } // создаст категорию, если её нет
    );
    
    // Проверяем достижения
    const userLegendsCount = await Legend.countDocuments({ createdBy: req.user.id, status: 'approved' });
    await checkAndAwardAchievements(req.user.id, 'legend', userLegendsCount);
    
    // Записываем активность
    await Activity.create({
      user: req.user.id,
      type: 'legend_created',
      data: {
        legendId: legend._id,
        legendTitle: legend.title
      }
    });
    
    res.status(201).json({
      message: 'Легенда успешно создана и отправлена на модерацию',
      legend
    });
  } catch (error) {
    console.error('Ошибка при создании легенды:', error);
    res.status(500).json({ message: 'Ошибка сервера', error: error.message });
  }
});

// Лайк/дизлайк легенды
app.post('/api/legends/:id/like', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    const legend = await Legend.findById(id);
    if (!legend) {
      return res.status(404).json({ message: 'Легенда не найдена' });
    }

    const likeIndex = legend.likes.indexOf(req.user.id);
    let liked = false;

    if (likeIndex === -1) {
      legend.likes.push(req.user.id);
      liked = true;
      
      // Проверяем достижения для лайков
      const userLikesCount = await Legend.aggregate([
        { $match: { likes: mongoose.Types.ObjectId(req.user.id) } },
        { $count: 'count' }
      ]);
      
      const count = userLikesCount.length > 0 ? userLikesCount[0].count : 0;
      await checkAndAwardAchievements(req.user.id, 'like', count);
    } else {
      legend.likes.splice(likeIndex, 1);
    }

    await legend.save();

    res.json({
      liked,
      likes: legend.likes.length,
      message: liked ? 'Лайк добавлен' : 'Лайк убран'
    });
  } catch (error) {
    console.error('Ошибка при установке лайка:', error);
    res.status(500).json({ message: 'Ошибка сервера', error: error.message });
  }
});

// Рейтинг легенды
app.post('/api/legends/:id/rate', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { rating } = req.body;
    
    const legend = await Legend.findById(id);
    if (!legend) {
      return res.status(404).json({ message: 'Легенда не найдена' });
    }

    // Удаляем старый рейтинг пользователя
    legend.ratings = legend.ratings.filter(r => r.user.toString() !== req.user.id);
    
    // Добавляем новый рейтинг
    legend.ratings.push({
      user: req.user.id,
      rating: parseInt(rating)
    });

    // Пересчитываем средний рейтинг
    const totalRating = legend.ratings.reduce((sum, r) => sum + r.rating, 0);
    legend.rating = totalRating / legend.ratings.length;

    await legend.save();

    res.json({
      rating: legend.rating,
      userRating: rating,
      totalRatings: legend.ratings.length
    });
  } catch (error) {
    console.error('Ошибка при оценке легенды:', error);
    res.status(500).json({ message: 'Ошибка сервера', error: error.message });
  }
});

// Получение комментариев для легенды
app.get('/api/legends/:id/comments', async (req, res) => {
  try {
    const { id } = req.params;
    
    const legend = await Legend.findById(id).populate('comments.author', 'username avatar');
    if (!legend) {
      return res.status(404).json({ message: 'Легенда не найдена' });
    }

    res.json(legend.comments || []);
  } catch (error) {
    console.error('Ошибка при получении комментариев:', error);
    res.status(500).json({ message: 'Ошибка сервера', error: error.message });
  }
});

// Добавление комментария
// Добавление комментария
app.post('/api/legends/:id/comments', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { text, parentCommentId } = req.body;
    
    if (!text || text.trim().length === 0) {
      return res.status(400).json({ message: 'Текст комментария не может быть пустым' });
    }

    const legend = await Legend.findById(id);
    if (!legend) {
      return res.status(404).json({ message: 'Легенда не найдена' });
    }

    const newComment = {
      author: req.user.id,
      authorName: req.user.username,
      text: text.trim(),
      createdAt: new Date(),
      updatedAt: new Date()
    };

    if (parentCommentId) {
      newComment.parentComment = parentCommentId;
    }

    legend.comments.push(newComment);
    await legend.save();

    // Получаем обновленную легенду с комментариями
    const updatedLegend = await Legend.findById(id)
      .populate('comments.author', 'username avatar');

    // Проверяем достижения для комментариев (исправленная версия)
    try {
      const userCommentsCount = await Legend.aggregate([
        { $unwind: '$comments' },
        { $match: { 'comments.author': new mongoose.Types.ObjectId(req.user.id) } },
        { $count: 'count' }
      ]);
      
      const count = userCommentsCount.length > 0 ? userCommentsCount[0].count : 0;
      await checkAndAwardAchievements(req.user.id, 'comment', count);
    } catch (achievementError) {
      console.error('Ошибка при проверке достижений:', achievementError);
      // Продолжаем выполнение, даже если достижения не сработали
    }
    
    // Записываем активность (в блоке try-catch)
    try {
      await Activity.create({
        user: req.user.id,
        type: 'comment_added',
        data: {
          legendId: legend._id,
          legendTitle: legend.title,
          commentId: legend.comments[legend.comments.length - 1]._id
        }
      });
    } catch (activityError) {
      console.error('Ошибка при записи активности:', activityError);
      // Продолжаем выполнение, даже если активность не записалась
    }
    
    res.status(201).json({ 
      message: 'Комментарий добавлен', 
      comments: updatedLegend.comments 
    });
  } catch (error) {
    console.error('Ошибка при добавлении комментария:', error);
    res.status(500).json({ message: 'Ошибка сервера', error: error.message });
  }
});

// Удаление комментария
app.delete('/api/legends/:legendId/comments/:commentId', authenticateToken, async (req, res) => {
  try {
    const { legendId, commentId } = req.params;
    
    const legend = await Legend.findById(legendId);
    if (!legend) {
      return res.status(404).json({ message: 'Легенда не найдена' });
    }

    const comment = legend.comments.id(commentId);
    if (!comment) {
      return res.status(404).json({ message: 'Комментарий не найден' });
    }

    // Проверяем права: автор комментария или администратор
    if (comment.author.toString() !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Недостаточно прав для удаления комментария' });
    }

    legend.comments.pull(commentId);
    await legend.save();

    res.json({ message: 'Комментарий удален' });
  } catch (error) {
    console.error('Ошибка при удалении комментария:', error);
    res.status(500).json({ message: 'Ошибка сервера', error: error.message });
  }
});

// Система жалоб
app.post('/api/report', authenticateToken, async (req, res) => {
  try {
    const { type, targetId, reason, description } = req.body;
    
    const report = new Report({
      type,
      targetId,
      reporter: req.user.id,
      reason,
      description
    });
    
    await report.save();
    
    // Также добавляем жалобу к целевому объекту
    if (type === 'legend') {
      await Legend.findByIdAndUpdate(targetId, {
        $push: {
          reports: {
            user: req.user.id,
            reason,
            description
          }
        }
      });
    }
    
    res.status(201).json({ message: 'Жалоба отправлена на рассмотрение' });
  } catch (error) {
    console.error('Ошибка при отправке жалобы:', error);
    res.status(500).json({ message: 'Ошибка сервера', error: error.message });
  }
});

app.put('/api/legends/:id/moderate', authenticateToken, isModerator, async (req, res) => {
    try {
        const { id } = req.params;
        const { status, moderatorNotes } = req.body;
        
        if (!['approved', 'rejected'].includes(status)) {
            return res.status(400).json({ message: 'Неверный статус' });
        }

        const legend = await Legend.findById(id);
        if (!legend) {
            return res.status(404).json({ message: 'Легенда не найдена' });
        }

        // Обновляем счетчик категории только при одобрении
        if (status === 'approved') {
            await Category.findOneAndUpdate(
                { name: legend.category },
                { $inc: { legendCount: 1 } }
            );
        }

        // Обновляем статус легенды
        legend.status = status;
        legend.updatedAt = new Date();
        await legend.save();

        // Если легенда одобрена, проверяем достижения автора
        if (status === 'approved') {
            const userLegendsCount = await Legend.countDocuments({ 
                createdBy: legend.createdBy._id, 
                status: 'approved' 
            });
            await checkAndAwardAchievements(legend.createdBy._id, 'legend', userLegendsCount);
        }

        const updatedLegend = await Legend.findById(id)
            .populate('createdBy', 'username email');

        res.json({ 
            message: `Легенда ${status === 'approved' ? 'одобрена' : 'отклонена'}`,
            legend: updatedLegend
        });
    } catch (error) {
        console.error('Ошибка при модерации:', error);
        res.status(500).json({ message: 'Ошибка сервера', error: error.message });
    }
});

app.delete('/api/legends/:id', authenticateToken, isModerator, async (req, res) => {
    try {
        const { id } = req.params;
        
        // ДОБАВЬТЕ ЭТОТ КОД СЮДА - получаем легенду перед удалением
        const legend = await Legend.findById(id);
        if (!legend) {
            return res.status(404).json({ message: 'Легенда не найдена' });
        }
        
        // Обновляем счетчик категории
        await Category.findOneAndUpdate(
            { name: legend.category },
            { $inc: { legendCount: -1 } }
        );
        
        // Удаляем легенду
        await Legend.findByIdAndDelete(id);

        res.json({ message: 'Легенда удалена' });
    } catch (error) {
        console.error('Ошибка при удалении легенды:', error);
        res.status(500).json({ message: 'Ошибка сервера', error: error.message });
    }
});

// Получение статистики для админ-панели
app.get('/api/admin/stats', authenticateToken, isAdmin, async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const totalLegends = await Legend.countDocuments();
    const pendingLegends = await Legend.countDocuments({ status: 'pending' });
    
    const totalCommentsResult = await Legend.aggregate([
      { $project: { commentsCount: { $size: '$comments' } } },
      { $group: { _id: null, total: { $sum: '$commentsCount' } } }
    ]);
    
    const totalComments = totalCommentsResult.length > 0 ? totalCommentsResult[0].total : 0;

    const recentActivities = await Activity.find()
      .populate('user', 'username')
      .sort({ createdAt: -1 })
      .limit(10);

    res.json({
      totalUsers,
      totalLegends,
      pendingLegends,
      totalComments,
      recentActivities
    });
  } catch (error) {
    console.error('Ошибка при получении статистики:', error);
    res.status(500).json({ message: 'Ошибка сервера', error: error.message });
  }
});

// Получение всех пользователей для админ-панели
app.get('/api/admin/users', authenticateToken, isAdmin, async (req, res) => {
  try {
    const users = await User.find()
      .select('-password -resetPasswordToken -emailVerificationToken')
      .sort({ createdAt: -1 });

    res.json(users);
  } catch (error) {
    console.error('Ошибка при получении пользователей:', error);
    res.status(500).json({ message: 'Ошибка сервера', error: error.message });
  }
});

// Получение легенд для модерации
app.get('/api/admin/legends', authenticateToken, isModerator, async (req, res) => {
  try {
    const { status } = req.query;
    
    let filter = {};
    if (status) filter.status = status;

    const legends = await Legend.find(filter)
      .populate('createdBy', 'username email')
      .sort({ createdAt: -1 });

    res.json(legends);
  } catch (error) {
    console.error('Ошибка при получении легенд для модерации:', error);
    res.status(500).json({ message: 'Ошибка сервера', error: error.message });
  }
});

// Роуты для системы достижений
app.get('/api/achievements', authenticateToken, async (req, res) => {
  try {
    const achievements = await Achievement.find().sort({ requirement: 1 });
    const user = await User.findById(req.user.id).populate('achievements.achievement');
    
    const achievementsWithProgress = achievements.map(achievement => {
      const userAchievement = user.achievements.find(a => 
        a.achievement._id.toString() === achievement._id.toString()
      );
      
      return {
        ...achievement.toObject(),
        unlocked: !!userAchievement,
        progress: userAchievement ? userAchievement.progress : 0,
        unlockedAt: userAchievement ? userAchievement.unlockedAt : null
      };
    });
    
    res.json(achievementsWithProgress);
  } catch (error) {
    console.error('Ошибка при получении достижений:', error);
    res.status(500).json({ message: 'Ошибка сервера', error: error.message });
  }
});

// История активности пользователя
app.get('/api/activity', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;
    
    const activities = await Activity.find({ user: req.user.id })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));
    
    const total = await Activity.countDocuments({ user: req.user.id });
    
    res.json({
      activities,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Ошибка при получении активности:', error);
    res.status(500).json({ message: 'Ошибка сервера', error: error.message });
  }
});

// Управление ролями пользователей
app.put('/api/admin/users/:id/role', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;
    
    if (!['user', 'moderator', 'admin'].includes(role)) {
      return res.status(400).json({ message: 'Неверная роль' });
    }
    
    const user = await User.findByIdAndUpdate(
      id,
      { role },
      { new: true }
    ).select('-password -resetPasswordToken -emailVerificationToken');
    
    if (!user) {
      return res.status(404).json({ message: 'Пользователь не найден' });
    }
    
    res.json({ 
      message: `Роль пользователя изменена на ${role}`,
      user 
    });
  } catch (error) {
    console.error('Ошибка при изменении роли:', error);
    res.status(500).json({ message: 'Ошибка сервера', error: error.message });
  }
});

// Блокировка/разблокировка пользователя
app.put('/api/admin/users/:id/status', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    if (!['active', 'banned'].includes(status)) {
      return res.status(400).json({ message: 'Неверный статус' });
    }
    
    const user = await User.findByIdAndUpdate(
      id,
      { status },
      { new: true }
    ).select('-password -resetPasswordToken -emailVerificationToken');
    
    if (!user) {
      return res.status(404).json({ message: 'Пользователь не найден' });
    }
    
    res.json({ 
      message: `Статус пользователя изменен на ${status}`,
      user 
    });
  } catch (error) {
    console.error('Ошибка при изменении статуса:', error);
    res.status(500).json({ message: 'Ошибка сервера', error: error.message });
  }
});

// Роуты для категорий
app.get('/api/categories', async (req, res) => {
  try {
    const categories = await Category.find({ isActive: true }).sort({ name: 1 });
    res.json(categories);
  } catch (error) {
    console.error('Ошибка при получении категорий:', error);
    res.status(500).json({ message: 'Ошибка сервера', error: error.message });
  }
});

app.post('/api/admin/categories', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { name, description, icon, color } = req.body;
    
    const existingCategory = await Category.findOne({ name });
    if (existingCategory) {
      return res.status(400).json({ message: 'Категория с таким названием уже существует' });
    }
    
    const category = new Category({
      name,
      description,
      icon: icon || 'fas fa-tag',
      color: color || '#6c757d'
    });
    
    await category.save();
    res.status(201).json({ 
      message: 'Категория успешно создана',
      category 
    });
  } catch (error) {
    console.error('Ошибка при создании категории:', error);
    res.status(500).json({ message: 'Ошибка сервера', error: error.message });
  }
});

app.put('/api/admin/categories/:id', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, icon, color, isActive } = req.body;
    
    const category = await Category.findByIdAndUpdate(
      id,
      { name, description, icon, color, isActive },
      { new: true }
    );
    
    if (!category) {
      return res.status(404).json({ message: 'Категория не найдена' });
    }
    
    res.json({ 
      message: 'Категория обновлена',
      category 
    });
  } catch (error) {
    console.error('Ошибка при обновлении категории:', error);
    res.status(500).json({ message: 'Ошибка сервера', error: error.message });
  }
});

app.delete('/api/admin/categories/:id', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Проверяем, есть ли легенды в этой категории
    const legendsCount = await Legend.countDocuments({ category: id });
    if (legendsCount > 0) {
      return res.status(400).json({ 
        message: 'Невозможно удалить категорию, так как с ней связаны легенды' 
      });
    }
    
    const category = await Category.findByIdAndDelete(id);
    if (!category) {
      return res.status(404).json({ message: 'Категория не найдена' });
    }
    
    res.json({ message: 'Категория удалена' });
  } catch (error) {
    console.error('Ошибка при удалении категории:', error);
    res.status(500).json({ message: 'Ошибка сервера', error: error.message });
  }
});

// Получение жалоб для админ-панели
app.get('/api/admin/reports', authenticateToken, isModerator, async (req, res) => {
  try {
    const { status, type } = req.query;
    
    let filter = {};
    if (status) filter.status = status;
    if (type) filter.type = type;
    
    const reports = await Report.find(filter)
      .populate('reporter', 'username')
      .populate('moderator', 'username')
      .sort({ createdAt: -1 });
    
    res.json(reports);
  } catch (error) {
    console.error('Ошибка при получении жалоб:', error);
    res.status(500).json({ message: 'Ошибка сервера', error: error.message });
  }
});

// Обработка жалоб
app.put('/api/admin/reports/:id', authenticateToken, isModerator, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, moderatorNotes } = req.body;
    
    if (!['pending', 'resolved', 'rejected'].includes(status)) {
      return res.status(400).json({ message: 'Неверный статус' });
    }
    
    const updateData = { 
      status,
      moderator: req.user.id,
      resolvedAt: status === 'pending' ? null : new Date()
    };
    
    if (moderatorNotes) {
      updateData.moderatorNotes = moderatorNotes;
    }
    
    const report = await Report.findByIdAndUpdate(
      id,
      updateData,
      { new: true }
    ).populate('reporter', 'username')
     .populate('moderator', 'username');
    
    if (!report) {
      return res.status(404).json({ message: 'Жалоба не найдена' });
    }
    
    // Если жалоба принята, удаляем контент
    if (status === 'resolved') {
      if (report.type === 'legend') {
        await Legend.findByIdAndDelete(report.targetId);
      } else if (report.type === 'comment') {
        // Находим легенду с этим комментарием и удаляем его
        const legend = await Legend.findOne({ 'comments._id': report.targetId });
        if (legend) {
          legend.comments.pull(report.targetId);
          await legend.save();
        }
      }
    }
    
    res.json({ 
      message: `Жалоба ${status === 'resolved' ? 'принята' : status === 'rejected' ? 'отклонена' : 'в обработке'}`,
      report 
    });
  } catch (error) {
    console.error('Ошибка при обработке жалобы:', error);
    res.status(500).json({ message: 'Ошибка сервера', error: error.message });
  }
});

// Инициализация достижений при запуске
const initializeAchievements = async () => {
    const achievements = [
        // Достижения за легенды
        { title: 'Первый рассказ', description: 'Создайте первую легенду', icon: 'fas fa-book', type: 'legend', requirement: 1, points: 10 },
        { title: 'Собиратель историй', description: 'Создайте 5 легенд', icon: 'fas fa-book-open', type: 'legend', requirement: 5, points: 25 },
        { title: 'Мастер легенд', description: 'Создайте 10 легенд', icon: 'fas fa-books', type: 'legend', requirement: 10, points: 50, rarity: 'rare' },
        { title: 'Великий сказитель', description: 'Создайте 25 легенд', icon: 'fas fa-crown', type: 'legend', requirement: 25, points: 100, rarity: 'epic' },
        { title: 'Легендарный автор', description: 'Создайте 50 легенд', icon: 'fas fa-trophy', type: 'legend', requirement: 50, points: 200, rarity: 'legendary' },
        
        // Достижения за комментарии
        { title: 'Первый комментарий', description: 'Оставьте первый комментарий', icon: 'fas fa-comment', type: 'comment', requirement: 1, points: 5 },
        { title: 'Активный комментатор', description: 'Оставьте 10 комментариев', icon: 'fas fa-comments', type: 'comment', requirement: 10, points: 25 },
        { title: 'Общительный исследователь', description: 'Оставьте 25 комментариев', icon: 'fas fa-comment-dots', type: 'comment', requirement: 25, points: 50, rarity: 'rare' },
        { title: 'Мастер дискуссий', description: 'Оставьте 50 комментариев', icon: 'fas fa-comment-medical', type: 'comment', requirement: 50, points: 100, rarity: 'epic' },
        { title: 'Гуру общения', description: 'Оставьте 100 комментариев', icon: 'fas fa-comments', type: 'comment', requirement: 100, points: 200, rarity: 'legendary' },
        
    ];

    for (const achievementData of achievements) {
        await Achievement.findOneAndUpdate(
            { title: achievementData.title },
            achievementData,
            { upsert: true, new: true }
        );
    }
};

// Инициализация категорий при запуске
const initializeCategories = async () => {
  const defaultCategories = [
    { name: 'Мистика', description: 'Загадочные и сверхъестественные истории', icon: 'fas fa-ghost', color: '#8e44ad' },
    { name: 'История', description: 'Исторические события и личности', icon: 'fas fa-history', color: '#e67e22' },
    { name: 'Архитектура', description: 'Легенды о зданиях и сооружениях', icon: 'fas fa-landmark', color: '#34495e' },
    { name: 'Современность', description: 'Современные городские легенды', icon: 'fas fa-building', color: '#3498db' }
  ];
  
  for (const categoryData of defaultCategories) {
    await Category.findOneAndUpdate(
      { name: categoryData.name },
      categoryData,
      { upsert: true, new: true }
    );
  }
};

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.use(express.static(path.join(__dirname)));

// Запуск сервера
mongoose.connect(process.env.MONGODB_URI)
  .then(async () => {
    console.log('MongoDB connected');

    await initializeAchievements();
    await initializeCategories();

    app.listen(PORT, () => {
      console.log(`Сервер запущен на порту ${PORT}`);
    });
  })
  .catch(err => {
    console.error(err);
  });
