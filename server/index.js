'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');

const store = require('./store');
const { analyze, normalizeStory } = require('./analyzer');

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

/* ---------------- 剧情 CRUD ---------------- */

app.get('/api/stories', (req, res) => {
  res.json(store.listStories());
});

app.get('/api/stories/:id', (req, res) => {
  const record = store.getStory(req.params.id);
  if (!record) return res.status(404).json({ error: '剧情不存在' });
  res.json(record);
});

app.post('/api/stories', (req, res) => {
  const story = normalizeStory(req.body || {});
  const record = store.createStory(story);
  res.status(201).json(record);
});

app.put('/api/stories/:id', (req, res) => {
  const story = normalizeStory(req.body || {});
  const record = store.updateStory(req.params.id, story);
  if (!record) return res.status(404).json({ error: '剧情不存在' });
  res.json(record);
});

app.delete('/api/stories/:id', (req, res) => {
  const ok = store.deleteStory(req.params.id);
  if (!ok) return res.status(404).json({ error: '剧情不存在' });
  res.status(204).end();
});

/* ---------------- 分析（已保存 / 未保存均可） ---------------- */

app.get('/api/stories/:id/analysis', (req, res) => {
  const record = store.getStory(req.params.id);
  if (!record) return res.status(404).json({ error: '剧情不存在' });
  res.json(analyze(record.story));
});

app.post('/api/analyze', (req, res) => {
  res.json(analyze(req.body || {}));
});

/* ---------------- 导入 / 导出 ---------------- */

app.get('/api/stories/:id/export', (req, res) => {
  const record = store.getStory(req.params.id);
  if (!record) return res.status(404).json({ error: '剧情不存在' });
  const filename = encodeURIComponent((record.story.name || 'story').replace(/[\\/:*?"<>|\s]+/g, '_'));
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}.json`);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.send(JSON.stringify(record.story, null, 2));
});

app.post('/api/import', (req, res) => {
  const payload = req.body;
  const storyData = payload && payload.format === 'branching-story/v1' && payload.scenes
    ? payload
    : payload && payload.story
      ? payload.story
      : payload;
  if (!storyData || typeof storyData !== 'object' || !Array.isArray(storyData.scenes)) {
    return res.status(400).json({ error: '导入文件格式不正确：需要 branching-story/v1 的剧情 JSON' });
  }
  const story = normalizeStory(storyData);
  const record = store.importStory(story, payload && payload.importId);
  res.status(201).json(record);
});

/* ---------------- 错误处理 ---------------- */

app.use((err, req, res, next) => {
  // JSON 解析错误等
  const status = err.type === 'entity.parse.failed' ? 400 : 500;
  res.status(status).json({ error: err.message || '服务器内部错误' });
});

const PORT = parseInt(process.env.PORT || '3000', 10);

store.ensureStorage();

if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[分支剧情审校] 服务已启动：http://localhost:${PORT}`);
  });
}

module.exports = app;
