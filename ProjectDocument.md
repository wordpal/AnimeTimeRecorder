# AnimeTimeRecorder Project Document

## 1. 项目背景与目标
本项目是一个“番剧记录小工具”。

- 本质：个人使用的记录工具，不做社区、不做账号、不做服务器。
- 数据来源：联网时从 Bangumi 拉取番剧条目信息（不包含视频内容）。
- 本地化：所有个人记录保存在本机本地数据库中，离线可查看已记录内容。
- 展示方式：手机优先，类似 App 的操作体验；以“封面网格墙”高密度浏览。

## 2. 范围定义（Scope）
### 2.1 必做（MVP）
- 联网搜索 Bangumi 条目
- 展示搜索结果（封面网格）
- 记录条目状态（5 状态）
- 记录个人评分（0-10，0.5 步进；填 0 表示不评分）
- 我的记录页（离线可用）
- 仅对“已标记”的条目缓存必要元数据与封面，以支持离线浏览
- 导出：CSV + JSON
- 导入：JSON（用于迁移/备份）
- 自定义中文标题（当 Bangumi 中文名不理想时，允许用户本地覆盖显示标题）

### 2.2 暂不做（非 MVP）
- 账号系统/云同步
- 评论/讨论/关注/榜单
- 集数进度（看到第几集）
- 复杂推荐系统

## 3. 用户故事（User Stories）
- 作为用户，我想在手机上搜索某部番剧，并快速标记为“想看/在看/看完”等。
- 作为用户，我想给某部番剧打分（1-10），也可以不评分只标记状态。
- 作为用户，我想在离线时依然能打开应用，查看我已经标记过的番剧列表和封面。
- 作为用户，我想导出我的清单为 CSV（便于表格查看）和 JSON（便于完整备份）。
- 作为用户，我想在换设备或重装后，通过导入 JSON 恢复我的记录。
- 作为用户，如果条目的中文名不合我意，我想在本地设置一个“我自己的中文标题”。

## 4. 功能清单（Feature List）
### 4.1 条目搜索与浏览
- 搜索框：按关键词搜索（优先中文名，其次日文名/别名）
- 条目类型筛选：TV / OVA / 剧场版（以 Bangumi 数据为准）
- 结果展示：封面网格墙
- 条目操作：点击卡片打开详情弹窗（或详情页）

### 4.2 个人记录
- 状态（5 状态）：
  - 想看（wish）
  - 在看（doing，显示黄）
  - 看完（done，显示绿）
  - 搁置（on_hold）
  - 弃坑（dropped）
- 评分：0-10，0.5 步进；填 0 表示不评分
- 自定义中文标题：可选字段，用于覆盖显示标题
- 快捷操作：在网格卡片/弹窗里快速切换状态与评分

### 4.5 外观
- 默认背景图：`Kirigiri.png`
- 设置页支持导入/清除自定义背景图（自定义会覆盖默认）

### 4.3 离线能力
- 离线时可打开应用（PWA App Shell 缓存）
- 离线时可浏览“我的记录”
- 缓存策略：仅当用户对条目进行“标记/评分”后，将条目元数据与封面下载并保存到本地数据库

### 4.4 数据导入导出
- 导出 JSON：完整备份（包含条目缓存、记录、设置）
- 导出 CSV：便于在 Excel/表格中查看
- 导入 JSON：恢复备份

## 5. 非功能需求（NFR）
- 手机优先（单手操作友好）：底部 Tab 导航、弹窗操作、触控区域足够大
- 性能：网格列表虚拟滚动（若数据量增大后再上）；MVP 可先简单分页/懒加载
- 稳定性：本地数据库迁移策略（版本号）
- 可用性：断网提示明确；联网功能不可用时不影响本地浏览

## 6. 概要设计（High-level Design）
### 6.1 形态与技术栈
- 应用形态：PWA（可安装到主屏幕）
- 前端框架：Vite + React + TypeScript
- UI：TailwindCSS（移动端优先）
- PWA：vite-plugin-pwa（Service Worker 缓存 App Shell）
- 本地数据库：IndexedDB（建议使用 Dexie 作为封装）
- 远端数据：Bangumi API（仅运行时请求；不建后端）

