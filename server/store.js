'use strict';

/**
 * 极简 JSON 文件存储：data/stories.json
 * 首次启动若为空，则写入 seed 示例剧情。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'stories.json');

function uid() {
  return crypto.randomBytes(8).toString('hex');
}

function ensureStorage() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    const seed = require('./seed');
    const stories = seed.map((story) => ({
      id: uid(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      story
    }));
    fs.writeFileSync(DATA_FILE, JSON.stringify({ stories }, null, 2), 'utf8');
  }
}

function readAll() {
  ensureStorage();
  try {
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return Array.isArray(raw.stories) ? raw.stories : [];
  } catch (e) {
    throw new Error(`存储文件损坏（${DATA_FILE}）：${e.message}`);
  }
}

function writeAll(stories) {
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ stories }, null, 2), 'utf8');
  fs.renameSync(tmp, DATA_FILE);
}

function listStories() {
  return readAll().map((s) => ({
    id: s.id,
    name: s.story.name,
    sceneCount: Array.isArray(s.story.scenes) ? s.story.scenes.length : 0,
    variableCount: Array.isArray(s.story.variables)
      ? s.story.variables.length
      : s.story.variables && typeof s.story.variables === 'object'
        ? Object.keys(s.story.variables).length
        : 0,
    startScene: s.story.startScene,
    updatedAt: s.updatedAt
  }));
}

function getStory(id) {
  return readAll().find((s) => s.id === id) || null;
}

function createStory(story) {
  const stories = readAll();
  const now = new Date().toISOString();
  const record = { id: uid(), createdAt: now, updatedAt: now, story };
  stories.push(record);
  writeAll(stories);
  return record;
}

function updateStory(id, story) {
  const stories = readAll();
  const idx = stories.findIndex((s) => s.id === id);
  if (idx === -1) return null;
  stories[idx] = { ...stories[idx], story, updatedAt: new Date().toISOString() };
  writeAll(stories);
  return stories[idx];
}

function deleteStory(id) {
  const stories = readAll();
  const idx = stories.findIndex((s) => s.id === id);
  if (idx === -1) return false;
  stories.splice(idx, 1);
  writeAll(stories);
  return true;
}

/** 导入（可携带已有 id，冲突时生成新 id）。 */
function importStory(story, preferredId) {
  const stories = readAll();
  const now = new Date().toISOString();
  let id = preferredId && /^[a-f0-9]{16}$/.test(preferredId) ? preferredId : uid();
  if (stories.some((s) => s.id === id)) id = uid();
  const record = { id, createdAt: now, updatedAt: now, story };
  stories.push(record);
  writeAll(stories);
  return record;
}

module.exports = {
  ensureStorage,
  listStories,
  getStory,
  createStory,
  updateStory,
  deleteStory,
  importStory
};
