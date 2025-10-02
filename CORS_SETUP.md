# Firebase Storage CORS Setup

## Проблема
Ошибка "sharing failed, image not loaded" возникает из-за того, что Firebase Storage не настроен для CORS (Cross-Origin Resource Sharing), что не позволяет браузеру загружать изображения для Native Share API.

## Решение

### Автоматическая настройка (рекомендуется)

1. Установите Google Cloud CLI:
```bash
# На macOS через Homebrew
brew install google-cloud-sdk

# Или скачайте с https://cloud.google.com/sdk/docs/install
```

2. Аутентифицируйтесь:
```bash
gcloud auth login
gcloud config set project pepe-shillbot
```

3. Примените CORS настройки:
```bash
gsutil cors set storage-cors.json gs://pepe-shillbot.firebasestorage.app
```

### Ручная настройка через Firebase Console

1. Откройте [Firebase Console](https://console.firebase.google.com/project/pepe-shillbot/storage)
2. Перейдите в раздел Storage
3. Нажмите на вкладку "Rules" 
4. В настройках безопасности разрешите публичное чтение
5. Или используйте Firebase CLI:

```bash
firebase deploy --only storage
```

### Альтернативное решение

Если CORS не работает, обновленный код share.html теперь использует альтернативный метод загрузки изображений через `<img>` элемент и canvas, что должно обойти CORS ограничения.

## Проверка

После настройки CORS проверьте работу:
1. Сгенерируйте новое изображение в боте
2. Нажмите "Поделиться в Twitter"
3. В консоли браузера должны быть логи успешной загрузки изображения

## Fallback

Если Native Share API не работает, страница автоматически покажет инструкции для ручного шеринга.