'use strict';

/**
 * 剧情一致性分析引擎
 *
 * 核心思想 —— 有限状态空间上的可达性传播：
 *   每个状态节点 = (场景 id, 全量布尔变量快照)
 *   场景内按选项依次跳转，跳转时应用选项的状态赋值，得到目标场景的新状态节点。
 *   用集合 key 去重。场景数 S、变量数 V 时状态节点总数 ≤ S × 2^V，必有上界，
 *   因此即使剧情含自循环/回头路，BFS 也一定终止。
 *
 * 诊断三类问题：
 *   unreachable       不可达场景（从起点任何状态都到不了）
 *   dead-option       选项条件在所有可达状态下恒不成立（玩家永远看不到/选不到）
 *   blocked-transition 选项可被看到且条件成立，但跳转过去时目标场景前置条件不满足
 * 另有 error/warning 级别的结构问题（语法错误、未声明变量、坏跳转 id）。
 */

const { parseExpression, evalAst, collectVars, prettyAst, explain } = require('./expression');

const MAX_VARS_FOR_SAT = 18; // 可满足性枚举的变量数保护

/* ------------------------------------------------------------------ */
/* 输入规范化                                                           */
/* ------------------------------------------------------------------ */

function normalizeStory(input) {
  const raw = input && typeof input === 'object' ? input : {};
  const name = String(raw.name == null ? '未命名剧情' : raw.name).slice(0, 200);

  const variables = {};
  if (Array.isArray(raw.variables)) {
    for (const item of raw.variables) {
      if (typeof item === 'string') {
        variables[item] = false;
      } else if (item && typeof item === 'object') {
        const key = String(item.name == null ? '' : item.name);
        if (key) variables[key] = item.initial === true;
      }
    }
  } else if (raw.variables && typeof raw.variables === 'object') {
    for (const [k, v] of Object.entries(raw.variables)) {
      variables[String(k)] = v === true;
    }
  }

  const scenes = (Array.isArray(raw.scenes) ? raw.scenes : []).map((s, idx) => {
    const scene = s && typeof s === 'object' ? s : {};
    return {
      id: String(scene.id == null ? `scene_${idx + 1}` : scene.id),
      title: String(scene.title == null ? '' : scene.title),
      text: String(scene.text == null ? '' : scene.text),
      precondition: String(scene.precondition == null ? '' : scene.precondition),
      options: (Array.isArray(scene.options) ? scene.options : []).map((o, oidx) => {
        const opt = o && typeof o === 'object' ? o : {};
        let assignments = [];
        if (Array.isArray(opt.assignments)) {
          assignments = opt.assignments.map((a) => {
            if (a && typeof a === 'object') {
              return { variable: String(a.variable == null ? '' : a.variable), value: a.value === true };
            }
            return { variable: String(a), value: true };
          });
        } else if (opt.assign && typeof opt.assign === 'object') {
          assignments = Object.entries(opt.assign).map(([variable, value]) => ({
            variable: String(variable),
            value: value === true
          }));
        }
        return {
          clientId: opt.clientId ? String(opt.clientId) : `opt_${idx + 1}_${oidx + 1}`,
          label: String(opt.label == null ? `选项 ${oidx + 1}` : opt.label),
          condition: String(opt.condition == null ? '' : opt.condition),
          assignments,
          target: String(opt.target == null ? '' : opt.target)
        };
      })
    };
  });

  const startScene = String(raw.startScene == null ? (scenes[0] && scenes[0].id) || '' : raw.startScene);
  return { name, variables, scenes, startScene };
}

/* ------------------------------------------------------------------ */
/* 工具                                                                 */
/* ------------------------------------------------------------------ */

function stateKey(state, vars) {
  let k = '';
  for (let i = 0; i < vars.length; i++) k += state[vars[i]] ? '1' : '0';
  return k;
}

