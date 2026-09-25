#!/usr/bin/env node
/**
 * Автосборка outfits.json и undressed.json из папки images/.
 *
 * Как это работает
 * ────────────────
 * Файл без буквы  →  обычный наряд      (717.png)
 * Файл с буквой   →  ступень раздевалки (717a.png, 717b.png, ...)
 * Рядом лежит .txt с тем же именем      (717.txt, 717a.txt)
 *
 * Категорию и пол можно задать прямо в имени файла:
 *     717_ofis_male.png
 *     717-dacha-female.jpg
 * Порядок не важен, разделитель — _ или -.
 * Если не указать, наряд получит значения по умолчанию,
 * а его номер попадёт в TODO.md, чтобы вы потом проставили вручную.
 *
 * Уже существующие записи НИКОГДА не перезаписываются: то, что вы
 * когда-то проставили руками, останется как есть.
 */

const fs = require('fs');
const path = require('path');

// ── Настройки ──────────────────────────────────────────────
const IMAGES_DIR = process.env.IMAGES_DIR || 'images';

// Адрес картинок вычисляем из самого репозитория, в котором запущен скрипт.
// Благодаря этому один и тот же файл работает в любом репо без правок.
// GITHUB_REPOSITORY имеет вид "mooxsy72-oss/outfits-images".
const BASE_URL = (() => {
  const repo = process.env.GITHUB_REPOSITORY;
  if (repo && repo.includes('/')) {
    const [owner, name] = repo.split('/');
    return `https://${owner}.github.io/${name}/${IMAGES_DIR}/`;
  }
  // Запасной вариант, если скрипт запущен не в GitHub Actions
  return 'https://mooxsy72-oss.github.io/outfits-images/images/';
})();
const OUTFITS_JSON = process.env.OUTFITS_JSON || 'outfits.json';
const UNDRESSED_JSON = process.env.UNDRESSED_JSON || 'undressed.json';
const TAGS_FILE = process.env.TAGS_FILE || 'tags.txt';
const DELETED_FILE = process.env.DELETED_FILE || 'deleted.txt';

const DEFAULT_CATEGORY = 'fantasy';
const DEFAULT_GENDER = 'female';

// Категории, для которых в index.html есть кнопки фильтра
const KNOWN_CATEGORIES = [
  'modern', 'ofis', 'elegant', 'sport', 'pyjamas', 'summer',
  'osen', 'dacha', 'postapoc', 'slavic', 'folk', 'fantasy'
];
const KNOWN_GENDERS = ['female', 'male'];

// Подтеги категории «Разное». Слово узнаётся по началу, поэтому
// подойдут любые формы: «ведьма», «ведьмы», «ведьмочка».
const SUBTAGS = [
  ['haute',     ['мод', 'кутюр', 'haute', 'couture']],   // Высокая мода
  ['baroque',   ['барок', 'баррок', 'baroque', 'рококо']],// Барокко
  ['witch',     ['ведьм', 'witch']],                     // Ведьмы
  ['knight',    ['рыцар', 'knight']],                    // Рыцарство
  ['angel',     ['ангел', 'angel']],                     // Ангелы
  ['barbarian', ['варвар', 'barbar']],                   // Варвары
  ['england',   ['англ', 'england', 'english']],         // Англия
  ['apoc',      ['постапок', 'апокалип', 'apoc', 'wasteland']] // Постапок
];
// Первое слово из двухсловных названий — «высокая мода», «суровая зима» —
// само по себе ничего не значит, смысл несёт второе.
const FILLER_WORDS = ['высокая', 'суровая'];

function subtagFor(word) {
  for (const [key, stems] of SUBTAGS) {
    if (stems.some(st => word.startsWith(st))) return key;
  }
  return null;
}