### 6.1.1 Bangumi API（已确认的接口与字段）
以下信息基于 Bangumi 官方 OpenAPI（`https://api.bgm.tv`，版本号见 `https://bangumi.github.io/api/dist.json`）。

- 服务端基地址：`https://api.bgm.tv`
- 搜索（条目搜索）：`POST /v0/search/subjects`
  - Request Body：`{ keyword: string, sort?: 'match'|'heat'|'rank'|'score', filter?: { type?: SubjectType[], tag?: string[], air_date?: string[], rating?: string[], rating_count?: string[], rank?: string[], nsfw?: boolean } }`
  - Response：`Paged_Subject`，其中 `data[]` 为 `Subject`（包含 `id/name/name_cn/images/type/date/summary/...`）
- 获取条目详情：`GET /v0/subjects/{subject_id}`
  - Response：`Subject`
- 获取条目封面（重定向到图片链接）：`GET /v0/subjects/{subject_id}/image?type={small|grid|large|medium|common}`
  - Response：`302 Location: <image url>`

本项目实现时会建立 `bangumiClient` 适配层：只在该层使用 API 原始字段名，其余业务逻辑仅使用本项目定义的数据结构。

### 6.2 信息架构（IA）
底部 Tab（手机 App 风格）：
- 在线搜索
- 我的记录
- 设置

#### 在线搜索
- 搜索框 + 类型筛选
- 结果网格（封面墙）
- 条目弹窗：
  - 标题（优先显示：自定义中文标题 > Bangumi 中文名 > 日文名）
  - 简介（可选）
  - 状态选择（5 按钮/下拉）
  - 评分选择（1-10）
  - “保存到我的记录”

#### 我的记录（离线可用）
- 状态筛选（全部/想看/在看/看完/搁置/弃坑）
- 网格墙
- 点击条目进入弹窗，修改状态/评分/自定义标题

#### 设置
- 导入/导出
  - 导出 JSON
  - 导出 CSV
  - 导入 JSON
- 数据管理
  - 可选：清空本地数据（非 MVP，可后置）

### 6.3 数据模型（IndexedDB）
#### 表：entries（个人记录）
- subjectId: number（主键）
- status: 'wish' | 'doing' | 'done' | 'on_hold' | 'dropped'
- rating?: number（1-10，可空）
- customTitleCn?: string（可空）
- updatedAt: number（毫秒时间戳）

#### 表：animeCache（已标记条目的缓存）
- subjectId: number（主键）
- nameCn?: string
- nameJp?: string
- aliasesCn?: string[]
- coverUrl?: string
- coverBlob?: Blob（离线封面）
- type?: string
- year?: number
- summary?: string
- lastFetchedAt: number

#### 表：appSettings（设置）
- key: string（主键）
- value: any（JSON）

### 6.4 数据流（核心）
- 在线搜索：
  - 输入关键词 -> 调用 Bangumi 搜索接口 -> 渲染网格结果（不落库、不缓存封面）
- 标记/评分：
  - 用户对某条目选择状态/评分 -> 写入 entries
  - 同时拉取该条目详情与封面 -> 写入 animeCache（coverBlob）
- 离线打开：
  - 读取 entries + animeCache -> 渲染“我的记录”网格墙

### 6.4.1 字段映射与回退策略（基于 Subject schema）
以下字段在 `Subject` schema 中已确认：

- `id`: 条目 ID（本地使用 `subjectId`）
- `name`: 原名（通常为日文）
- `name_cn`: 中文名（可能为空字符串）
- `type`: 条目大类（`SubjectType` enum：1书籍/2动画/3音乐/4游戏/6三次元）
- `date`: 播出/发售日期（`YYYY-MM-DD` 字符串）
- `summary`: 简介
- `images`: 封面图对象（`Images` schema；包含多个尺寸字段）
- `platform`: 平台字符串（文档描述示例包含：`TV, Web, 欧美剧, DLC...`）
- `tags/meta_tags`: 标签（可选，用于筛选/展示；MVP 可不依赖）

