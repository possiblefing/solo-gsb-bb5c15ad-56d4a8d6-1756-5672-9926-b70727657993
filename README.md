# 分支剧情一致性审校台（Branching Story Auditor）

一个用于检查 **分支剧情 / 互动叙事脚本一致性** 的 Web 应用。支持为每个场景设置 **布尔前置条件、进入时状态赋值**，为每个选项设置 **显示条件、状态赋值和跳转目标**，并指定剧情起点。后端会从起点出发，按 **「场景 + 变量状态」组合状态** 进行穷举传播与去重，因此即使剧情包含环路（可反复返回的场景），分析也保证终止。

## 能发现什么问题

| 类型 | 含义 |
| --- | --- |
| **不可达场景** `unreachableScene` | 从起点出发，不存在任何选项链能进入该场景（孤岛场景 / 唯一通路选项恒假 / 入口前置冲突） |
| **条件永不成立的选项** `neverTrueOption` | 选项所在场景可达，但在所有能到达的变量状态下，该选项条件都为 false，玩家永远看不到它 |
| **悬空跳转** `orphanOption` | 选项没有目标，或跳向不存在的场景 ID |
| **入口前置冲突** `blockedEntry` | 选项本身可触发，但目标场景的前置条件在跳转后的变量状态下恒不成立（赋值与前置条件互相矛盾） |
| **结构 / 语法错误** | 未指定起点、场景 ID 重复或缺失、条件表达式语法错误、引用未声明且从未赋值的变量等 |

点击任一问题，右侧会展示：

1. **最接近的可达路径**：从起点到问题点的最短选项链（含每一步的变量状态）；
2. **未满足的条件解释树**：逐层标注每个子条件的期望值 / 实际值，并给出 **最少只需翻转哪些变量** 即可让条件成立，帮助定位是哪条状态赋值缺失或冲突。

## 一条命令启动（需要 Docker + Docker Compose）

```bash
docker compose up -d --build
```

启动后访问：

> **http://localhost:3000**

首次启动且数据目录为空时，会自动写入一份示例剧情 **《失落王权》**（其中刻意包含循环、不可达场景、恒假条件、悬空跳转等缺陷，方便直接体验审校功能）。

停止：

```bash
docker compose down          # 保留剧情数据（Docker 卷 story-data）
docker compose down -v       # 同时删除剧情数据卷
```

查看日志：

```bash
docker compose logs -f
```

## 不使用 Docker（本地 Node.js 运行）

要求 Node.js ≥ 18。

```bash
npm install
npm start
```

默认同样监听 **http://localhost:3000**，剧情数据保存在项目下的 `./data/` 目录，示例剧情在首次启动时自动播种。

## 配置项（环境变量）

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | HTTP 监听端口。Compose 映射宿主机端口可直接修改 `docker-compose.yml` 中 `"3000:3000"` 的左侧值 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `DATA_DIR` | Docker 内 `/app/data`；本地 `./data` | 剧情 JSON 文件的持久化目录 |
| `SEED_ON_START` | `true` | 数据目录为空时是否自动播种 `samples/` 下的示例剧情；设为 `false` 关闭 |

## 条件表达式语法

选项条件与场景前置条件使用布尔表达式：

- 变量名：以字母 / 下划线开头，仅含字母、数字、下划线，如 `hasKey`；
- 与 / 或 / 非：`a && b`、`a || b`、`!a`；
- 括号：`(a || b) && !c`；
- 留空表示 **恒真**；
- 未定义的变量按 `false` 处理；若变量既未在“布尔变量”中声明、也从未被任何赋值设置，分析结果会额外给出警告。

## 剧情 JSON 格式（同时也是导入 / 导出格式）

```json
{
  "title": "剧情标题",
  "description": "可选简介",
  "startScene": "village",
  "variables": [
    { "name": "hasKey", "description": "是否持有钥匙" }
  ],
  "scenes": [
    {
      "id": "village",
      "title": "宁静村",
      "text": "场景正文……",
      "precondition": "",
      "assigns": [],
      "options": [
        {
          "text": "走进森林",
          "condition": "!hasKey",
          "target": "forest",
          "assigns": [{ "variable": "hasKey", "value": true }]
        }
      ]
    }
  ]
}
```

- 场景 `assigns`：**进入场景时** 执行的赋值（包括从起点进入）；
- 选项 `assigns`：选择该选项时执行的赋值，随后再执行目标场景的进入赋值；
- 起点场景的初始变量状态 = 全部为 `false` 再叠加起点场景自身的进入赋值。

导入通过页面右上角 **「⬆ 导入 JSON」** 完成（导入总是创建一份新剧情，不会覆盖现有内容）；导出使用 **「⬇ 导出 JSON」** 或接口 `GET /api/stories/:id/export`。

## 分析原理（为什么含循环也能终止）

分析器把每个可达局面编码为 `(场景 ID, 全部布尔变量的取值位图)`：

1. 以起点场景 + 其进入赋值后的状态作为初始具体状态；
2. BFS 遍历：对当前具体状态下的每个选项求值条件——成立则应用选项赋值与目标场景的进入赋值，得到新具体状态；
3. 新状态按 `场景 + 状态位图` 去重，已访问过就不再入队。

布尔变量数为 n 时，具体状态总数至多为 `场景数 × 2^n`，必然有限，所以任意循环都不会导致分析发散（设有约 100 万状态的安全上限，超限会在结果中提示“分析截断”）。

“条件永不成立”的判定：若某选项 **被到达过**，但在所有到达它的具体状态下条件都不成立，则该选项对玩家不可见；只要存在任意一个可达状态使条件成立，即视为正常。

## HTTP API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/stories` | 剧情列表 |
| `POST` | `/api/stories` | 新建剧情 |
| `GET` | `/api/stories/:id` | 读取剧情完整 JSON |
| `PUT` | `/api/stories/:id` | 保存（整体覆盖） |
| `DELETE` | `/api/stories/:id` | 删除剧情 |
| `POST` | `/api/analyze` | 对请求体中的剧情直接分析（编辑时实时检查，不落盘） |
| `GET` | `/api/stories/:id/analysis` | 分析已保存的剧情 |
| `GET` | `/api/stories/:id/export` | 下载剧情 JSON |

## 目录结构

```
.
├── server.js              # Express 入口与 REST API
├── src/
│   ├── expression.js      # 布尔表达式递归下降解析器 / 求值 / 失败解释
│   ├── analyzer.js        # 「场景+状态」BFS 传播去重分析引擎
│   └── storage.js         # JSON 文件存储与首启播种
├── public/                # 原生 HTML / CSS / JavaScript 前端（无构建步骤）
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── samples/               # 随启动初始化的示例剧情
├── test/smoke.js          # 分析引擎自检（node test/smoke.js）
├── Dockerfile
└── docker-compose.yml
```

## 技术栈

Node.js + Express（唯一运行期依赖）、原生 HTML/CSS/JavaScript 单页前端、JSON 文件持久化（无需数据库）、Node 20 Alpine 镜像。
