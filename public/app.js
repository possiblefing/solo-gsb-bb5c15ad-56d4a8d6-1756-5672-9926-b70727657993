'use strict';

/* ============================== 状态 ============================== */

const state = {
  list: [],
  currentId: null,
  story: null,          // 编辑中的剧情模型
  dirty: false,
  report: null,
  collapsedScenes: new Set(),
  openIssues: new Set(),
  reportForId: null     // 报告对应的剧情 id（保存后联动用）
};

const $ = (sel) => document.querySelector(sel);

const els = {
  storySelect: $('#storySelect'),
  newStoryBtn: $('#newStoryBtn'),
  importBtn: $('#importBtn'),
  importFile: $('#importFile'),
  exportBtn: $('#exportBtn'),
  deleteBtn: $('#deleteBtn'),
  analyzeBtn: $('#analyzeBtn'),
  saveBtn: $('#saveBtn'),
  dirtyBadge: $('#dirtyBadge'),
  editorBody: $('#editorBody'),
  emptyHint: $('#emptyHint'),
  storyName: $('#storyName'),
  startScene: $('#startScene'),
  addVarBtn: $('#addVarBtn'),
  varList: $('#varList'),
  sceneList: $('#sceneList'),
  addSceneBtn: $('#addSceneBtn'),
  reportStats: $('#reportStats'),
  reportBody: $('#reportBody'),
  graphWrap: $('#graphWrap'),
  graphHost: $('#graphHost'),
  toast: $('#toast')
};

/* ============================== 工具 ============================== */

async function api(url, opts) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `请求失败 (${res.status})`);
  return data;
}

let toastTimer = null;
function toast(msg, kind = '') {
  els.toast.textContent = msg;
  els.toast.className = 'toast' + (kind ? ' ' + kind : '');
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { els.toast.hidden = true; }, 2600);
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function cid() {
  return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function emptyStory() {
  const s1 = 'scene_1';
  return {
    name: '未命名剧情',
    startScene: s1,
    variables: [{ name: 'flag', initial: false }],
    scenes: [{
      id: s1, title: '开场', text: '', precondition: '',
      options: []
    }]
  };
}

function markDirty() {
  state.dirty = true;
  els.dirtyBadge.hidden = false;
  els.saveBtn.disabled = false;
}

function clearDirty() {
  state.dirty = false;
  els.dirtyBadge.hidden = true;
  els.saveBtn.disabled = state.currentId == null;
}

/* ============================== 剧情列表 ============================== */

async function loadList(selectId) {
  state.list = await api('/api/stories');
  els.storySelect.innerHTML = '';
  if (state.list.length === 0) {
    const opt = document.createElement('option');
    opt.textContent = '（暂无剧情）';
    opt.value = '';
    els.storySelect.appendChild(opt);
  } else {
    for (const s of state.list) {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = `${s.name}（${s.sceneCount} 场景）`;
      els.storySelect.appendChild(opt);
    }
  }
  if (selectId && state.list.some((s) => s.id === selectId)) {
    els.storySelect.value = selectId;
  }
  updateChrome();
}

function updateChrome() {
  const has = state.story != null;
  els.editorBody.hidden = !has;
  els.emptyHint.hidden = has;
  els.analyzeBtn.disabled = !has;
  els.exportBtn.disabled = !has;
  els.deleteBtn.disabled = state.currentId == null;
  els.saveBtn.disabled = !has || !state.dirty;
  els.dirtyBadge.hidden = !state.dirty;
}

async function selectStory(id) {
  if (!id) {
    state.currentId = null;
    state.story = null;
    state.report = null;
    updateChrome();
    renderEditor();
    renderReport(null);
    return;
  }
  const record = await api(`/api/stories/${id}`);
  state.currentId = id;
  state.story = record.story;
  state.collapsedScenes.clear();
  state.openIssues.clear();
  clearDirty();
  renderEditor();
  await runAnalysis(false);
}

/* ============================== 编辑器渲染 ============================== */

function renderEditor() {
  if (!state.story) return;
  els.storyName.value = state.story.name;

  // 起始场景下拉
  const prevStart = state.story.startScene;
  els.startScene.innerHTML = state.story.scenes
    .map((s) => `<option value="${esc(s.id)}"${s.id === prevStart ? ' selected' : ''}>${esc(s.id)}${s.title ? ' — ' + esc(s.title) : ''}</option>`)
    .join('');

  renderVars();
  renderScenes();
}

function renderVars() {
  els.varList.innerHTML = '';
  state.story.variables.forEach((v, idx) => {
    const row = document.createElement('div');
    row.className = 'var-row';
    row.innerHTML = `
      <input class="var-name" data-idx="${idx}" value="${esc(v.name)}" placeholder="变量名 如 has_key" spellcheck="false" />
      <label class="switch">
        <input type="checkbox" data-idx="${idx}" ${v.initial ? 'checked' : ''} />
        初始 true
      </label>
      <button class="del-x" data-idx="${idx}" title="删除变量">✕</button>`;
    els.varList.appendChild(row);
  });

  els.varList.querySelectorAll('.var-name').forEach((input) => {
    input.addEventListener('change', (e) => {
      const idx = +e.target.dataset.idx;
      const newName = e.target.value.trim();
      const oldName = state.story.variables[idx].name;
      if (!newName) { e.target.value = oldName; return toast('变量名不能为空', 'error'); }
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(newName)) {
        e.target.value = oldName;
        return toast('变量名须以字母/下划线开头，仅含字母数字下划线', 'error');
      }
      if (state.story.variables.some((v, i) => i !== idx && v.name === newName)) {
        e.target.value = oldName;
        return toast('变量名重复', 'error');
      }
      state.story.variables[idx].name = newName;
      // 同步赋值中的变量引用
      for (const s of state.story.scenes) {
        for (const o of s.options) for (const a of o.assignments) if (a.variable === oldName) a.variable = newName;
      }
      markDirty();
    });
  });
  els.varList.querySelectorAll('input[type=checkbox]').forEach((cb) => {
    cb.addEventListener('change', (e) => {
      state.story.variables[+e.target.dataset.idx].initial = e.target.checked;
      markDirty();
    });
  });
  els.varList.querySelectorAll('.del-x').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const idx = +e.target.dataset.idx;
      const name = state.story.variables[idx].name;
      if (!confirm(`删除变量「${name}」？\n表达式中对它的引用会保留，但分析时按“未声明变量”告警。`)) return;
      state.story.variables.splice(idx, 1);
      markDirty();
      renderVars();
    });
  });
}