// Русские названия категорий → ключи, которые понимает index.html.
// Можно писать теги как угодно: "офис", "ofis", "Офис" — результат одинаковый.
const CATEGORY_ALIASES = {
  'повседневное': 'modern', 'повседневка': 'modern', 'повседнев': 'modern', 'обычное': 'modern',
  'офис': 'ofis', 'офисное': 'ofis', 'работа': 'ofis',
  'вечер': 'elegant', 'вечернее': 'elegant', 'элегантное': 'elegant', 'нарядное': 'elegant',
  'спорт': 'sport', 'спортивное': 'sport',
  'пижама': 'pyjamas', 'пижамное': 'pyjamas', 'сон': 'pyjamas',
  'лето': 'summer', 'летнее': 'summer',
  'осень': 'osen', 'осеннее': 'osen',
  'дача': 'dacha', 'дачное': 'dacha',
  'зима': 'postapoc', 'зимнее': 'postapoc', 'суроваязима': 'postapoc',
  'славянское': 'slavic', 'славянка': 'slavic', 'славян': 'slavic',
  'историческое': 'folk', 'история': 'folk', 'фолк': 'folk', 'народное': 'folk',
  'разное': 'fantasy', 'фэнтези': 'fantasy', 'фентези': 'fantasy', 'фантазия': 'fantasy'
};

const IMAGE_EXT = /\.(png|jpe?g|webp|gif)$/i;

// ── Вспомогательное ────────────────────────────────────────
function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

/** Разбирает имя файла: 717_ofis_male.png → { id, suffix, category, gender } */
function parseName(filename) {
  const base = filename.replace(IMAGE_EXT, '');
  const m = base.match(/^(\d+)([a-z]?)(?:[_-](.*))?$/i);
  if (!m) return null;

  const [, id, suffix, rest] = m;
  const result = { id: Number(id), suffix: (suffix || '').toLowerCase() };

  if (rest) {
    applyTags(result, rest.split(/[_-]+/));
  }
  return result;
}

/** Раскладывает список слов по полям category / gender */
function applyTags(target, words) {
  for (const word of words) {
    const t = String(word).trim().toLowerCase();
    if (!t) continue;
    if (KNOWN_GENDERS.includes(t)) target.gender = t;
    else if (t === 'f' || t === 'ж' || t === 'жен' || t === 'женское' || t === 'девушка') target.gender = 'female';
    else if (t === 'm' || t === 'м' || t === 'муж' || t === 'мужское' || t === 'парень') target.gender = 'male';
    else if (FILLER_WORDS.includes(t)) continue;
    else if (CATEGORY_ALIASES[t]) target.category = CATEGORY_ALIASES[t];
    else if (subtagFor(t)) {
      target.subs = target.subs || [];
      const key = subtagFor(t);
      if (!target.subs.includes(key)) target.subs.push(key);
    }
    else target.category = t;
  }
  // подтеги бывают только у «Разного» — если категория не указана, ставим её
  if (target.subs && target.subs.length && !target.category) target.category = 'fantasy';
  return target;
}

/**
 * Способ 2: общий файл tags.txt в корне репозитория.
 * Правило одно: все номера в строке получают все слова из этой строки.
 * Поэтому писать можно как удобнее:
 *
 *     720 офис м                       — один наряд
 *     ведьмы: 23, 25, 40-45            — тег один раз, номера списком
 *     ведьмы 23 25 40-45               — то же без двоеточия
 *     Разное: 23 ведьмы, 25 постапок   — общее слово до двоеточия,
 *                                        а после — у каждого своё
 *
 * Номер можно упоминать в нескольких строках — теги сложатся.
 * Строки, начинающиеся с #, — заметки, их робот пропускает.
 */
function parseTagItem(text) {
  const ids = [];
  const words = [];
  for (const tok of text.split(/[\s,;:]+/)) {
    if (!tok) continue;
    const range = tok.match(/^(\d+)-(\d+)$/);
    if (range) {
      const a = Number(range[1]), b = Number(range[2]);
      const [lo, hi] = a <= b ? [a, b] : [b, a];
      if (hi - lo > 2000) {
        console.warn(`  tags.txt: диапазон ${lo}-${hi} слишком большой, пропущен`);
        continue;
      }
      for (let n = lo; n <= hi; n++) ids.push(n);
    } else if (/^\d+$/.test(tok)) {
      ids.push(Number(tok));
    } else {
      words.push(tok);
    }
  }
  return { ids, words };
}