function applyAssignments(state, assignments) {
  const next = { ...state };
  for (const a of assignments) {
    if (a.variable) next[a.variable] = a.value;
  }
  return next;
}

function stateEntries(state, vars) {
  return vars.map((v) => ({ variable: v, value: state[v] === true }));
}

/** 在 relevant 变量上枚举所有布尔组合（≤ 2^MAX_VARS_FOR_SAT）。 */
function enumerateStates(vars, baseState) {
  if (vars.length > MAX_VARS_FOR_SAT) return null;
  const out = [];
  const total = 1 << vars.length;
  for (let mask = 0; mask < total; mask++) {
    const s = { ...baseState };
    vars.forEach((v, i) => {
      s[v] = ((mask >> i) & 1) === 1;
    });
    out.push(s);
  }
  return out;
}

function hamming(aKey, bKey) {
  let d = 0;
  for (let i = 0; i < aKey.length; i++) if (aKey[i] !== bKey[i]) d++;
  return d;
}

/* ------------------------------------------------------------------ */
/* 主分析入口                                                           */
/* ------------------------------------------------------------------ */

function analyze(rawStory) {
  const story = normalizeStory(rawStory);
  const varNames = Object.keys(story.variables);
  const issues = [];
  let seq = 0;
  const addIssue = (i) => {
    issues.push({ id: `ISSUE-${++seq}`, ...i });
  };

  /* ---------- 硬性结构校验 ---------- */
  const hardErrors = [];

  if (!Array.isArray(rawStory.scenes) || rawStory.scenes.length === 0) {
    hardErrors.push('剧情至少需要一个场景');
  }

  const identOk = new Set();
  for (const v of varNames) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(v)) {
      hardErrors.push(`变量名不合法："${v}"（须以字母或下划线开头，仅含字母数字下划线）`);
    } else {
      identOk.add(v);
    }
  }
  if (new Set(varNames.map((v) => v.toLowerCase())).size !== varNames.length) {
    hardErrors.push('存在重名变量（变量名大小写不敏感）');
  }

  const sceneIds = new Set();
  for (const s of story.scenes) {
    if (!s.id.trim()) hardErrors.push('存在没有 id 的场景');
    else if (sceneIds.has(s.id)) hardErrors.push(`场景 id 重复："${s.id}"`);
    else if (!/^[A-Za-z0-9_\-]+$/.test(s.id)) {
      hardErrors.push(`场景 id 不合法："${s.id}"（仅允许字母、数字、下划线、连字符）`);
    }
    sceneIds.add(s.id);
  }

  if (!story.startScene) {
    hardErrors.push('未指定起始场景');
  } else if (!sceneIds.has(story.startScene)) {
    hardErrors.push(`起始场景不存在："${story.startScene}"`);
  }

  if (hardErrors.length) {
    hardErrors.forEach((message) => addIssue({ severity: 'error', kind: 'structure', message }));
    return buildReport(story, varNames, issues, null);
  }

  /* ---------- 解析全部表达式 ---------- */
  const sceneAst = new Map(); // sceneId -> ast
  let syntaxErrorCount = 0;

  for (const s of story.scenes) {
    const r = parseExpression(s.precondition);
    if (r.ok) {
      sceneAst.set(s.id, r.ast);
      for (const v of collectVars(r.ast)) {
        if (!identOk.has(v)) {
          addIssue({
            severity: 'warning',
            kind: 'unknown-var',
            sceneId: s.id,
            message: `场景「${s.id}」前置条件引用了未声明变量 ${v}（求值时按 false 处理）`
          });
        }
      }
    } else {
      syntaxErrorCount++;
      addIssue({
        severity: 'error',
        kind: 'syntax',
        sceneId: s.id,
        location: 'scene-precondition',
        message: `场景「${s.id}」前置条件语法错误：${r.error}`
      });
    }
  }

  // 选项 AST 与坏跳转
  const optionAst = new Map(); // clientId -> ast
  for (const s of story.scenes) {
    for (const o of s.options) {
      const r = parseExpression(o.condition);
      if (r.ok) {
        optionAst.set(o.clientId, r.ast);
        for (const v of collectVars(r.ast)) {
          if (!identOk.has(v)) {
            addIssue({
              severity: 'warning',
              kind: 'unknown-var',
              sceneId: s.id,
              optionClientId: o.clientId,
              message: `场景「${s.id}」选项「${o.label}」条件引用了未声明变量 ${v}（求值时按 false 处理）`
            });
          }
        }
      } else {
        syntaxErrorCount++;
        addIssue({
          severity: 'error',
          kind: 'syntax',
          sceneId: s.id,
          optionClientId: o.clientId,
          location: 'option-condition',
          message: `场景「${s.id}」选项「${o.label}」条件语法错误：${r.error}`
        });
      }
      for (const a of o.assignments) {
        if (a.variable && !identOk.has(a.variable)) {
          addIssue({
            severity: 'warning',
            kind: 'unknown-var',
            sceneId: s.id,
            optionClientId: o.clientId,
            message: `场景「${s.id}」选项「${o.label}」对未声明变量 ${a.variable} 赋值（不影响声明变量）`
          });
        }
      }
      if (o.target && !sceneIds.has(o.target)) {
        addIssue({
          severity: 'error',
          kind: 'bad-target',
          sceneId: s.id,
          optionClientId: o.clientId,
          target: o.target,
          message: `场景「${s.id}」选项「${o.label}」跳转到不存在的场景「${o.target}」`
        });
      }
      if (!o.target) {
        addIssue({
          severity: 'warning',
          kind: 'bad-target',
          sceneId: s.id,
          optionClientId: o.clientId,
          message: `场景「${s.id}」选项「${o.label}」没有设置跳转目标（视为结局）`
        });
      }
    }
  }

  if (syntaxErrorCount > 0) {
    return buildReport(story, varNames, issues, null);
  }

  /* ---------- 状态空间 BFS ---------- */
  const initialState = {};
  for (const v of varNames) initialState[v] = story.variables[v] === true;

  const startAst = sceneAst.get(story.startScene);
  const startOk = evalAst(startAst, initialState);

  // nodeStore: key -> { key, sceneId, state, depth, pred: {fromKey, optionClientId, label} | null }
  const nodeStore = new Map();
  const sceneKeys = new Map(); // sceneId -> Set<key>
  // option 可达统计
  const optSeen = new Map(); // clientId -> { states:Set<key>, trueKeys:Set<key>, enteredKeys:Set<key>, blocked:Map<destKey, info> }
  const ensureOpt = (id) => {
    if (!optSeen.has(id)) {
      optSeen.set(id, { states: new Set(), trueKeys: new Set(), enteredKeys: new Set(), blocked: new Map() });
    }
    return optSeen.get(id);
  };

  const queue = [];
  const enqueue = (sceneId, state, depth, pred) => {
    const key = `${sceneId}::${stateKey(state, varNames)}`;
    if (nodeStore.has(key)) return null;
    const node = { key, sceneId, state, depth, pred };
    nodeStore.set(key, node);
    if (!sceneKeys.has(sceneId)) sceneKeys.set(sceneId, new Set());
    sceneKeys.get(sceneId).add(key);
    queue.push(node);
    return node;
  };

  if (startOk) {
    enqueue(story.startScene, initialState, 0, null);
  } else {
    // 起点自身前置条件不满足：无任何可达节点
    addIssue({
      severity: 'error',
      kind: 'start-blocked',
      sceneId: story.startScene,
      message: `起始场景「${story.startScene}」的前置条件在初始状态下不成立，剧情无法开始`,
      detail: {
        reasons: explain(startAst, initialState, true),
        initialState: stateEntries(initialState, varNames),
        expression: prettyAst(startAst)
      }
    });
  }

  for (let qi = 0; qi < queue.length; qi++) {
    const node = queue[qi];
    const scene = story.scenes.find((s) => s.id === node.sceneId);
    if (!scene) continue;

    for (const opt of scene.options) {
      const stat = ensureOpt(opt.clientId);
      stat.states.add(node.key);

      const ast = optionAst.get(opt.clientId);
      if (!ast || !evalAst(ast, node.state)) continue;
      stat.trueKeys.add(node.key);

      if (!opt.target || !sceneIds.has(opt.target)) continue; // 坏跳转已报错

      const destState = applyAssignments(node.state, opt.assignments);
      const destAst = sceneAst.get(opt.target);
      if (!evalAst(destAst, destState)) {
        // 跳转被目标前置条件阻断
        const destKey = `${opt.target}::${stateKey(destState, varNames)}`;
        if (!stat.blocked.has(destKey)) {
          stat.blocked.set(destKey, {
            fromKey: node.key,
            destSceneId: opt.target,
            destState,
            reasons: explain(destAst, destState, true),
            expression: prettyAst(destAst)
          });
        }
        continue;
      }
      stat.enteredKeys.add(node.key);
      enqueue(opt.target, destState, node.depth + 1, {
        fromKey: node.key,
        optionClientId: opt.clientId,
        optionLabel: opt.label,
        assigned: stateEntries(destState, varNames)
      });
    }
  }

  /* ---------- 汇总诊断 ---------- */
  const reachableSceneIds = new Set(sceneKeys.keys());

  // blocked-transition（同一选项的多个阻断状态聚合到一个 issue，detail 中列举）
  for (const s of story.scenes) {
    for (const opt of s.options) {
      const stat = optSeen.get(opt.clientId);
      if (!stat || stat.blocked.size === 0) continue;
      const blocks = [...stat.blocked.values()];
      const first = blocks[0];
      addIssue({
        severity: 'error',
        kind: 'blocked-transition',
        sceneId: s.id,
        optionClientId: opt.clientId,
        target: opt.target,
        message: `场景「${s.id}」→「${opt.target}」的选项「${opt.label}」存在可达状态满足其条件，但目标场景前置条件不成立（${blocks.length} 种状态被阻断）`,
        detail: buildBlockedDetail(opt.label, first, nodeStore, story, varNames)
      });
    }
  }

  // dead-option：条件在所有“可达到该选项”的状态下恒不成立
  for (const s of story.scenes) {
    for (const opt of s.options) {
      const stat = optSeen.get(opt.clientId);
      if (!stat || stat.trueKeys.size > 0) continue;
      const states = [...stat.states].map((k) => nodeStore.get(k));
      const ast = optionAst.get(opt.clientId);
      addIssue({
        severity: 'warning',
        kind: 'dead-option',
        sceneId: s.id,
        optionClientId: opt.clientId,
        target: opt.target,
        message: `场景「${s.id}」选项「${opt.label}」的条件在全部 ${states.length} 个可达状态下都不成立，玩家永远选不到`,
        detail: buildDeadOptionDetail(opt, ast, states, nodeStore, story, varNames)
      });
    }
  }

  // unreachable 场景（起点自身受阻时已报 start-blocked，不再重复标 unreachable）
  for (const s of story.scenes) {
    if (reachableSceneIds.has(s.id)) continue;
    if (s.id === story.startScene && !startOk) continue;
    addIssue({
      severity: 'error',
      kind: 'unreachable',
      sceneId: s.id,
      message: `场景「${s.id}」从起始场景不可达`,
      detail: buildUnreachableDetail(s, story, sceneAst, nodeStore, sceneKeys, varNames)
    });
  }

  /* ---------- 场景/选项状态 ---------- */
  const sceneStatus = {};
  for (const s of story.scenes) {
    const keys = sceneKeys.get(s.id);
    sceneStatus[s.id] = {
      reachable: !!keys && keys.size > 0,
      stateCount: keys ? keys.size : 0
    };
  }

  const optionStatus = {};
  for (const s of story.scenes) {
    for (const opt of s.options) {
      const stat = optSeen.get(opt.clientId);
      optionStatus[opt.clientId] = stat
        ? {
            reachStateCount: stat.states.size,
            satisfiedCount: stat.trueKeys.size,
            enteredCount: stat.enteredKeys.size,
            blockedCount: stat.blocked.size,
            dead: stat.trueKeys.size === 0
          }
        : { reachStateCount: 0, satisfiedCount: 0, enteredCount: 0, blockedCount: 0, dead: true, neverOffered: true };
    }
  }

  const propagation = {
    nodeCount: nodeStore.size,
    upperBound: varNames.length <= MAX_VARS_FOR_SAT
      ? story.scenes.length * 2 ** varNames.length
      : null,
    upperBoundCapped: varNames.length > MAX_VARS_FOR_SAT,
    variables: varNames,
    initialState: stateEntries(initialState, varNames),
    startScene: story.startScene,
    startSatisfiable: startOk,
    sceneStates: [...sceneKeys.entries()].map(([sceneId, keys]) => ({
      sceneId,
      states: [...keys].map((k) => stateEntries(nodeStore.get(k).state, varNames))
    }))
  };

  return buildReport(story, varNames, issues, { sceneStatus, optionStatus, propagation });
}