function renderScenes() {
  const rep = state.report;
  els.sceneList.innerHTML = '';
  state.story.scenes.forEach((scene, idx) => {
    const card = document.createElement('div');
    const collapsed = state.collapsedScenes.has(scene.id);
    card.className = 'scene-card ' + (collapsed ? 'collapsed ' : '');
    const st = rep && rep.sceneStatus ? rep.sceneStatus[scene.id] : null;
    card.classList.add(st ? (st.reachable ? 'reachable' : 'unreachable') : '');
    card.dataset.sceneId = scene.id;

    const badges = [];
    if (scene.id === state.story.startScene) badges.push('<span class="badge badge-start">起点</span>');
    if (st) {
      badges.push(st.reachable
        ? `<span class="badge badge-ok">可达 · ${st.stateCount} 状态</span>`
        : '<span class="badge badge-bad">不可达</span>');
    }

    card.innerHTML = `
      <div class="scene-head" data-act="toggle">
        <span class="scene-caret">▾</span>
        <input class="scene-id-input" value="${esc(scene.id)}" spellcheck="false" title="场景 id" />
        <span class="scene-title-mini">${esc(scene.title || '（无标题）')}</span>
        ${badges.join('')}
        <button class="del-x" data-act="del-scene" title="删除场景">✕</button>
      </div>
      <div class="scene-body">
        <input class="input scene-title" placeholder="场景标题（可选）" value="${esc(scene.title)}" />
        <textarea class="input scene-text" placeholder="场景正文（可选，仅做剧情记录）">${esc(scene.text)}</textarea>
        <div>
          <label class="field-label">进入前置条件（布尔表达式，留空 = 无条件）</label>
          <input class="input code-input scene-pre" placeholder="如 has_key && !door_locked" value="${esc(scene.precondition)}" spellcheck="false" />
          <p class="expr-hint">语法：变量名、! 非、&amp;&amp; / AND 与、|| / OR 或、括号；true / false</p>
        </div>
        <div class="opts-container"></div>
        <div class="opt-add-row"><button class="btn btn-small" data-act="add-opt">＋ 添加选项</button></div>
      </div>`;

    // 事件绑定
    const head = card.querySelector('.scene-head');
    head.addEventListener('click', (e) => {
      if (e.target.closest('input,button')) return;
      state.collapsedScenes.has(scene.id) ? state.collapsedScenes.delete(scene.id) : state.collapsedScenes.add(scene.id);
      card.classList.toggle('collapsed');
    });
    head.querySelector('[data-act="del-scene"]').addEventListener('click', (e) => {
      e.stopPropagation();
      if (state.story.scenes.length === 1) return toast('至少需要保留一个场景', 'error');
      if (!confirm(`删除场景「${scene.id}」及其全部选项？`)) return;
      deleteScene(idx);
    });
    head.querySelector('.scene-id-input').addEventListener('click', (e) => e.stopPropagation());
    head.querySelector('.scene-id-input').addEventListener('change', (e) => renameScene(idx, e.target));

    card.querySelector('.scene-title').addEventListener('input', (e) => { scene.title = e.target.value; markDirty(); });
    card.querySelector('.scene-text').addEventListener('input', (e) => { scene.text = e.target.value; markDirty(); });
    card.querySelector('.scene-pre').addEventListener('input', (e) => { scene.precondition = e.target.value; markDirty(); });
    card.querySelector('[data-act="add-opt"]').addEventListener('click', () => {
      scene.options.push({ clientId: cid(), label: `选项 ${scene.options.length + 1}`, condition: '', assignments: [], target: '' });
      markDirty();
      renderScenes();
    });

    // 选项
    const oc = card.querySelector('.opts-container');
    scene.options.forEach((opt, oi) => oc.appendChild(renderOption(scene, opt, oi, rep)));

    els.sceneList.appendChild(card);
  });
}

