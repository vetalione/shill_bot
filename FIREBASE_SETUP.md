# 🔥 Firebase Setup для Twitter Cards

Этот документ описывает настройку Firebase для функции Twitter Cards с изображениями.

## 🎯 Что это дает

- ✅ **Автоматическое превью изображений** в Twitter постах
- ✅ **Красивые Twitter Cards** с Pepe изображениями  
- ✅ **Временное хранение** изображений (TTL 24 часа)
- ✅ **CDN доставка** по всему миру
- ✅ **Бесплатный тариф** Firebase (1GB + 10GB/месяц)

## 📋 Пошаговая настройка

### 1. Создание Firebase проекта

```bash
# Устанавливаем Firebase CLI
npm install -g firebase-tools

# Логинимся в Firebase
firebase login

# Создаем новый проект
firebase projects:create your-pepe-project
```

### 2. Инициализация Firebase

```bash
# В папке проекта
firebase init

# Выбираем:
# ✅ Functions: Deploy Cloud Functions
# ✅ Hosting: Deploy hosting
# ✅ Storage: Deploy Storage security rules
```

### 3. Настройка переменных окружения

Скопируйте `.env.example` в `.env` и заполните:

```bash
cp .env.example .env
```

Найдите данные в Firebase Console:
1. **Project ID**: в настройках проекта
2. **Service Account**: Настройки → Service Accounts → Generate new private key
3. **Web App URL**: будет показан после деплоя Hosting

### 4. Настройка Storage Rules

Файл `storage.rules` уже настроен для:
- Публичное чтение temp-images
- Автоматическое удаление через 24 часа
- Блокировка записи от клиентов

### 5. Деплой на Firebase

```bash
# Сборка и деплой
npm run deploy:firebase

# Или отдельно:
npm run build
firebase deploy
```

## 🔧 Архитектура

```
Bot Message → Firebase Storage → Twitter Card → Twitter Post
     ↓              ↓                ↓            ↓
1. Generate     2. Upload        3. Create     4. Share
   Pepe Image      to CDN          Card URL     with Preview
```

## 📊 Мониторинг

Firebase Console → Functions → Logs:
- ✅ Успешные загрузки изображений
- ❌ Ошибки создания карточек  
- 📈 Статистика использования

## 🎛️ Настройка TTL

В `src/services/firebase.ts`:

```typescript
// Изменить время жизни изображений
customMetadata: {
  'delete-after': String(Date.now() + 24 * 60 * 60 * 1000) // 24 часа
}
```

## 🚀 Production Tips

1. **Мониторинг квот**: Firebase Console → Usage
2. **CDN кеширование**: автоматически настроено  
3. **Cleanup функция**: запускать ежедневно через Cron
4. **Security Rules**: регулярно проверять логи доступа

## 📱 Тестирование

```bash
# Локальное тестирование
npm run start:web  # Запускает веб-сервер на порту 3000
npm run dev       # Запускает бота с Firebase

# Тест Twitter Card
curl http://localhost:3000/twitter/test-share-id
```

## 🔗 Полезные ссылки

- [Firebase Console](https://console.firebase.google.com)
- [Firebase Hosting Docs](https://firebase.google.com/docs/hosting)
- [Firebase Storage Docs](https://firebase.google.com/docs/storage)
- [Twitter Cards Validator](https://cards-dev.twitter.com/validator)