/* ------------------------------------------------------------------ */
/* 溯源详情                                                             */
/* ------------------------------------------------------------------ */

/** 从一个可达节点回溯到起点的路径。 */
function pathToNode(node, nodeStore) {
  const nodes = [];
  let cur = node;
  while (cur) {
    nodes.push(cur);
    cur = cur.pred ? nodeStore.get(cur.pred.fromKey) : null;
  }
  nodes.reverse();
  return nodes;
}

function formatPath(nodes, story) {
  const byId = new Map(story.scenes.map((s) => [s.id, s]));
  return nodes.map((n, i) => {
    const scene = byId.get(n.sceneId);
    const via = i > 0 ? nodes[i].pred : null;
    return {
      sceneId: n.sceneId,
      title: scene ? scene.title || n.sceneId : n.sceneId,
      viaOption: via ? via.optionLabel : null,
      isStart: i === 0
    };
  });
}

/**
 * 不可达场景溯源：
 * 在“场景图”上反向 BFS，从目标场景往回找最近的可达祖先（锚点）。
 * 路径 = 起点..锚点的真实可达状态路径（前缀） + 锚点..目标的场景链（后缀，标注为何断掉）。
 */
function buildUnreachableDetail(targetScene, story, sceneAst, nodeStore, sceneKeys, varNames) {
  const byId = new Map(story.scenes.map((s) => [s.id, s]));

  // 反向邻接：sceneId -> [{ from, option }]
  const reverse = new Map();
  for (const s of story.scenes) {
    for (const o of s.options) {
      if (!o.target) continue;
      if (!reverse.has(o.target)) reverse.set(o.target, []);
      reverse.get(o.target).push({ from: s.id, option: o });
    }
  }

  // 1) 从目标反向 BFS 找可达锚点
  const prev = new Map(); // child -> { parent, option }
  const visitedR = new Set([targetScene.id]);
  const q = [targetScene.id];
  let anchorId = null;
  for (let i = 0; i < q.length; i++) {
    const cur = q[i];
    if (sceneKeys.has(cur) && cur !== targetScene.id) {
      anchorId = cur;
      break;
    }
    for (const edge of reverse.get(cur) || []) {
      if (visitedR.has(edge.from)) continue;
      visitedR.add(edge.from);
      prev.set(edge.from, { parent: cur, option: edge.option });
      q.push(edge.from);
      if (sceneKeys.has(edge.from)) {
        anchorId = edge.from;
        break;
      }
    }
    if (anchorId) break;
  }

  // 起点本身可达也可作为锚点
  if (!anchorId && sceneKeys.has(story.startScene) && visitedR.has(story.startScene)) {
    anchorId = story.startScene;
  }

  const inbounds = reverse.get(targetScene.id) || [];

  if (!anchorId) {
    // 整个连通分量都不可达，或没有任何入边
    return {
      kind: 'unreachable',
      reason: inbounds.length === 0
        ? '没有任何场景的选项跳转到该场景（孤岛场景）'
        : '指向该场景的所有上游场景本身也都不可达',
      inboundScenes: inbounds.map((e) => ({ sceneId: e.from, optionLabel: e.option.label, target: e.option.target })),
      targetPrecondition: targetScene.precondition.trim()
        ? { expression: prettyAst(sceneAst.get(targetScene.id)), raw: targetScene.precondition }
        : null,
      reachablePrefix: [],
      blockedSuffix: [],
      blockers: []
    };
  }

  // 2) 重建 anchor -> ... -> target 的场景链
  const chain = [];
  let cur = anchorId;
  while (cur !== targetScene.id) {
    const step = prev.get(cur);
    if (!step) break;
    chain.push({ from: cur, option: step.option, to: step.parent });
    cur = step.parent;
  }

  // 3) 找锚点场景上“沿链条第一条边”的一个可达节点，回溯成真实路径前缀
  const firstEdge = chain[0];
  const anchorKeys = [...(sceneKeys.get(anchorId) || [])];
  let chosenAnchorKey = anchorKeys[0];
  if (firstEdge) {
    // 优先选择选项条件恰好成立的锚点状态；否则选离成立最近的
    let best = null;
    for (const key of anchorKeys) {
      const node = nodeStore.get(key);
      // 用一个轻量判定：条件引用的变量在此状态下使条件成立
      const r = parseExpression(firstEdge.option.condition);
      if (r.ok && evalAst(r.ast, node.state)) {
        best = key;
        break;
      }
      if (!best) best = key;
    }
    chosenAnchorKey = best || chosenAnchorKey;
  }

  const prefixNodes = pathToNode(nodeStore.get(chosenAnchorKey), nodeStore);
  const reachablePrefix = formatPath(prefixNodes, story);

  // 4) 沿链条逐边解释“为什么走不过去”
  const blockers = [];
  const blockedSuffix = chain.map((c) => ({
    sceneId: c.to,
    title: (byId.get(c.to) || {}).title || c.to,
    viaOption: c.option.label
  }));

  // 模拟从锚点状态出发
  let simState = { ...nodeStore.get(chosenAnchorKey).state };
  for (const c of chain) {
    const condRes = parseExpression(c.option.condition);
    const condHolds = condRes.ok && evalAst(condRes.ast, simState);
    const nextState = applyAssignments(simState, c.option.assignments);
    const destAst = sceneAst.get(c.to);
    const destOk = evalAst(destAst, nextState);

    if (!condHolds) {
      blockers.push({
        fromSceneId: c.from,
        optionLabel: c.option.label,
        toSceneId: c.to,
        stage: 'option-condition',
        expression: prettyAst(condRes.ok ? condRes.ast : { type: 'bool', value: true }),
        reasons: condRes.ok
          ? explain(condRes.ast, simState, true)
          : [condRes.error]
      });
      break; // 链条在此已断，后面的边无法模拟
    }
    if (!destOk) {
      blockers.push({
        fromSceneId: c.from,
        optionLabel: c.option.label,
        toSceneId: c.to,
        stage: 'scene-precondition',
        expression: prettyAst(destAst),
        reasons: explain(destAst, nextState, true)
      });
      simState = nextState;
      break;
    }
    simState = nextState;
  }

  return {
    kind: 'unreachable',
    reason:
      blockers.length > 0
        ? blockers[0].stage === 'option-condition'
          ? '最近的可达路径上，通往该场景的选项条件不成立'
          : '最近的可达路径上，目标场景的前置条件不成立'
        : '不存在从可达场景通向该场景的有效跳转链（可能跳转目标配置有误）',
    reachablePrefix,
    blockedSuffix,
    blockers,
    inboundScenes: inbounds.map((e) => ({ sceneId: e.from, optionLabel: e.option.label })),
    targetPrecondition: targetScene.precondition.trim()
      ? { expression: prettyAst(sceneAst.get(targetScene.id)), raw: targetScene.precondition }
      : null
  };
}