function renderOption(scene, opt, oi, rep) {
  const block = document.createElement('div');
  const ostatus = rep && rep.optionStatus ? rep.optionStatus[opt.clientId] : null;
  block.className = 'opt-block';
  if (ostatus && ostatus.dead && ostatus.reachStateCount > 0) block.classList.add('opt-dead');
  else if (ostatus && ostatus.blockedCount > 0) block.classList.add('opt-blocked');

  const varOptions = (selected) => {
    const opts = state.story.variables
      .map((v) => `<option value="${esc(v.name)}"${v.name === selected ? ' selected' : ''}>${esc(v.name)}</option>`)
      .join('');
    return `<option value=""${selected ? '' : ' selected'}>选择变量…</option>${opts}`;
  };
  const targetOptions = () => state.story.scenes
    .map((s) => `<option value="${esc(s.id)}"${s.id === opt.target ? ' selected' : ''}>${esc(s.id)}</option>`)
    .join('');

  let statusLine = '';
  if (ostatus && ostatus.reachStateCount > 0) {
    if (ostatus.dead) {
      statusLine = `<span class="opt-status bad">✗ 条件在 ${ostatus.reachStateCount} 个可达状态下恒不成立（死选项）</span>`;
    } else {
      const parts = [`${ostatus.satisfiedCount} 状态可见`];
      parts.push(ostatus.enteredCount > 0 ? `${ostatus.enteredCount} 状态成功跳转` : '无状态成功跳转');
      if (ostatus.blockedCount > 0) parts.push(`${ostatus.blockedCount} 状态被目标前置条件阻断`);
      statusLine = `<span class="opt-status ${ostatus.blockedCount > 0 ? 'warn' : ''}">${esc(parts.join(' · '))}</span>`;
    }
  } else if (ostatus && ostatus.neverOffered) {
    statusLine = '<span class="opt-status">所属场景不可达，选项永远不会出现</span>';
  }

  block.innerHTML = `
    <div class="opt-row">
      <label>选项文字</label>
      <input class="input opt-label" style="flex:1" value="${esc(opt.label)}" />
    </div>
    <div class="opt-row">
      <label>显示条件</label>
      <input class="input opt-cond code-input" placeholder="留空 = 始终可点，如 has_key || knows_password" value="${esc(opt.condition)}" spellcheck="false" />
    </div>
    <div class="opt-row">
      <label>跳转到</label>
      <select class="input opt-target"><option value=""${opt.target ? '' : ' selected'}>（结局 / 不跳转）</option>${targetOptions()}</select>
    </div>
    <div class="assign-row" data-role="assigns"></div>
    <div class="opt-foot">
      ${statusLine}
      <span>
        <button class="link-btn" data-act="add-assign">＋ 状态赋值</button>
        <button class="link-btn" data-act="del-opt" style="color:#ff9d9d">删除选项</button>
      </span>
    </div>`;

  block.querySelector('.opt-label').addEventListener('input', (e) => { opt.label = e.target.value; markDirty(); });
  block.querySelector('.opt-cond').addEventListener('input', (e) => { opt.condition = e.target.value; markDirty(); });
  block.querySelector('.opt-target').addEventListener('change', (e) => { opt.target = e.target.value; markDirty(); });
  block.querySelector('[data-act="del-opt"]').addEventListener('click', () => {
    scene.options.splice(oi, 1);
    markDirty();
    renderScenes();
  });
  block.querySelector('[data-act="add-assign"]').addEventListener('click', () => {
    opt.assignments.push({ variable: state.story.variables[0] ? state.story.variables[0].name : '', value: true });
    markDirty();
    renderScenes();
  });

  const assignsHost = block.querySelector('[data-role="assigns"]');
  opt.assignments.forEach((a, ai) => {
    const chip = document.createElement('span');
    chip.className = 'assign-chip';
    chip.innerHTML = `
      <select data-role="a-var">${varOptions(a.variable)}</select>
      <span>=</span>
      <select data-role="a-val">
        <option value="true"${a.value ? ' selected' : ''}>true</option>
        <option value="false"${a.value ? '' : ' selected'}>false</option>
      </select>
      <button class="del-x" data-role="a-del">✕</button>`;
    chip.querySelector('[data-role="a-var"]').addEventListener('change', (e) => { a.variable = e.target.value; markDirty(); });
    chip.querySelector('[data-role="a-val"]').addEventListener('change', (e) => { a.value = e.target.value === 'true'; markDirty(); });
    chip.querySelector('[data-role="a-del"]').addEventListener('click', () => {
      opt.assignments.splice(ai, 1);
      markDirty();
      renderScenes();
    });
    assignsHost.appendChild(chip);
  });

  return block;
}

