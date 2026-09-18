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
const BASE_URL = 'https://mooxsy72-oss.github.io/outfits-images/images/';
const OUTFITS_JSON = process.env.OUTFITS_JSON || 'outfits.json';
const UNDRESSED_JSON = process.env.UNDRESSED_JSON || 'undressed.json';

const DEFAULT_CATEGORY = 'fantasy';
const DEFAULT_GENDER = 'female';

// Категории, для которых в index.html есть кнопки фильтра
const KNOWN_CATEGORIES = [
  'modern', 'ofis', 'elegant', 'sport', 'pyjamas', 'summer',
  'osen', 'dacha', 'postapoc', 'slavic', 'folk', 'fantasy'
];
const KNOWN_GENDERS = ['female', 'male'];

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
    for (const tag of rest.split(/[_-]+/)) {
      const t = tag.toLowerCase();
      if (KNOWN_GENDERS.includes(t)) result.gender = t;
      else if (t === 'f' || t === 'ж') result.gender = 'female';
      else if (t === 'm' || t === 'м') result.gender = 'male';
      else if (t) result.category = t;
    }
  }
  return result;
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
const knownIds = new Set(existingOutfits.map(o => Number(o.id)));

const added = [];
const needsReview = [];
const unknownCats = new Set();

for (const [id, info] of [...bases].sort((a, b) => a[0] - b[0])) {
  if (knownIds.has(id)) continue; // уже описан — не трогаем

  const category = info.category || DEFAULT_CATEGORY;
  const gender = info.gender || DEFAULT_GENDER;

  if (!KNOWN_CATEGORIES.includes(category)) unknownCats.add(category);
  if (!info.category || !info.gender) needsReview.push(id);

  const txtName = info.file.replace(IMAGE_EXT, '.txt');
  const entry = {
    id,
    title: '',
    img: BASE_URL + info.file,
    prompt: txtFiles.has(txtName.toLowerCase()) ? BASE_URL + txtName : '',
    category,
    gender
  };
  existingOutfits.push(entry);
  added.push(id);
}

// ── Собираем undressed.json ────────────────────────────────
// Пересобираем целиком: ступени однозначно определяются файлами,
// ручных правок в них не бывает.
const undressed = [];
for (const [id, list] of [...stages].sort((a, b) => b[0] - a[0])) {
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
const orphans = [...stages.keys()].filter(id => !allIds.has(id));

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
console.log(`Ступеней раздевалки:  ${undressed.length} (у ${stages.size} нарядов)`);

if (needsReview.length) {
  console.log(`\nБез категории/пола (проставлено по умолчанию): ${needsReview.join(', ')}`);
  fs.writeFileSync(
    'TODO.md',
    '# Нужно проставить категорию и пол\n\n' +
    needsReview.map(id => `- [ ] ${id}`).join('\n') + '\n'
  );
}
if (unknownCats.size) {
  console.log(`\nВНИМАНИЕ: категории без кнопки в index.html: ${[...unknownCats].join(', ')}`);
}
if (orphans.length) {
  console.log(`\nВНИМАНИЕ: ступени без базового наряда (опечатка в номере?): ${orphans.join(', ')}`);
}
