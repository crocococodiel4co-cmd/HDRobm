/**
 * Пересылка PDF брифов с hdrgrouporm.ru в Telegram.
 *
 * Страница брифа после скачивания PDF отправляет сюда копию файла,
 * скрипт пересылает её боту в нужные чаты с подписью «кто, какой бриф».
 *
 * Настройка (один раз):
 *  1. Project Settings → Script properties:
 *       BOT_TOKEN — токен бота от @BotFather
 *       CHAT_ID   — id чата или чатов через запятую (личка, группа)
 *  2. Deploy → New deployment → Web app:
 *       Execute as: Me,  Who has access: Anyone
 *  3. Ссылку вида https://script.google.com/macros/s/…/exec
 *     вписать в RELAY_URL на странице брифа.
 *
 * Токен хранится только здесь и на страницу не попадает.
 */

var BRIEF_TYPES = {
  avito: 'Авито',
  vk: 'ВКонтакте',
  maps: 'Яндекс Карты / 2ГИС',
  site: 'Разработка сайта'
};
var MAX_PDF_BYTES = 15 * 1024 * 1024;   // Telegram Bot API принимает до 50 МБ, нам хватит 15
var MAX_PER_10_MIN = 30;                // защита от спама: не больше 30 брифов за 10 минут
var TZ = 'Asia/Yekaterinburg';

function doPost(e) {
  try {
    var d = JSON.parse(e.postData.contents);
    var type = BRIEF_TYPES[d.brief];
    if (!type) return json_({ ok: false, error: 'unknown brief' });
    if (!d.pdf || !d.fileName) return json_({ ok: false, error: 'no pdf' });

    var bytes = Utilities.base64Decode(d.pdf);
    if (bytes.length > MAX_PDF_BYTES) return json_({ ok: false, error: 'pdf too large' });
    if (Utilities.newBlob(bytes.slice(0, 5)).getDataAsString() !== '%PDF-') {
      return json_({ ok: false, error: 'not a pdf' });
    }

    var cache = CacheService.getScriptCache();
    var slot = 'n' + Math.floor(Date.now() / 600000);
    var count = Number(cache.get(slot) || 0);
    if (count >= MAX_PER_10_MIN) return json_({ ok: false, error: 'rate limit' });
    cache.put(slot, String(count + 1), 900);

    var props = PropertiesService.getScriptProperties();
    var token = props.getProperty('BOT_TOKEN');
    var chats = String(props.getProperty('CHAT_ID') || '').split(',')
      .map(function (s) { return s.trim(); }).filter(String);
    if (!token || !chats.length) return json_({ ok: false, error: 'bot not configured' });

    var caption = caption_(type, d.meta || {}, !!d.update);
    var name = String(d.fileName).replace(/[\\/:*?"<>|]+/g, '').slice(0, 120) || 'brief.pdf';

    chats.forEach(function (chat) {
      var res = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/sendDocument', {
        method: 'post',
        payload: {
          chat_id: chat,
          caption: caption,
          parse_mode: 'HTML',
          document: Utilities.newBlob(bytes, 'application/pdf', name)
        },
        muteHttpExceptions: true
      });
      if (res.getResponseCode() !== 200) {
        throw new Error('telegram ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 200));
      }
    });
    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: String(err).slice(0, 300) });
  }
}

function caption_(type, m, isUpdate) {
  var lines = [];
  lines.push('<b>' + (isUpdate ? 'Бриф обновлён' : 'Новый бриф') + ': ' + esc_(type) + '</b>');
  lines.push('<b>Клиент:</b> ' + esc_(m.company || 'не указан'));
  if (m.package) lines.push('Пакет: ' + esc_(m.package));
  if (m.kind) lines.push('Что размещаем: ' + esc_(m.kind));
  if (m.mode) lines.push('Формат: ' + esc_(m.mode));
  if (m.required) lines.push('Обязательные вопросы: ' + esc_(m.required));
  if (m.files) lines.push('Клиент приложит отдельно: ' + esc_(m.files));
  lines.push(Utilities.formatDate(new Date(), TZ, 'dd.MM.yyyy, HH:mm'));
  return lines.join('\n').slice(0, 1000);
}

function esc_(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/** Проверка из редактора: Run → testSend. Должно прийти сообщение с тестовым PDF. */
function testSend() {
  var pdf = Utilities.newBlob('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF', 'application/pdf');
  var r = doPost({ postData: { contents: JSON.stringify({
    brief: 'avito',
    fileName: 'Тест.pdf',
    pdf: Utilities.base64Encode(pdf.getBytes()),
    meta: { company: 'Тестовая компания', package: 'До 15 объявлений', kind: 'Товары', mode: 'Распишу объявления сам', required: '20 из 20' }
  }) } });
  Logger.log(r.getContent());
}