function deleteScene(idx) {
  const scene = state.story.scenes[idx];
  state.story.scenes.splice(idx, 1);
  for (const s of state.story.scenes) {
    for (const o of s.options) if (o.target === scene.id) o.target = '';
  }
  if (state.story.startScene === scene.id) state.story.startScene = state.story.scenes[0].id;
  state.collapsedScenes.delete(scene.id);
  markDirty();
  renderEditor();
}

function renameScene(idx, input) {
  const scene = state.story.scenes[idx];
  const newId = input.value.trim();
  if (!/^[A-Za-z0-9_\-]+$/.test(newId) || !newId) {
    input.value = scene.id;
    return toast('场景 id 仅允许字母、数字、下划线、连字符', 'error');
  }
  if (state.story.scenes.some((s, i) => i !== idx && s.id === newId)) {
    input.value = scene.id;
    return toast('场景 id 重复', 'error');
  }
  const old = scene.id;
  scene.id = newId;
  if (state.story.startScene === old) state.story.startScene = newId;
  for (const s of state.story.scenes) for (const o of s.options) if (o.target === old) o.target = newId;
  state.collapsedScenes.delete(old);
  markDirty();
  renderEditor();
}

/* ============================== 分析 ============================== */

async function runAnalysis(showToast = true) {
  if (!state.story) return;
  try {
    state.report = await api('/api/analyze', {
      method: 'POST',
      body: JSON.stringify(cleanStoryForSave())
    });
  } catch (e) {
    toast('分析失败：' + e.message, 'error');
    return;
  }
  renderReport(state.report);
  renderScenes();
  if (showToast) toast('分析完成', 'ok');
}

/** 保存用结构：变量数组、选项去掉 clientId（导入导出干净） */
function cleanStoryForSave() {
  return {
    format: 'branching-story/v1',
    name: state.story.name,
    startScene: state.story.startScene,
    variables: state.story.variables.map((v) => ({ name: v.name, initial: !!v.initial })),
    scenes: state.story.scenes.map((s) => ({
      id: s.id,
      title: s.title || '',
      text: s.text || '',
      precondition: s.precondition || '',
      options: s.options.map((o) => ({
        label: o.label,
        condition: o.condition || '',
        assignments: o.assignments.filter((a) => a.variable).map((a) => ({ variable: a.variable, value: !!a.value })),
        target: o.target || ''
      }))
    }))
  };
}

