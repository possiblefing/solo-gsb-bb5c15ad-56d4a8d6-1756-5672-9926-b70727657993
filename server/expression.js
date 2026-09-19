'use strict';

/**
 * 布尔表达式词法/语法分析器
 *
 * 支持的语法：
 *   标识符 (变量名): [A-Za-z_][A-Za-z0-9_]*        —— 变量为 true
 *   true / false                                     —— 布尔字面量
 *   ! expr                                           —— 逻辑非
 *   expr && expr   /   expr AND expr                 —— 逻辑与
 *   expr || expr   /   expr OR expr                  —— 逻辑或
 *   ( expr )                                         —— 括号
 *   空串（仅空白）                                   —— 视为 true（无前置条件）
 *
 * AST 节点形态：
 *   { type: 'var',  name }
 *   { type: 'bool', value }
 *   { type: 'not',  arg }
 *   { type: 'and',  left, right }
 *   { type: 'or',   left, right }
 */

const KEYWORDS = {
  true: { type: 'bool', value: true },
  false: { type: 'bool', value: false },
  and: { type: 'op' },
  or: { type: 'op' },
  not: { type: 'op' }
};

function tokenize(source) {
  const tokens = [];
  let i = 0;
  const isIdentStart = (c) => /[A-Za-z_]/.test(c);
  const isIdentPart = (c) => /[A-Za-z0-9_]/.test(c);

  while (i < source.length) {
    const c = source[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (isIdentStart(c)) {
      let j = i;
      while (j < source.length && isIdentPart(source[j])) j++;
      const word = source.slice(i, j).toLowerCase();
      const kw = KEYWORDS[word];
      if (kw && kw.type === 'bool') {
        tokens.push({ kind: 'bool', value: kw.value });
      } else if (word === 'and') {
        tokens.push({ kind: 'and' });
      } else if (word === 'or') {
        tokens.push({ kind: 'or' });
      } else if (word === 'not') {
        tokens.push({ kind: 'not' });
      } else {
        tokens.push({ kind: 'name', value: source.slice(i, j) });
      }
      i = j;
      continue;
    }
    if (c === '&' && source[i + 1] === '&') {
      tokens.push({ kind: 'and' });
      i += 2;
      continue;
    }
    if (c === '|' && source[i + 1] === '|') {
      tokens.push({ kind: 'or' });
      i += 2;
      continue;
    }
    if (c === '!') {
      tokens.push({ kind: 'not' });
      i++;
      continue;
    }
    if (c === '(') {
      tokens.push({ kind: 'lparen' });
      i++;
      continue;
    }
    if (c === ')') {
      tokens.push({ kind: 'rparen' });
      i++;
      continue;
    }
    const snippet = source.slice(Math.max(0, i - 6), i + 7);
    throw new Error(`无法识别的字符 "${c}"（位置 ${i + 1}，片段："${snippet}"）`);
  }
  return tokens;
}

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.pos = 0;
  }

  peek() {
    return this.tokens[this.pos];
  }

  next() {
    return this.tokens[this.pos++];
  }

  expect(kind) {
    const t = this.next();
    if (!t || t.kind !== kind) {
      throw new Error(`语法错误：期望 "${this.label(kind)}"，但遇到 "${t ? this.label(t.kind) : '表达式末尾'}"`);
    }
  }

  label(kind) {
    return ({ and: '&&', or: '||', not: '!', lparen: '(', rparen: ')', name: '变量名' })[kind] || kind;
  }

  // or  := and (OR and)*
  parseOr() {
    let node = this.parseAnd();
    while (this.peek() && this.peek().kind === 'or') {
      this.next();
      const right = this.parseAnd();
      node = { type: 'or', left: node, right };
    }
    return node;
  }

  // and := not (AND not)*
  parseAnd() {
    let node = this.parseNot();
    while (this.peek() && this.peek().kind === 'and') {
      this.next();
      const right = this.parseNot();
      node = { type: 'and', left: node, right };
    }
    return node;
  }

  // not := NOT not | atom
  parseNot() {
    if (this.peek() && this.peek().kind === 'not') {
      this.next();
      return { type: 'not', arg: this.parseNot() };
    }
    return this.parseAtom();
  }

  // atom := NAME | TRUE | FALSE | '(' or ')'
  parseAtom() {
    const t = this.next();
    if (!t) throw new Error('语法错误：表达式不完整，缺少变量或括号内表达式');
    if (t.kind === 'name') return { type: 'var', name: t.value };
    if (t.kind === 'bool') return { type: 'bool', value: t.value };
    if (t.kind === 'lparen') {
      const node = this.parseOr();
      this.expect('rparen');
      return node;
    }
    throw new Error(`语法错误：意外的 "${this.label(t.kind)}"，此处应为变量、"!" 或 "("`);
  }

  parse() {
    const node = this.parseOr();
    if (this.pos < this.tokens.length) {
      throw new Error(`语法错误：运算符缺少操作数（多余的 "${this.label(this.peek().kind)}"）`);
    }
    return node;
  }
}

