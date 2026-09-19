'use strict';

/**
 * 冒烟测试：node test/smoke.js
 * 覆盖：循环传播终止、不可达、死选项、阻断跳转、起点受阻、语法/结构错误、表达式求值。
 */

const assert = require('assert');
const { analyze } = require('../server/analyzer');
const { parseExpression, evalAst, explain } = require('../server/expression');
const seed = require('../server/seed');

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

console.log('表达式：');
check('变量 / 与或非 / 括号求值', () => {
  const ast = parseExpression('a && !b || c').ast;
  assert.strictEqual(evalAst(ast, { a: true, b: false, c: false }), true);
  assert.strictEqual(evalAst(ast, { a: true, b: true, c: false }), false);
  assert.strictEqual(evalAst(ast, { a: false, b: true, c: true }), true);
});
check('AND/OR 关键字与空表达式', () => {
  assert.strictEqual(evalAst(parseExpression('a AND (b OR NOT c)').ast, { a: true, b: false, c: true }), false);
  assert.strictEqual(parseExpression('').ast.value, true);
});
check('非法表达式被拒绝', () => {
  assert.strictEqual(parseExpression('a &&').ok, false);
  assert.strictEqual(parseExpression('a & b').ok, false);
  assert.strictEqual(parseExpression('(a').ok, false);
});
check('失配原因解释', () => {
  const reasons = explain(parseExpression('a && !b').ast, { a: false, b: true }, true);
  assert.ok(reasons.some((r) => r.includes('a = false')));
  assert.ok(reasons.some((r) => r.includes('b = true')));
});

console.log('状态空间传播：');
check('含循环剧情分析终止且节点去重', () => {
  const r = analyze({
    name: 'loop', startScene: 'a',
    variables: [{ name: 'x', initial: false }],
    scenes: [
      { id: 'a', precondition: '', options: [
        { label: 'toB', condition: '', assignments: [{ variable: 'x', value: true }], target: 'b' },
        { label: 'self', condition: 'x', assignments: [], target: 'a' }
      ] },
      { id: 'b', precondition: 'x', options: [
        { label: 'toA', condition: '', assignments: [{ variable: 'x', value: false }], target: 'a' }
      ] }
    ]
  });
  // a(x=false)、b(x=true)；a(x=true) 中 x 永远无法被置 false，故 self 是死选项
  assert.strictEqual(r.propagation.nodeCount, 2);
  assert.ok(r.issues.some((i) => i.kind === 'dead-option'));
});

console.log('问题诊断：');
check('示例古堡：4 错误（2 阻断 + 2 不可达）+ 2 死选项', () => {
  const r = analyze(seed[0]);
  assert.strictEqual(r.summary.errorCount, 4);
  assert.strictEqual(r.summary.warningCount, 2);
  assert.ok(r.issues.some((i) => i.kind === 'unreachable' && i.sceneId === 'secret_room'));
  assert.ok(r.issues.some((i) => i.kind === 'unreachable' && i.sceneId === 'throne'));
  assert.strictEqual(r.issues.filter((i) => i.kind === 'blocked-transition').length, 2);
  assert.strictEqual(r.issues.filter((i) => i.kind === 'dead-option').length, 2);
});
check('不可达场景给出最近可达路径前缀与未满足条件', () => {
  const r = analyze(seed[0]);
  const throne = r.issues.find((i) => i.kind === 'unreachable' && i.sceneId === 'throne');
  const prefixIds = throne.detail.reachablePrefix.map((p) => p.sceneId);
  assert.deepStrictEqual(prefixIds, ['entrance', 'courtyard', 'garden']);
  assert.strictEqual(throne.detail.blockedSuffix[0].sceneId, 'throne');
  assert.ok(throne.detail.blockers[0].reasons[0].includes('knows_password'));
});
check('死选项给出示例状态路径与可满足性修正建议', () => {
  const r = analyze(seed[0]);
  const dead = r.issues.find((i) => i.kind === 'dead-option');
  assert.strictEqual(dead.detail.satisfiability.satisfiable, true);
  assert.deepStrictEqual(dead.detail.satisfiability.suggestedFlips,
    [{ variable: 'knows_password', from: false, to: true }]);
});
check('无问题对照示例状态为 ok', () => {
  assert.strictEqual(analyze(seed[1]).summary.status, 'ok');
});
check('起点前置条件不满足报 start-blocked', () => {
  const r = analyze({
    name: 'sb', startScene: 'a',
    variables: [{ name: 'x', initial: false }],
    scenes: [{ id: 'a', precondition: 'x', options: [] }]
  });
  assert.ok(r.issues.some((i) => i.kind === 'start-blocked'));
});
check('语法错误、坏跳转、未声明变量均可检出', () => {
  const r = analyze({
    name: 'mix', startScene: 'a',
    variables: [{ name: 'x', initial: false }],
    scenes: [
      { id: 'a', precondition: 'x &&', options: [
        { label: 'bad target', condition: 'y', assignments: [], target: 'ghost' }
      ] },
      { id: 'b', options: [] }
    ]
  });
  assert.ok(r.issues.some((i) => i.kind === 'syntax'));
  assert.ok(r.issues.some((i) => i.kind === 'bad-target'));
  assert.ok(r.issues.some((i) => i.kind === 'unknown-var'));
});
check('重复场景 id / 起点缺失 报结构错误', () => {
  const r = analyze({
    name: 'dup', startScene: 'a', variables: [],
    scenes: [{ id: 'a', options: [] }, { id: 'a', options: [] }]
  });
  assert.ok(r.issues.some((i) => i.kind === 'structure' && i.message.includes('重复')));
  const r2 = analyze({ name: 'nostart', startScene: '', variables: [], scenes: [] });
  assert.ok(r2.issues.some((i) => i.kind === 'structure'));
});

console.log(`\n全部 ${passed} 项检查通过 ✔`);