async function saveAndAnalyze() {
  if (!state.story) return;
  const payload = cleanStoryForSave();
  try {
    let id = state.currentId;
    if (id) {
      await api(`/api/stories/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
    } else {
      const rec = await api('/api/stories', { method: 'POST', body: JSON.stringify(payload) });
      id = rec.id;
      state.currentId = id;
    }
    clearDirty();
    await loadList(id);
    await runAnalysis(false);
    toast('已保存并完成分析', 'ok');
  } catch (e) {
    toast('保存失败：' + e.message, 'error');
  }
}

/* ============================== 报告渲染 ============================== */

const KIND_LABEL = {
  unreachable: '不可达场景',
  'dead-option': '死选项',
  'blocked-transition': '阻断跳转',
  syntax: '语法错误',
  'bad-target': '跳转目标',
  'unknown-var': '未声明变量',
  structure: '结构错误',
  'start-blocked': '起点受阻'
};

function renderReport(rep) {
  if (!rep) {
    els.reportBody.innerHTML = '<div class="empty-hint"><p>保存或点击「重新分析」后在此展示问题。</p></div>';
    els.reportStats.innerHTML = '';
    els.graphWrap.hidden = true;
    els.graphHost.innerHTML = '';
    return;
  }

  const { summary, propagation } = rep;
  const statusLabel = summary.status === 'ok' ? '✓ 无问题' : summary.status === 'warning' ? '存在警告' : '存在错误';
  const statusCls = summary.status === 'ok' ? 'ok' : summary.status === 'warning' ? 'warn' : 'error';
  els.reportStats.innerHTML = `
    <span class="stat ${statusCls}">${statusLabel}</span>
    <span class="stat error">错误 <strong>${summary.errorCount}</strong></span>
    <span class="stat warn">警告 <strong>${summary.warningCount}</strong></span>
    <span class="stat">场景 <strong>${summary.sceneCount}</strong></span>
    <span class="stat">变量 <strong>${summary.variableCount}</strong></span>`;

  let html = '';
  if (propagation) {
    const bound = propagation.upperBoundCapped
      ? `场景数 × 2^${propagation.variables.length}（变量较多不做全枚举，传播按实际可达状态惰性扩展）`
      : `<code>${propagation.upperBound}</code>`;
    html += `<div class="prop-meta">
      状态空间传播：共产生 <code>${propagation.nodeCount}</code> 个「场景 + 变量快照」节点
      （理论上界 场景数 × 2^变量数 = ${bound}），
      重复节点被去重，因此含循环的剧情分析也保证终止。
    </div>`;
  }

  const order = { error: 0, warning: 1 };
  const issues = [...rep.issues].sort((a, b) => order[a.severity] - order[b.severity]);
  if (issues.length === 0) {
    html += '<div class="empty-hint" style="padding:24px"><p style="color:var(--ok);font-size:15px">✓ 全部场景可达，所有选项均可在某些可达状态下成立。</p></div>';
  }

  for (const iss of issues) {
    const open = state.openIssues.has(iss.id);
    html += `
      <div class="issue severity-${iss.severity}" data-issue-id="${esc(iss.id)}">
        <button class="issue-main" data-act="toggle-issue">
          <span class="issue-kind kind-${iss.kind}">${esc(KIND_LABEL[iss.kind] || iss.kind)}</span>
          <span>${esc(iss.message)}</span>
          <span class="issue-caret">${open ? '▴' : '▾'}</span>
        </button>
        <div class="issue-detail" ${open ? '' : 'hidden'} data-role="detail"></div>
      </div>`;
  }
  els.reportBody.innerHTML = html;

  // 绑定展开 + 填充详情（惰性渲染，避免一次性大量 DOM）
  els.reportBody.querySelectorAll('.issue').forEach((card) => {
    const id = card.dataset.issueId;
    card.querySelector('[data-act="toggle-issue"]').addEventListener('click', () => {
      const iss = rep.issues.find((x) => x.id === id);
      const box = card.querySelector('[data-role="detail"]');
      if (box.hidden) {
        state.openIssues.add(id);
        box.hidden = false;
        box.innerHTML = renderIssueDetail(iss);
        bindDetailEvents(box);
        card.querySelector('.issue-caret').textContent = '▴';
      } else {
        state.openIssues.delete(id);
        box.hidden = true;
        card.querySelector('.issue-caret').textContent = '▾';
      }
    });
    if (state.openIssues.has(id)) {
      const box = card.querySelector('[data-role="detail"]');
      box.hidden = false;
      box.innerHTML = renderIssueDetail(rep.issues.find((x) => x.id === id));
      bindDetailEvents(box);
    }
  });

  renderGraph(rep);
}

/* ---------- 详情内容 ---------- */

function stateChips(entries, flipSet) {
  if (!entries || entries.length === 0) return '<p class="meta-note">（无变量）</p>';
  return `<div class="state-chips">${entries.map((e) => {
    const flip = flipSet && flipSet.has(e.variable);
    return `<span class="state-chip ${e.value ? 'true' : ''} ${flip ? 'flip' : ''}" title="${flip ? '与示例状态不同的建议取值' : ''}">${esc(e.variable)} = ${e.value}</span>`;
  }).join('')}</div>`;
}

function section(title, inner) {
  return `<div class="detail-section"><h4>${esc(title)}</h4>${inner}</div>`;
}

function reasonList(reasons, warn = false) {
  if (!reasons || reasons.length === 0) return '';
  return `<ul class="reason-list ${warn ? 'warn' : ''}">${reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>`;
}

/**
 * 渲染路径：reachablePrefix 为真实可达节点；suffix（可选）为断掉之后的场景链。
 */
function pathChain(prefix, suffix, blockers) {
  const blockEdgeKeys = new Set((blockers || []).map((b) => `${b.fromSceneId}>${b.toSceneId}`));
  const nodes = [];
  prefix.forEach((n, i) => {
    nodes.push({ ...n, part: 'prefix' });
  });
  (suffix || []).forEach((n) => nodes.push({ sceneId: n.sceneId, title: n.title, viaOption: n.viaOption, part: 'suffix' }));

  let html = '<div class="path-chain">';
  nodes.forEach((n, i) => {
    if (i > 0) {
      const edgeKey = `${nodes[i - 1].sceneId}>${n.sceneId}`;
      const blocked = blockEdgeKeys.has(edgeKey) || (n.part === 'suffix' && i === prefix.length);
      html += `<span class="path-edge ${blocked ? 'blocked' : ''}">
        <span class="edge-opt" title="${esc(n.viaOption || '')}">${esc(n.viaOption || '')}</span>
        <span class="path-arrow">${blocked ? '⇢✗' : '→'}</span>
      </span>`;
    }
    html += `<span class="path-node ${n.isStart ? 'start' : ''} ${n.part === 'suffix' ? 'suffix' : ''}"
      data-jump-scene="${esc(n.sceneId)}" title="点击定位到场景">${esc(n.sceneId)}</span>`;
  });
  html += '</div>';
  return html;
}

function renderIssueDetail(iss) {
  const d = iss.detail || {};
  let html = '';

  if (iss.kind === 'unreachable') {
    html += `<p class="meta-note">${esc(d.reason || '')}</p>`;
    if (d.reachablePrefix && d.reachablePrefix.length) {
      html += section('① 最近的可达路径（点击节点可定位场景）',
        pathChain(d.reachablePrefix, d.blockedSuffix, d.blockers));
    }
    if (d.blockers && d.blockers.length) {
      const b = d.blockers[0];
      html += section(b.stage === 'option-condition'
        ? '② 未满足的选项条件（通往该场景的选项无法出现）'
        : '② 未满足的目标场景前置条件（选项可点，但无法进入）',
        `<span class="code-expr">${esc(b.expression)}</span>${reasonList(b.reasons)}`);
      if (b.stage === 'option-condition') {
        html += '<p class="meta-note">该条件成立后才会经过选项「' + esc(b.optionLabel) + '」继续前进。</p>';
      }
    }
    if (!d.reachablePrefix || !d.reachablePrefix.length) {
      if (d.inboundScenes && d.inboundScenes.length) {
        html += section('指向它的场景（它们本身也不可达）',
          '<ul class="reason-list">' + d.inboundScenes.map((x) => `<li>来自「${esc(x.sceneId)}」的选项「${esc(x.optionLabel)}」</li>`).join('') + '</ul>');
      }
    }
    if (d.targetPrecondition) {
      html += section('该场景自身的前置条件',
        `<span class="code-expr">${esc(d.targetPrecondition.expression)}</span>`);
    }
  } else if (iss.kind === 'dead-option') {
    html += section('选项条件（在所有可达状态下恒为 false）',
      `<span class="code-expr">${esc(d.expression)}</span>`);
    html += section('① 最近的可达路径（点击节点可定位场景）',
      pathChain(d.reachablePrefix, null, null));
    html += section('② 该场景可达状态示例 —— 条件为何不成立（未满足项）',
      stateChips(d.sampleState) + reasonList(d.reasons, true));
    const sat = d.satisfiability || {};
    if (sat.checked) {
      if (sat.contradiction) {
        html += section('③ 可满足性判定', '<p class="meta-note"><span class="hl">条件自相矛盾</span>，任何变量取值都无法使其成立，需修改条件逻辑。</p>');
      } else if (sat.suggestedFlips && sat.suggestedFlips.length) {
        const flipSet = new Set(sat.suggestedFlips.map((f) => f.variable));
        html += section('③ 可满足性判定：条件可以成立',
          `<p class="meta-note">存在使条件成立的取值。相对上面的可达状态，<span class="hl">最少只需改变以下变量</span>，但现有剧情路径都不会做出这些赋值：</p>`
          + stateChips(d.sampleState, flipSet)
          + '<ul class="reason-list warn">' + sat.suggestedFlips.map((f) => `<li>${esc(f.variable)}: ${f.from} → ${f.to}</li>`).join('') + '</ul>');
      } else if (sat.satisfiable) {
        html += section('③ 可满足性判定', '<p class="meta-note">条件在当前可达状态下<span class="hl-ok">已具备成立所需的全部取值组合之一</span>，但传播未抵达——请检查上游选项的可达性。</p>');
      }
    }
  } else if (iss.kind === 'blocked-transition') {
    const via = d.optionLabel || '';
    html += section('① 最近的可达路径（点击节点可定位场景）',
      pathChain(d.reachablePrefix, [{ sceneId: d.targetSceneId, title: '', viaOption: via }],
        [{ fromSceneId: d.reachablePrefix[d.reachablePrefix.length - 1].sceneId, toSceneId: d.targetSceneId }]));
    if (via) html += `<p class="meta-note">通过选项「${esc(via)}」跳转并应用其状态赋值后：</p>`;
    html += section('② 执行选项赋值后的变量状态', stateChips(d.stateAfterAssignment));
    html += section('③ 未满足的目标场景「' + esc(d.targetSceneId) + '」前置条件',
      `<span class="code-expr">${esc(d.targetExpression)}</span>${reasonList(d.reasons)}`);
  } else if (iss.kind === 'start-blocked') {
    html += section('初始变量状态', stateChips(d.initialState));
    html += section('未满足的起点前置条件',
      `<span class="code-expr">${esc(d.expression)}</span>${reasonList(d.reasons)}`);
  } else {
    html += `<p class="meta-note">请在左侧编辑器中修正对应内容后重新分析。</p>`;
    if (iss.target) html += `<p class="meta-note">相关目标：<code>${esc(iss.target)}</code></p>`;
  }
  return html;
}

function bindDetailEvents(box) {
  box.querySelectorAll('[data-jump-scene]').forEach((node) => {
    node.addEventListener('click', () => jumpToScene(node.dataset.jumpScene));
  });
}

function jumpToScene(sceneId) {
  const card = els.sceneList.querySelector(`[data-scene-id="${CSS.escape(sceneId)}"]`);
  if (!card) return toast('该场景不在当前编辑内容中', 'error');
  state.collapsedScenes.delete(sceneId);
  renderScenes();
  const el = els.sceneList.querySelector(`[data-scene-id="${CSS.escape(sceneId)}"]`);
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  el.animate(
    [{ boxShadow: '0 0 0 2px var(--primary)' }, { boxShadow: '0 0 0 0 transparent' }],
    { duration: 1600 }
  );
}

/* ============================== 可达图（SVG 自动布局） ============================== */

function renderGraph(rep) {
  if (!rep.propagation || !state.story) { els.graphWrap.hidden = true; return; }
  els.graphWrap.hidden = false;

  const scenes = state.story.scenes;
  const reach = rep.sceneStatus || {};
  const ostat = rep.optionStatus || {};
  const start = state.story.startScene;

  // BFS 分层（忽略边是否可通过；不可达分量放到最底层）
  const levelOf = new Map();
  const q = scenes.some((s) => s.id === start) ? [start] : [];
  levelOf.set(start, 0);
  for (let i = 0; i < q.length; i++) {
    const cur = scenes.find((s) => s.id === q[i]);
    if (!cur) continue;
    for (const o of cur.options) {
      if (o.target && !levelOf.has(o.target)) {
        levelOf.set(o.target, levelOf.get(cur.id) + 1);
        q.push(o.target);
      }
    }
  }
  const orphans = scenes.filter((s) => !levelOf.has(s.id));
  const maxLevel = Math.max(0, ...[...levelOf.values()]);
  orphans.forEach((s, i) => levelOf.set(s.id, maxLevel + 1 + (i % 3 === 0 ? 1 : 0)));

  const layers = new Map();
  for (const s of scenes) {
    const lv = levelOf.get(s.id);
    if (!layers.has(lv)) layers.set(lv, []);
    layers.get(lv).push(s.id);
  }

  const W_NODE = 168, H_NODE = 44, DX = 60, DY = 96, PAD = 40;
  const positions = new Map();
  const levelKeys = [...layers.keys()].sort((a, b) => a - b);
  const maxCount = Math.max(...[...layers.values()].map((l) => l.length));
  const svgW = Math.max(640, maxCount * (W_NODE + DX) + PAD * 2);

  levelKeys.forEach((lv) => {
    const ids = layers.get(lv);
    const totalW = ids.length * W_NODE + (ids.length - 1) * DX;
    ids.forEach((id, i) => {
      positions.set(id, { x: (svgW - totalW) / 2 + i * (W_NODE + DX), y: PAD + lv * (H_NODE + DY) });
    });
  });
  const svgH = (levelKeys[levelKeys.length - 1] || 0) * (H_NODE + DY) + H_NODE + PAD * 2;

  // 边
  let edgesSvg = '';
  const arrowMarkers = `
    <defs>
      <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M0,0 L10,5 L0,10 z" fill="#55709f"/></marker>
      <marker id="arrow-b" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M0,0 L10,5 L0,10 z" fill="#f0b452"/></marker>
      <marker id="arrow-g" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M0,0 L10,5 L0,10 z" fill="#5c3a48"/></marker>
    </defs>`;

  for (const s of scenes) {
    const p1 = positions.get(s.id);
    s.options.forEach((o) => {
      if (!o.target || !positions.has(o.target)) return;
      const p2 = positions.get(o.target);
      const cls = edgeClass(s, o, reach, ostat);
      const marker = cls === 'blocked' ? 'arrow-b' : cls === 'reachable' ? 'arrow' : 'arrow-g';
      const midX = (p1.x + p2.x) / 2;
      const midY = (p1.y + p2.y) / 2 - 12;
      const sameLevel = p1.y === p2.y;
      const c1x = p1.x, c1y = p1.y + (sameLevel ? 70 : 40);
      const c2x = p2.x, c2y = p2.y - (sameLevel ? 70 : 40);
      const d = `M ${p1.x + W_NODE / 2} ${p1.y + H_NODE}
                 C ${c1x + W_NODE / 2} ${c1y + H_NODE}, ${c2x + W_NODE / 2} ${c2y}, ${p2.x + W_NODE / 2} ${p2.y}`;
      const label = o.label.length > 7 ? o.label.slice(0, 7) + '…' : o.label;
      edgesSvg += `<path class="g-edge ${cls}" d="${d}" marker-end="url(#${marker})"></path>`;
      edgesSvg += `<text class="g-edge-label" x="${midX}" y="${midY}" text-anchor="middle">${esc(label)}</text>`;
    });
  }

  let nodesSvg = '';
  for (const s of scenes) {
    const p = positions.get(s.id);
    const r = reach[s.id];
    const cls = r && r.reachable ? 'reachable' : 'unreachable';
    const title = (s.title || s.id).length > 16 ? (s.title || s.id).slice(0, 16) + '…' : (s.title || s.id);
    nodesSvg += `
      <g class="g-node ${cls}" data-jump-scene="${esc(s.id)}">
        <rect x="${p.x}" y="${p.y}" width="${W_NODE}" height="${H_NODE}" rx="8" />
        <text x="${p.x + 10}" y="${p.y + 18}">${esc(s.id)}</text>
        <text class="g-title" x="${p.x + 10}" y="${p.y + 35}">${esc(title)}</text>
      </g>`;
  }

  els.graphHost.innerHTML = `
    <svg width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}" xmlns="http://www.w3.org/2000/svg">
      ${arrowMarkers}${edgesSvg}${nodesSvg}
    </svg>`;
  els.graphHost.querySelectorAll('[data-jump-scene]').forEach((g) => {
    g.addEventListener('click', () => jumpToScene(g.dataset.jumpScene));
  });
}

function edgeClass(scene, opt, reach, ostat) {
  const st = ostat[opt.clientId];
  const srcReach = reach[scene.id] && reach[scene.id].reachable;
  const dstReach = reach[opt.target] && reach[opt.target].reachable;
  if (!srcReach || !dstReach) return 'unreachable';
  if (st && st.blockedCount > 0 && st.enteredCount === 0) return 'blocked';
  if (st && st.dead) return 'unreachable';
  return 'reachable';
}

/* ============================== 导入 / 导出 ============================== */

function importJson(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let data;
    try {
      data = JSON.parse(reader.result);
    } catch (e) {
      return toast('不是合法的 JSON 文件', 'error');
    }
    const storyData = data.format === 'branching-story/v1' ? data : data.story || data;
    if (!storyData || !Array.isArray(storyData.scenes)) {
      return toast('文件中未找到 scenes 数组，格式不正确', 'error');
    }
    if (state.dirty && !confirm('当前有未保存修改，导入将替换编辑器内容（仍会保留旧剧情于服务端）。继续？')) return;
    api('/api/import', { method: 'POST', body: JSON.stringify(data) })
      .then((rec) => loadList(rec.id).then(() => selectStory(rec.id)))
      .then(() => toast('导入成功', 'ok'))
      .catch((e) => toast('导入失败：' + e.message, 'error'));
  };
  reader.readAsText(file);
}

function exportJson() {
  const payload = cleanStoryForSave();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (payload.name || 'story').replace(/[\\/:*?"<>|\s]+/g, '_') + '.json';
  a.click();
  URL.revokeObjectURL(url);
}

/* ============================== 顶部交互绑定 ============================== */

els.storySelect.addEventListener('change', (e) => {
  if (state.dirty && !confirm('有未保存修改，切换剧情将丢弃它们。继续？')) {
    e.target.value = state.currentId || '';
    return;
  }
  selectStory(e.target.value || null);
});

els.newStoryBtn.addEventListener('click', () => {
  if (state.dirty && !confirm('有未保存修改，确定新建剧情？')) return;
  state.currentId = null;
  state.story = emptyStory();
  state.report = null;
  state.collapsedScenes.clear();
  state.openIssues.clear();
  els.storySelect.value = '';
  clearDirty();
  updateChrome();
  renderEditor();
  renderReport(null);
});

els.importBtn.addEventListener('click', () => els.importFile.click());
els.importFile.addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (f) importJson(f);
  e.target.value = '';
});

els.exportBtn.addEventListener('click', exportJson);

els.deleteBtn.addEventListener('click', async () => {
  if (!state.currentId) return;
  if (!confirm('从服务端删除该剧情？不可恢复。')) return;
  try {
    await api(`/api/stories/${state.currentId}`, { method: 'DELETE' });
    state.currentId = null;
    state.story = null;
    state.report = null;
    await loadList();
    await selectStory(null);
    toast('已删除', 'ok');
  } catch (e) {
    toast('删除失败：' + e.message, 'error');
  }
});

els.analyzeBtn.addEventListener('click', () => runAnalysis(true));
els.saveBtn.addEventListener('click', saveAndAnalyze);

els.storyName.addEventListener('input', (e) => { state.story.name = e.target.value; markDirty(); });
els.startScene.addEventListener('change', (e) => { state.story.startScene = e.target.value; markDirty(); renderScenes(); });
els.addVarBtn.addEventListener('click', () => {
  let name = 'var_' + (state.story.variables.length + 1);
  let i = 1;
  while (state.story.variables.some((v) => v.name === name)) name = 'var_' + (++i + state.story.variables.length);
  state.story.variables.push({ name, initial: false });
  markDirty();
  renderVars();
});
els.addSceneBtn.addEventListener('click', () => {
  let id = 'scene_' + (state.story.scenes.length + 1);
  let i = 1;
  while (state.story.scenes.some((s) => s.id === id)) id = 'scene_' + (++i + state.story.scenes.length);
  state.story.scenes.push({ id, title: '', text: '', precondition: '', options: [] });
  state.collapsedScenes.delete(id);
  markDirty();
  renderScenes();
  const card = els.sceneList.querySelector(`[data-scene="${id}"], [data-scene-id="${id}"]`);
  if (card) card.scrollIntoView({ behavior: 'smooth', block: 'end' });
});

// Ctrl/Cmd+S 保存
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    if (!els.saveBtn.disabled) saveAndAnalyze();
  }
});

/* ============================== 启动 ============================== */

(async function init() {
  try {
    await loadList();
    if (state.list.length > 0) await selectStory(state.list[0].id);
    else updateChrome();
  } catch (e) {
    toast('初始化失败：' + e.message, 'error');
  }
})();
