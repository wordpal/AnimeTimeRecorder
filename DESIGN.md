# AnimeTimeRecorder 详细设计（Design Doc）

## 0. 目标与范围

### 0.1 项目目标
AnimeTimeRecorder 是一个**离线优先**的动画/追番记录工具，定位为：
- 个人使用（不做社区/账号/后端服务）
- 在线时可检索条目并补全信息
- 离线时仍可浏览已缓存条目、并支持本地搜索

### 0.2 非目标
- 云同步/多端账号体系
- 评论/讨论/社交
- 视频播放与片源聚合

---

## 1. 技术栈与工程结构

### 1.1 技术栈
- 前端：React + TypeScript
- 构建：Vite
- 样式：TailwindCSS
- 路由：react-router-dom
- 本地数据库：IndexedDB（Dexie 封装）
- PWA：vite-plugin-pwa（GenerateSW + autoUpdate）

### 1.2 目录结构（关键）
- `app/src/api/*`：远端 API 封装
- `app/src/db/*`：Dexie 数据库与类型
- `app/src/pages/*`：页面（搜索 / 我的记录 / 设置）
- `app/src/components/*`：弹窗等组件
- `app/src/data/exportImport.ts`：导入导出（JSON/CSV）
- `app/vite.config.ts`：PWA manifest、SW 策略

---

## 2. 信息架构（IA）与核心页面

### 2.1 页面
- 搜索页（在线/离线降级）
- 我的记录页（离线可用 + 批量操作）
- 设置页（导入/导出/清理/缓存策略）

### 2.2 关键交互组件
- `SubjectEditModal`：条目编辑弹窗，承担：
  - 记录状态/评分/自定义标题
  - 展示条目摘要与扩展信息
  - 打开时自动预取并缓存详情/封面/人物/角色

---

## 3. 数据模型（IndexedDB / Dexie）

### 3.1 表与用途

#### 3.1.1 `entries`（个人记录）
- 主键：`subjectId`
- 字段：
  - `status`: wish/doing/done/on_hold/dropped
  - `rating?`: number（0-10，可小数；为空表示不评分）
  - `customTitleCn?`
  - `updatedAt`

#### 3.1.2 `animeCache`（条目缓存）
- 主键：`subjectId`
- 字段（随需求扩展）：
  - 标题类：`nameCn?`, `nameJp?`, `aliasesCn?`
  - 封面：`coverUrl?`, `coverBlob?`
  - 详情：`type?`, `date?`, `summary?`, `platform?`, `apiRatingScore?`
  - `lastFetchedAt`（用于 TTL 判断）

#### 3.1.3 `subjectExtras`（扩展信息缓存）
- 主键：`subjectId`
- 字段：
  - `persons`: 制作人员/公司/声优等（lite 结构）
  - `characters`: 角色与声优（lite 结构）
  - `lastFetchedAt`

#### 3.1.4 `appSettings`（设置）
- 主键：`key`
- `value`: unknown

已使用的关键设置：
- `cache_detail_ttl_days`: number
  - `1/7/30` 等：缓存有效期
  - `0`：永不过期（禁用自动刷新）
- `ui_bg_image_dataurl`: string
  - 自定义背景图（data URL），为空表示使用默认背景

---

## 4. 缓存策略设计

### 4.1 目标
- 减少用户离线时“空白/无信息”的概率
- 将网络请求从“每次打开都请求”降级为“到期才刷新”
- 不阻塞 UI：预取失败不影响主流程

### 4.2 缓存触发时机
- 打开 `SubjectEditModal`：触发后台预取
  - 预取条目详情并写入 `animeCache`
  - 预取人物/角色并写入 `subjectExtras`

### 4.3 TTL 与刷新策略
- 以 `lastFetchedAt` + `cache_detail_ttl_days` 控制是否跳过网络刷新
- 当 `cache_detail_ttl_days = 0` 时，视为“永不过期”，直接跳过刷新

### 4.4 Abort 与并发
- 详情预取与 extras 预取使用**不同的 AbortController**，避免互相 abort。

### 4.5 离线兜底展示
- 详情 tab 顶部提示块展示：
  - 离线提示/缓存时间
  - 平台/评分/放送等字段
  - 刷新缓存按钮（仅联网可用）
- extras 加载逻辑：
  - 有缓存直接展示
  - 离线且无缓存：给出明确错误提示

---

## 5. 搜索设计（在线 + 离线）

### 5.1 在线搜索
- 关键词输入触发 API 搜索（含 debounce）
- 分页：offset/limit + “加载更多”
- 结果点击进入 `SubjectEditModal`

### 5.2 离线降级
- 当离线或在线搜索失败：使用本地缓存（`animeCache` + `entries` + `subjectExtras`）进行搜索

### 5.3 本地搜索索引策略（简单字符串拼接）
构造 haystack 时纳入：
- `customTitleCn`
- `nameCn` / `nameJp`
- `aliasesCn`
- `summary`
- `subjectExtras.persons`: name / relation / career
- `subjectExtras.characters`: name / role / relation / actors.name

匹配策略：统一 `toLowerCase()` 后做 `includes`。

---

## 6. 批量操作设计（我的记录页）

### 6.1 进入批量模式
- 移动端：长按卡片约 0.5s
- 桌面端：Shift+点击 或 右键

### 6.2 批量能力
- 批量改状态
- 批量设评分/清评分
- 批量删除记录（不清缓存）

---

## 7. UX 约束与安全策略

### 7.1 危险操作二次确认
- 任何会导致本地数据被覆盖/删除/大规模变更的操作（例如导入覆盖、清空本地数据、清理缓存等）
- 统一通过浏览器 `confirm()` 进行二次确认

### 7.2 评分输入控件
- 评分范围：0-10，0.5 步进
- `0` 表示“不评分”
- UI 使用下拉选择，减少误输入

### 7.3 背景图
- 默认背景：`/Kirigiri.png`
- 自定义背景图来自 `appSettings.ui_bg_image_dataurl`
- 展示层为全局铺底，使用低透明度避免影响可读性

---

## 8. 导入导出设计

### 7.1 JSON
- 完整备份：entries/animeCache/subjectExtras/appSettings
- 兼容性：导入时对缺字段做默认值处理

### 7.2 CSV
- 面向表格查看

---

## 9. PWA 设计

### 8.1 Service Worker
- `vite-plugin-pwa`：GenerateSW
- `registerType: autoUpdate`

### 8.2 Manifest
- `name/short_name/description/icons/theme_color`
- 通过 HTTPS 部署后可稳定触发“安装到主屏幕”

### 8.3 更新与离线提示
- 全局提示条展示：
  - 离线 ready
  - needRefresh（提示刷新更新）

---

## 10. 风险与限制
- 浏览器存储空间受限：封面 Blob 占用可能较大，需提供清理入口（已实现“只清封面”等）
- 纯前端应用无法保证多端同步一致性：需依赖导入导出迁移

---

## 11. 部署设计（推荐）

### 10.1 Cloudflare Pages
- Root directory: `app`
- Build command: `npm run build`
- Output: `dist`
- 生成 HTTPS 链接，便于 PWA 安装与更新