/**
 * 解析表达式，返回 { ok: true, ast } 或 { ok: false, error }
 * 空串视为常量 true。
 */
function parseExpression(source) {
  const text = String(source == null ? '' : source).trim();
  if (text === '') return { ok: true, ast: { type: 'bool', value: true }, empty: true };
  try {
    return { ok: true, ast: new Parser(tokenize(text)).parse() };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** 在给定状态下求值。未声明变量按 false 处理。 */
function evalAst(ast, state) {
  switch (ast.type) {
    case 'bool':
      return ast.value;
    case 'var':
      return state[ast.name] === true;
    case 'not':
      return !evalAst(ast.arg, state);
    case 'and':
      return evalAst(ast.left, state) && evalAst(ast.right, state);
    case 'or':
      return evalAst(ast.left, state) || evalAst(ast.right, state);
    default:
      throw new Error('未知 AST 节点类型：' + ast.type);
  }
}

/** 收集 AST 中引用的全部变量名。 */
function collectVars(ast, out = new Set()) {
  switch (ast.type) {
    case 'var':
      out.add(ast.name);
      break;
    case 'not':
      collectVars(ast.arg, out);
      break;
    case 'and':
    case 'or':
      collectVars(ast.left, out);
      collectVars(ast.right, out);
      break;
    default:
      break;
  }
  return out;
}

/** 转成规范可读字符串。 */
function prettyAst(ast) {
  switch (ast.type) {
    case 'bool':
      return ast.value ? 'true' : 'false';
    case 'var':
      return ast.name;
    case 'not':
      return ast.arg.type === 'var' || ast.arg.type === 'bool' || ast.arg.type === 'not'
        ? `!${prettyAst(ast.arg)}`
        : `!(${prettyAst(ast.arg)})`;
    case 'and':
    case 'or': {
      const op = ast.type === 'and' ? ' && ' : ' || ';
      const l = ast.left.type === 'or' ? `(${prettyAst(ast.left)})` : prettyAst(ast.left);
      const r = ast.right.type === 'or' ? `(${prettyAst(ast.right)})` : prettyAst(ast.right);
      return `${l}${op}${r}`;
    }
    default:
      return '';
  }
}

/**
 * 解释表达式为何得不到期望值。
 * 返回人类可读的原因片段数组，每个片段描述一个“失配的叶子要求”。
 *
 * @param {object} ast 表达式 AST
 * @param {Object<string, boolean>} state 变量状态
 * @param {boolean} [want] 希望表达式成立还是不成立；缺省 = 当前实际值的反面（解释它为何不成立/成立）
 * @returns {string[]} 失配原因，例如 ["has_key = false（要求为 true）"]
 */
function explain(ast, state, want) {
  const expectTrue = want == null ? !evalAst(ast, state) : want;
  return collectFailures(ast, state, expectTrue);
}

/**
 * 收集导致“表达式当前值 !== expectTrue”的叶子失配集合（解释性，非最小化）。
 */
function collectFailures(node, state, expectTrue) {
  switch (node.type) {
    case 'bool': {
      if (node.value !== expectTrue) {
        return [`常量 ${node.value} 恒为 ${node.value}，与要求 ${expectTrue} 冲突`];
      }
      return [];
    }
    case 'var': {
      const actual = state[node.name] === true;
      if (actual !== expectTrue) {
        return [`变量 ${node.name} = ${actual}（要求为 ${expectTrue}）`];
      }
      return [];
    }
    case 'not':
      return collectFailures(node.arg, state, !expectTrue);
    case 'and':
      if (expectTrue) {
        // 两边都必须成立
        return [
          ...collectFailures(node.left, state, true),
          ...collectFailures(node.right, state, true)
        ];
      }
      // 只要一边不成立 —— 选择当前不成立的那一边（都不成立则都列出）
      return pickFailingBranch(node, state, false);
    case 'or':
      if (expectTrue) {
        // 只要一边成立 —— 列出所有当前不成立的边
        return pickFailingBranch(node, state, true);
      }
      // 两边都必须不成立
      return [
        ...collectFailures(node.left, state, false),
        ...collectFailures(node.right, state, false)
      ];
    default:
      return [];
  }
}

/** and 期望 false / or 期望 true 时，指出当前卡住的分支。 */
function pickFailingBranch(node, state, branchExpect) {
  const lBad = evalAst(node.left, state) !== branchExpect;
  const rBad = evalAst(node.right, state) !== branchExpect;
  const out = [];
  if (lBad) out.push(...collectFailures(node.left, state, branchExpect));
  if (rBad) out.push(...collectFailures(node.right, state, branchExpect));
  return out;
}

module.exports = { parseExpression, evalAst, collectVars, prettyAst, explain };
