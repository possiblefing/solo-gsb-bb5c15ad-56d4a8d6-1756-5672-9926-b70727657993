'use strict';

const express = require('express');
const path = require('path');
const storage = require('./src/storage');
const { analyze } = require('./src/analyzer');

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---- 剧情列表 ----
app.get('/api/stories', wrap((req, res) => {
  res.json(storage.listStories());
}));

// ---- 新建剧情 ----
app.post('/api/stories', wrap((req, res) => {
  const record = storage.createStory(req.body || {});
  res.status(201).json(record);
}));

// ---- 读取剧情 ----
app.get('/api/stories/:id', wrap((req, res) => {
  const story = storage.getStory(req.params.id);
  if (!story) return res.status(404).json({ error: '剧情不存在' });
  res.json(story);
}));

// ---- 保存剧情 ----
app.put('/api/stories/:id', wrap((req, res) => {
  const record = storage.updateStory(req.params.id, req.body || {});
  res.json(record);
}));

// ---- 删除剧情 ----
app.delete('/api/stories/:id', wrap((req, res) => {
  storage.deleteStory(req.params.id);
  res.status(204).end();
}));

// ---- 分析剧情（不保存，直接对请求体中的剧情做分析，供编辑时实时检查） ----
app.post('/api/analyze', wrap((req, res) => {
  res.json(analyze(req.body || {}));
}));

// ---- 分析已保存的剧情 ----
app.get('/api/stories/:id/analysis', wrap((req, res) => {
  const story = storage.getStory(req.params.id);
  if (!story) return res.status(404).json({ error: '剧情不存在' });
  res.json(analyze(story));
}));

// ---- 导出 ----
app.get('/api/stories/:id/export', wrap((req, res) => {
  const story = storage.getStory(req.params.id);
  if (!story) return res.status(404).json({ error: '剧情不存在' });
  const filename = encodeURIComponent(`${story.id}.json`);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.send(JSON.stringify({ ...story, exportedAt: new Date().toISOString() }, null, 2));
}));

// SPA 回退
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ---- 错误处理 ----
app.use((err, req, res, next) => {
  const status = err.status || 400;
  res.status(status).json({ error: err.message || '服务器错误' });
});

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';

storage.ensureDataDir();
const seeded = storage.seedSamples();
if (seeded.length) console.log(`[seed] 已初始化示例剧情: ${seeded.join(', ')}`);

app.listen(PORT, HOST, () => {
  console.log(`分支剧情一致性审校应用已启动: http://${HOST}:${PORT}`);
  console.log(`数据目录: ${storage.DATA_DIR}`);
});

module.exports = app;