项目内的展示标题 `displayTitle` 统一采用：
`customTitleCn`（用户自定义） > `name_cn`（若非空） > `name`。

动画细分类型（TV/OVA/Movie/WEB）在 API 中存在 `SubjectAnimeCategory` 枚举，但条目详情里不保证直接给出该字段。MVP 的策略：
- 优先尝试从 `platform` 推断（例如 `TV/Web` 等）
- 若无法可靠推断，则动画细分筛选先降级为“只按大类：动画（SubjectType=2）”，TV/OVA/剧场筛选可作为后续增强项

封面字段策略：
- 在线展示：优先使用 `images.grid`（网格墙最合适），若不存在则按 `small/medium/large` 依次回退
- 离线展示：仅对“已标记条目”下载封面并保存为 `coverBlob`，展示时优先使用 `coverBlob`

注：是否存在浏览器直连 CORS 限制，需要在实现阶段用真实请求验证；如遇限制，将再评估是否需要极薄代理（但仍保持“无需账号/服务器”的产品定位不变）。

### 6.5 导入导出格式
#### JSON 导出（建议结构）
```json
{
  "version": 1,
  "exportedAt": 0,
  "entries": [
    {
      "subjectId": 0,
      "status": "done",
      "rating": 8,
      "customTitleCn": "...",
      "updatedAt": 0
    }
  ],
  "animeCache": [
    {
      "subjectId": 0,
      "nameCn": "...",
      "nameJp": "...",
      "aliasesCn": ["..."],
      "coverUrl": "...",
      "coverBase64": "...",
      "type": "TV",
      "year": 2020,
      "summary": "...",
      "lastFetchedAt": 0
    }
  ],
  "settings": {}
}
```
- 说明：JSON 中不直接存 Blob，导出时将封面转为 base64（字段 coverBase64）。

#### CSV 导出（建议列）
- subjectId
- title（最终显示标题）
- nameCn
- nameJp
- status
- rating
- updatedAt

## 7. 里程碑与 TODO（Implementation TODO）
### Milestone 0：开发环境准备
- 安装 Node.js（含 npm）
- 安装 Git（可选，但强烈建议）
- 安装 VS Code（你已在 IDE 内则可忽略）

### Milestone 1：工程骨架（Vite + React + TS + Tailwind + PWA）
- 初始化 Vite React TS 项目
- 配置 TailwindCSS
- 配置 PWA（manifest、icons、离线 App Shell）
- 建立路由与底部 Tab 导航

### Milestone 2：本地数据库层（IndexedDB）
- 引入 Dexie
- 定义 tables：entries / animeCache / appSettings
- 封装数据访问：
  - upsertEntry
  - getEntriesByStatus
  - upsertAnimeCache

### Milestone 3：在线搜索页
- Bangumi API 客户端封装（搜索、获取条目详情）
- 搜索 UI + 筛选
- 结果网格渲染
- 条目弹窗（展示 + 操作）

### Milestone 4：我的记录页（离线可用）
- 状态筛选
- 网格墙（读取 entries + animeCache）
- 点击弹窗修改状态/评分/自定义标题

### Milestone 5：缓存封面（仅标记条目）
- 标记时下载封面
- 将封面保存为 Blob
- 展示时优先使用 Blob（离线）

### Milestone 6：导入/导出
- JSON 导出（含封面 base64）
- JSON 导入（含封面恢复为 Blob）
- CSV 导出

### Milestone 7：打包与发布（本地/静态托管）
- 构建产物
- 本地访问说明
- 可选：GitHub Pages / Netlify 静态部署（不需要后端）

### Future：APK 阶段增强（可选）
- 增加“追番时间”相关字段：例如加入记录时间/看完时间（默认当前时间），用于时间线回顾与筛选