function readTagsFile() {
  const map = new Map();
  if (!fs.existsSync(TAGS_FILE)) return map;

  // Слова для номера копятся по всем строкам, где он встречается
  const wordsById = new Map();
  const give = (ids, words) => {
    for (const id of ids) {
      if (!wordsById.has(id)) wordsById.set(id, []);
      wordsById.get(id).push(...words);
    }
  };

  for (const raw of fs.readFileSync(TAGS_FILE, 'utf8').split(/\r?\n/)) {
    // «100 - 120» → «100-120», чтобы диапазон читался как один кусок
    const line = raw.trim().replace(/(\d+)\s*[-–—]\s*(\d+)/g, '$1-$2');
    if (!line || line.startsWith('#')) continue;

    const colon = line.indexOf(':');
    const left = colon === -1 ? '' : line.slice(0, colon);
    const leftPart = parseTagItem(left);

    if (colon !== -1 && leftPart.ids.length === 0) {
      // «ведьмы: 23, 25» или «Разное: 23 ведьмы, 25 постапок»:
      // слова слева — общие, справа через запятую — отдельные наряды
      for (const chunk of line.slice(colon + 1).split(/[,;]/)) {
        const item = parseTagItem(chunk);
        give(item.ids, [...leftPart.words, ...item.words]);
      }
    } else {
      // «720 офис м», «721: дача», «ведьмы 23 25» — вся строка про одно
      const item = parseTagItem(line);
      give(item.ids, item.words);
    }
  }

  for (const [id, words] of wordsById) map.set(id, applyTags({}, words));
  return map;
}

/**
 * Способ 3: строка тегов в самом файле промпта.
 * Первая строка вида "#tags: ofis male" — она не попадёт
 * в текст промпта на сайте, main.js её отрезает при показе.
 */