/** 死选项溯源：给一个可达状态示例 + 未满足条件 + （可满足时）最小修正建议。 */
function buildDeadOptionDetail(opt, ast, reachStates, nodeStore, story, varNames) {
  const sampleNode = nodeStore.get(reachStates[0].key);
  const prefixNodes = pathToNode(sampleNode, nodeStore);
  const reachablePrefix = formatPath(prefixNodes, story);

  const rawReasons = explain(ast, sampleNode.state, true);

  // 可满足性：在该选项可达状态基础上，允许改变条件引用的变量，是否存在使条件成立的赋值
  const referenced = [...collectVars(ast)].filter((v) => varNames.includes(v));
  const enumResult = enumerateStates(referenced, sampleNode.state);
  let satisfiable = null;
  let suggested = null;
  let contradiction = false;

  if (enumResult) {
    const hit = enumResult.find((s) => evalAst(ast, s));
    satisfiable = !!hit;
    if (hit) {
      // 选取与示例状态汉明距离最小的解
      let best = hit;
      let bestD = Infinity;
      const sampleK = stateKey(sampleNode.state, varNames);
      for (const s of enumResult) {
        if (!evalAst(ast, s)) continue;
        const d = hamming(sampleK, stateKey(s, varNames));
        if (d < bestD) {
          bestD = d;
          best = s;
        }
      }
      suggested = referenced
        .filter((v) => sampleNode.state[v] !== best[v])
        .map((v) => ({ variable: v, from: sampleNode.state[v] === true, to: best[v] === true }));
    } else if (referenced.length > 0) {
      contradiction = true;
    }
  }

  return {
    kind: 'dead-option',
    expression: prettyAst(ast),
    sampleState: stateEntries(sampleNode.state, varNames),
    reachablePrefix,
    reasons: rawReasons,
    satisfiability: {
      checked: enumResult !== null,
      satisfiable,
      contradiction,
      suggestedFlips: suggested,
      note: contradiction
        ? '条件自相矛盾，任何变量取值都无法使其成立'
        : suggested && suggested.length === 0
          ? '理论上可满足，但该场景的所有可达状态均未取得所需取值'
          : null
    }
  };
}

/** blocked-transition 溯源：真实可达路径 + 赋值后的目标状态 + 目标前置条件失配项。 */
function buildBlockedDetail(optionLabel, block, nodeStore, story, varNames) {
  const fromNode = nodeStore.get(block.fromKey);
  const prefixNodes = pathToNode(fromNode, nodeStore);
  return {
    kind: 'blocked-transition',
    optionLabel,
    reachablePrefix: formatPath(prefixNodes, story),
    targetSceneId: block.destSceneId,
    targetExpression: block.expression,
    stateAfterAssignment: stateEntries(block.destState, varNames),
    reasons: block.reasons
  };
}

/* ------------------------------------------------------------------ */

function buildReport(story, varNames, issues, extra) {
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.filter((i) => i.severity === 'warning').length;
  return {
    summary: {
      sceneCount: story.scenes.length,
      variableCount: varNames.length,
      errorCount: errors,
      warningCount: warnings,
      status: errors > 0 ? 'error' : warnings > 0 ? 'warning' : 'ok'
    },
    issues,
    ...(extra || {})
  };
}

module.exports = { analyze, normalizeStory };
