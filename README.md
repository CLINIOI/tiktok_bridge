# TikTok Studio Upload Helper

## Что внутри

- `tiktok_studio_helper.user.js` — userscript для Tampermonkey
- `tiktok_bridge.py` — локальный Python-сервер (bridge)

---

## Шаг 1: Запусти bridge

Открой CMD или PowerShell и выполни:

```
python tiktok_bridge.py
```

Должно появиться:
```
[Bridge] TikTok Studio Bridge started on http://127.0.0.1:8765
```

Оставь окно открытым — bridge должен работать пока ты публикуешь видео.

Проверить работу bridge: открой в браузере http://127.0.0.1:8765/health

---

## Шаг 2: Установи userscript в Tampermonkey

1. Открой расширение Tampermonkey в браузере
2. Нажми "Создать новый скрипт"
3. Удали всё содержимое
4. Вставь содержимое файла `tiktok_studio_helper.user.js`
5. Нажми Ctrl+S (сохранить)

---

## Шаг 3: Открой TikTok Studio

Перейди на https://www.tiktok.com/tiktokstudio/upload

Справа должна появиться панель "TT Upload Helper".

---

## Форматы строки

### Формат с разделителем |
```
D:\Videos\cat.mp4 | #cats #funny #pet | 2026-04-25 18:30 | Мой кот делает что-то смешное
```

### Формат key=value
```
path=D:\Videos\cat.mp4; tags=#cats #funny #pet; date=2026-04-25 18:30; caption=Мой кот
```

Поля `date` и `caption` необязательны.

---

## Кнопки

| Кнопка | Что делает |
|--------|------------|
| Разобрать | Парсит строку и показывает разобранные поля |
| Заполнить текст | Вставляет caption + хештеги в поле описания и заполняет дату |
| Загрузить видео | Читает файл через bridge и подставляет в TikTok |
| Сделать всё | Разобрать + заполнить + загрузить за один клик |

---

## Устранение проблем

**"Bridge недоступен"** — запусти `python tiktok_bridge.py` в CMD

**"input[type=file] не найден"** — TikTok изменил DOM. Попробуй нажать кнопку загрузки на странице вручную, чтобы появился input

**"поле описания не найдено"** — TikTok использует нестандартный редактор. Нажми кнопку ещё раз после того как страница полностью загрузилась

**Панель не появляется** — убедись что userscript включён в Tampermonkey, и ты находишься на странице /upload