function readPromptTags(txtPath) {
  try {
    const first = fs.readFileSync(txtPath, 'utf8').split(/\r?\n/)[0].trim();
    const m = first.match(/^#\s*(?:tags?|теги)\s*:\s*(.+)$/i);
    if (m) return applyTags({}, m[1].split(/[\s,;]+/));
  } catch { /* файла нет или не читается */ }
  return null;
}

/**
 * deleted.txt — номера, которые нужно убрать с сайта навсегда.
 * Через пробел, запятую или с новой строки; диапазоны вида 100-120.
 * Такие наряды вычищаются из JSON и не добавляются обратно,
 * даже если картинка осталась лежать в папке.
 */
function readDeletedFile() {
  const ids = new Set();
  if (!fs.existsSync(DELETED_FILE)) return ids;
  for (const raw of fs.readFileSync(DELETED_FILE, 'utf8').split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    for (const m of line.matchAll(/(\d+)\s*[-–—]\s*(\d+)|(\d+)/g)) {
      if (m[3]) { ids.add(Number(m[3])); continue; }
      const a = Number(m[1]), b = Number(m[2]);
      const [lo, hi] = a <= b ? [a, b] : [b, a];
      if (hi - lo > 2000) {
        console.warn(`  deleted.txt: диапазон ${lo}-${hi} слишком большой, пропущен`);
        continue;
      }
      for (let n = lo; n <= hi; n++) ids.add(n);
    }
  }
  return ids;
}

// ── Читаем папку ───────────────────────────────────────────
if (!fs.existsSync(IMAGES_DIR)) {
  console.error(`Папка ${IMAGES_DIR} не найдена`);
  process.exit(1);
}

const files = fs.readdirSync(IMAGES_DIR).filter(f => IMAGE_EXT.test(f));
const txtFiles = new Set(
  fs.readdirSync(IMAGES_DIR).filter(f => /\.txt$/i.test(f)).map(f => f.toLowerCase())
);
const tagsFromFile = readTagsFile();
const deletedIds = readDeletedFile();

const bases = new Map();  // id -> { file, category, gender }
const stages = new Map(); // id -> [{ suffix, file }]

for (const file of files) {
  const info = parseName(file);
  if (!info) {
    console.warn(`  пропущен (непонятное имя): ${file}`);
    continue;
  }

  if (info.suffix) {
    if (!stages.has(info.id)) stages.set(info.id, []);
    stages.get(info.id).push({ suffix: info.suffix, file });
  } else {
    bases.set(info.id, { file, category: info.category, gender: info.gender });
  }
}

// ── Собираем outfits.json ──────────────────────────────────
const existingOutfits = readJson(OUTFITS_JSON, []);
const removed = existingOutfits
  .filter(o => deletedIds.has(Number(o.id)))
  .map(o => Number(o.id));
for (let i = existingOutfits.length - 1; i >= 0; i--) {
  if (deletedIds.has(Number(existingOutfits[i].id))) existingOutfits.splice(i, 1);
}
const knownIds = new Set(existingOutfits.map(o => Number(o.id)));

const added = [];
const replaced = [];
const retagged = [];
const needsReview = [];
const unknownCats = new Set();

for (const [id, info] of [...bases].sort((a, b) => a[0] - b[0])) {
  if (deletedIds.has(id)) continue; // удалён через deleted.txt — не возвращаем
  if (knownIds.has(id)) {
    // Наряд уже есть. Если его картинка лежит здесь, в images/, —
    // значит это замена: перенаправляем путь на новый файл.
    // Категорию и пол не трогаем, они остаются как были.
    const entry = existingOutfits.find(o => Number(o.id) === id);
    const txtName = info.file.replace(IMAGE_EXT, '.txt');
    const newImg = BASE_URL + info.file;

    let changed = false;
    if (entry.img !== newImg) {
      entry.img = newImg;
      changed = true;
    }
    if (txtFiles.has(txtName.toLowerCase())) {
      const newPrompt = BASE_URL + txtName;
      if (entry.prompt !== newPrompt) {
        entry.prompt = newPrompt;
        changed = true;
      }
    }
    if (changed) replaced.push(id);
    continue;
  }

  const txtName = info.file.replace(IMAGE_EXT, '.txt');
  const hasTxt = txtFiles.has(txtName.toLowerCase());

  // Приоритет: имя файла → tags.txt → шапка промпта → значения по умолчанию
  const fromTags = tagsFromFile.get(id) || {};
  const fromPrompt = hasTxt ? (readPromptTags(path.join(IMAGES_DIR, txtName)) || {}) : {};

  const category = info.category || fromTags.category || fromPrompt.category || DEFAULT_CATEGORY;
  const gender = info.gender || fromTags.gender || fromPrompt.gender || DEFAULT_GENDER;

  const gotCategory = info.category || fromTags.category || fromPrompt.category;
  const gotGender = info.gender || fromTags.gender || fromPrompt.gender;

  if (!KNOWN_CATEGORIES.includes(category)) unknownCats.add(category);
  if (!gotCategory) needsReview.push(id);

  const entry = {
    id,
    title: '',
    img: BASE_URL + info.file,
    prompt: hasTxt ? BASE_URL + txtName : '',
    category,
    gender
  };
  existingOutfits.push(entry);
  added.push(id);
}

// ── Явные теги применяются и к уже добавленным нарядам ──
// Если номер записан в tags.txt (или теги стоят в имени файла / шапке
// промпта), категория и пол обновятся, даже если наряд уже был в списке.
// Наряды, которых нет в tags.txt, не трогаем — ручные правки сохраняются.
function explicitTagsFor(id) {
  const info = bases.get(id) || {};
  const fromTags = tagsFromFile.get(id) || {};
  let fromPrompt = {};
  if (info.file) {
    const txtName = info.file.replace(IMAGE_EXT, '.txt');
    if (txtFiles.has(txtName.toLowerCase())) {
      fromPrompt = readPromptTags(path.join(IMAGES_DIR, txtName)) || {};
    }
  }
  // Подтеги: строка в tags.txt главнее всего. Если номер там записан,
  // подтеги берутся ровно из неё — убрали слово из строки, подтег снимется.
  let subs;
  if (tagsFromFile.has(id)) subs = fromTags.subs || [];
  else if (info.subs || fromPrompt.subs) subs = info.subs || fromPrompt.subs;

  return {
    category: info.category || fromTags.category || fromPrompt.category,
    gender: info.gender || fromTags.gender || fromPrompt.gender,
    subs
  };
}

for (const entry of existingOutfits) {
  const id = Number(entry.id);
  const t = explicitTagsFor(id);
  let changed = false;
  if (t.category && entry.category !== t.category) {
    entry.category = t.category;
    changed = true;
  }
  if (t.gender && entry.gender !== t.gender) {
    entry.gender = t.gender;
    changed = true;
  }
  if (t.subs) {
    const before = JSON.stringify(entry.subs || []);
    const after = JSON.stringify(t.subs);
    if (before !== after) {
      if (t.subs.length) entry.subs = t.subs;
      else delete entry.subs;
      changed = true;
    }
  }
  if (t.category && !KNOWN_CATEGORIES.includes(t.category)) unknownCats.add(t.category);
  if (changed && !added.includes(id)) retagged.push(id);
}

// Номера в tags.txt, которых нет в списке этого репозитория
const tagsForMissing = [...tagsFromFile.keys()].filter(id => !knownIds.has(id) && !bases.has(id));

// ── Собираем undressed.json ────────────────────────────────
// Пересобираем целиком: ступени однозначно определяются файлами,
// ручных правок в них не бывает.
const undressed = [];
for (const [id, list] of [...stages].sort((a, b) => b[0] - a[0])) {
  if (deletedIds.has(id)) continue; // раздевашки удалённого наряда тоже убираем
  list.sort((a, b) => a.suffix.localeCompare(b.suffix));
  for (const s of list) {
    const txtName = s.file.replace(IMAGE_EXT, '.txt');
    undressed.push({
      id,
      img: BASE_URL + s.file,
      prompt: txtFiles.has(txtName.toLowerCase()) ? BASE_URL + txtName : ''
    });
  }
}

// Ступени у несуществующих нарядов — частая опечатка в номере
const allIds = new Set([...bases.keys(), ...existingOutfits.map(o => Number(o.id))]);
const orphans = [...stages.keys()].filter(id => !allIds.has(id) && !deletedIds.has(id));

// ── Записываем ─────────────────────────────────────────────
existingOutfits.sort((a, b) => Number(a.id) - Number(b.id));

fs.writeFileSync(
  OUTFITS_JSON,
  '[\n' + existingOutfits.map(o => '  ' + JSON.stringify(o)).join(',\n') + '\n]\n'
);
fs.writeFileSync(
  UNDRESSED_JSON,
  '[\n' + undressed.map(o => JSON.stringify(o)).join(',\n') + '\n]\n'
);

// ── Отчёт ──────────────────────────────────────────────────
console.log(`Нарядов всего:        ${existingOutfits.length}`);
console.log(`Новых добавлено:      ${added.length}${added.length ? ' → ' + added.join(', ') : ''}`);
console.log(`Заменено картинок:    ${replaced.length}${replaced.length ? ' → ' + replaced.join(', ') : ''}`);
console.log(`Обновлены теги:       ${retagged.length}${retagged.length ? ' → ' + retagged.join(', ') : ''}`);
console.log(`Удалено (deleted.txt): ${removed.length}${removed.length ? ' → ' + removed.join(', ') : ''}`);
if (tagsForMissing.length) {
  console.log(`\nВ tags.txt есть номера, которых нет в этом репо (проигнорированы): ${tagsForMissing.join(', ')}`);
}
console.log(`Ступеней раздевалки:  ${undressed.length} (у ${new Set(undressed.map(u => u.id)).size} нарядов)`);

// TODO.md — живой список: новые без категории добавляются,
// а те, кому вы дописали теги, убираются сами.
const todoPrev = fs.existsSync('TODO.md')
  ? [...fs.readFileSync('TODO.md', 'utf8').matchAll(/^- \[ \] (\d+)/gm)].map(m => Number(m[1]))
  : [];
const todo = [...new Set([...todoPrev, ...needsReview])]
  .filter(id => !explicitTagsFor(id).category)
  .filter(id => existingOutfits.some(o => Number(o.id) === id))
  .sort((a, b) => a - b);

if (todo.length) {
  console.log(`\nБез категории (стоит «Разное» по умолчанию): ${todo.join(', ')}`);
  fs.writeFileSync(
    'TODO.md',
    '# Нужно проставить категорию\n\n' +
    'Допишите эти номера в tags.txt — они уберутся отсюда сами.\n\n' +
    todo.map(id => `- [ ] ${id}`).join('\n') + '\n'
  );
} else if (fs.existsSync('TODO.md')) {
  fs.unlinkSync('TODO.md');
}
if (unknownCats.size) {
  console.log(`\nВНИМАНИЕ: категории без кнопки в index.html: ${[...unknownCats].join(', ')}`);
}
if (orphans.length) {
  console.log(`\nВНИМАНИЕ: ступени без базового наряда (опечатка в номере?): ${orphans.join(', ')}`);
}
