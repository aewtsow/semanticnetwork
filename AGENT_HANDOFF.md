# 中文量词语义网络：后续 Agent 交接说明

更新日期：2026-09-29

> **新版入口已经切换。** 当前 `index.html` 使用 `workbench.js`、`workbench.css`、
> `semantic-core.js`、`semantic-worker.js` 和独立的 `data/semantic_v2/`。
> 请先读 [SEMANTIC_V2.md](SEMANTIC_V2.md)。下文保留为 **2026-09-04 旧版与星图的技术记录**，
> 不再代表三张新版主图；旧入口移至 `legacy.html`。
> `app.js` 的星图计算和动效保持原样，仅添加同源 iframe 的打开／关闭桥接。
> 新版不能调用旧 Top 400 近似上下文，也不能用旧 cosine 回填尚不可用的新数据。
> 本轮没有提交或推送 GitHub。
> 2026-09-29 后续修复：主图使用 v=20260929-3；PMI 固定 RGB 色阶、力模拟帧过渡、Degree/共现/PMI 等裁剪已恢复。
> 新增 `semantic-motion.js` 和 `test_semantic_restore.js`；剩余旧版功能差异详见 `RESTORE_AUDIT.md`。
> 2026-10-05：主图 v=20261005-1 使用平方 sigmoid 的白到深绿色 PMI 色阶；低值接近白底，但不改关系和布局。新增 `test_pmi_fade.js` 验证前后结构/坐标完全一致。星图未改。

这份文档描述的是**当前已经落地的代码**，不是早期需求稿。后续修改前请先读本文，再以 `app.js`、数据生成脚本和 `data/word_network_build_report.json` 为最终依据。

## 1. 一分钟理解当前项目

这是一个无后端、通过本地静态 HTTP 服务运行的单页网页，包含三个网络：

1. **量词—量词网络**：用 `valid_common.xlsx` 中量词的名词权重向量计算 cosine similarity。
2. **量词—名词网络**：直接展示 `valid_common.xlsx` 中已经确认的真实量词→名词搭配，支持从量词查名词，也支持从名词反查量词。
3. **词汇网络**：节点仅限 `valid_common.xlsx` 出现过的量词和名词；同类词关系来自原始共现矩阵的双向平均，跨词类关系严格限于 `valid_common`。浏览器按每个词的 `NPMI_log_co_score` Top 400 建立目标词的 1-hop 诱导子图，并在最终可见图上实时计算 Local Louvain。

页面最末右下角另有一个**词汇星图测试入口**。它不是与前三个 Tab 并列的新模块，而是复用当前 `wordTarget` 的沉浸式词汇网络视图；固定采用 `PMI > 3`、`co-occurrence > 100`、一次修剪前 `Degree > 2`，中心词例外保留。

当前绘图技术不是 Sigma：

- 图形渲染：原生 SVG；
- 词汇网络布局：`app.js` 内自定义、会冷却停止的力模拟；
- 前两个局部网络布局：稳定的径向布局；
- Community：Graphology 的 Louvain 与 modularity；
- 数据加载：普通 `.js` 全局变量加二进制边分块；
- 无 Flask、Node、数据库或前端构建步骤。

## 2. 不应被改动的研究定义

除非用户明确给出新定义，否则不要改变以下内容：

- 不修改任何 `.ipynb`、原始 NPZ、词表或 `valid_common.xlsx`。
- `classifier → noun` 保留原始方向：`A[classifier_index, noun_index]`。
- `noun ↔ noun` 与 `classifier ↔ classifier` 使用 `(Aij + Aji) / 2`，然后在对称统计空间重新计算指标；不能直接平均两个方向的 PMI。
- 跨词类浏览器关系只允许来自 `valid_common.xlsx`，不能从普通语料共现中补造量词—名词搭配。
- 词汇网络是目标词的 1-hop 邻居诱导子图，不是整个 connected component，也不是 k-core。
- Degree pruning 只执行一次，中心节点始终保留。
- Local Louvain 只用最终可见图中的正 PMI 边，权重固定为 PMI。
- 第一个 Tab 仍是 cosine 网络，不能用第三个 Tab 的量词↔量词 PMI 关系替换。

## 3. 数据来源与数据流

### 3.1 原始输入

| 文件 | 用途 |
| --- | --- |
| `../valid_common.xlsx` | 已验证的量词→名词关系及 `co_occurrence`、`PMI`、`NPMI`、`NPMI_log_co_score` |
| `../../Data/cor_m_sum.npz` | 原始稀疏、非对称词汇共现矩阵 |
| `../../Data/voc_list.txt` | 矩阵行列对应的固定词表 |
| `../../Data/global_stats_full_forms.npz` | 完整统计空间的总量 `N` 与词频 |
| `../../Data/cor_m_classifier_full_forms.npz` | 处理量词自配对核查时使用的量词行矩阵 |
| `../../Data/valid_classifier_full_forms.txt` | 上述量词行矩阵的行标签 |

原始矩阵很大，当前报告为 `140,325 × 140,325`，非零项 `1,707,076,135`。任何处理都必须保持 sparse/流式方式，不能 densify。

### 3.2 指标公式

代码在 `prepare_word_network.py::metric_arrays()` 中使用自然对数：

```text
PMI = ln(N) + ln(co) - ln(source_frequency) - ln(target_frequency)
NPMI = PMI / -ln(co / N)
NPMI_log_co_score = NPMI × ln(co)
```

三类关系的输入不同：

| 关系 | co-occurrence | source/target frequency | 方向 |
| --- | --- | --- | --- |
| 量词→名词 | `A[classifier, noun]` | 原有向矩阵的 row sum / column sum | 有向统计关系 |
| 名词↔名词 | `(Aij + Aji) / 2` | `(row_sum + column_sum) / 2` | 对称关系 |
| 量词↔量词 | `(Aij + Aji) / 2` | `(row_sum + column_sum) / 2` | 对称关系 |

对称化后的总量仍沿用完整统计空间的 `N`；双向平均不会改变完整矩阵总量。自环不作为网页边，但不能因此擅自改写用于概率计算的总量或边际频率。

### 3.3 预处理脚本职责

- `prepare_data.py`
  - 校验 `valid_common.xlsx` 必需字段、缺失值与重复组合；
  - 生成 `data/classifier_noun_data.js`；
  - 以量词×名词的 `NPMI_log_co_score` 稀疏向量计算所有正 cosine similarity；
  - 生成 `data/classifier_similarity_data.js`，并写入共同非零名词数。

- `prepare_word_network.py`
  - 从大 NPZ 中流式抽取 `valid_words` 子矩阵；
  - 全量复现并核对 classifier(row)→noun(column) 指标；
  - 调用同类词缓存构建；
  - 构建固定 Global Community 分析图及节点指标；
  - 在合法关系范围内为每个词按 `NPMI_log_co_score` 取 Top 400；
  - 输出节点 JS、边 manifest、二进制边分块和构建报告。

- `build_symmetric_cache.py`
  - 构建 `noun_sym`、`classifier_sym` 和对称边际频率；
  - 保存完整图的 degree 与关系规模缓存。

`build_cache/word_network_full/` 是预处理缓存，不是浏览器运行时文件。不要手工编辑生成的数据文件。

### 3.4 浏览器数据文件

| 文件 | 内容 |
| --- | --- |
| `data/classifier_noun_data.js` | 44,485 条 `valid_common` 量词→名词关系及四项指标 |
| `data/classifier_similarity_data.js` | 1,811 条 `cosine_similarity > 0` 的量词对 |
| `data/word_network_nodes.js` | 23,231 个词、词类、完整 degree、Global Community、可用中心性及二进制位置 |
| `data/word_network_edges.js` | 边分块 manifest、默认阈值、全局图报告和数据版本 |
| `data/word_network_edges/chunk_*.bin` | 91 个二进制邻接分块，共约 111 MB |
| `data/word_network_build_report.json` | 数据核查、关系数量、误差、Community 和中心性报告 |
| `data/word_network_communities.json` | Global Community 大小与代表词，供人工检查 |

每条二进制记录为 12 bytes：

```text
uint32 neighborLocalIndex + float64 coOccurrence
```

指标没有全部重复写入二进制：

- classifier→noun 从 `classifier_noun_data.js` 读取已验证指标；
- 同类词根据 `coOccurrence`、节点的 `symFrequency` 和 `N` 在浏览器中按相同公式计算。

`word_network_nodes.js` 的每个节点最多保存 400 条邻接记录。当前共 `9,268,437` 条邻接记录；它是**邻接记录数**，不是去重后的无向边数。

Top 400 的实际口径需要特别注意：

- 先删除非法跨词类关系，再在每个节点自己的合法邻接中排序取 400；
- 构造 TARGET 的直接邻居时，读取 TARGET 自己保存的 Top 400；
- 构造诱导子图时，遍历每个候选节点自己的 Top 400，并按无向 pair key 去重；
- 因此一条候选节点间关系只要从任一被遍历端出现，就可能进入诱导子图。

## 4. 第一个 Tab：量词—量词网络

数据来自完整正 cosine 网络，仅显示当前量词及其局部邻居。

- 节点：量词。
- 边：cosine similarity 大于等于当前阈值。
- 节点大小：完整 `valid_common` 中该量词搭配的不同名词数，视觉半径用平方根缩放。
- 边宽：`common_nonzero_nouns`。
- 边透明度和目标距离：cosine；越相似越深、越近。
- 完整正 cosine 网络中 degree 等于 1 的量词不作为普通邻居显示；中心量词始终显示。
- 点击邻居会把它设为新中心。
- 右栏的“最相似量词 Top 10”和“代表性名词 Top 10”基于完整数据，不受 slider 影响。
- 指标入口保留为单一的 `Cosine similarity`，没有伪造其他相似度。

## 5. 第二个 Tab：量词—名词网络

本 Tab 完全来自 `valid_common.xlsx`，支持双向查询：

- 搜索量词：显示 `classifier → nouns`；普通名词必须在完整数据中至少搭配 2 个不同量词。
- 搜索名词：显示 `noun ← classifiers`。
- 同时具有量词、名词身份的词优先按量词查询，并显示提示。
- 点击名词进入名词中心；点击量词回到量词中心。
- Top N 可选 10、20、50，先过滤，再按当前指标降序排序并截取。

指标与阈值方向：

| 当前指标 | 过滤规则 |
| --- | --- |
| `NPMI_log_co_score` | `score <= threshold`，这是项目固定的特殊方向 |
| PMI | `PMI >= threshold` |
| Co-occurrence | `co_occurrence >= threshold` |
| NPMI | 当前没有正式阈值方向，只排序和编码；输入控件禁用 |

边宽、透明度、距离和 Top N 排序跟随当前连接指标。周围节点大小仍来自完整 `valid_common` 的固定统计，不是当前图 degree。

## 6. 第三个 Tab：词汇网络

### 6.1 节点与关系合法性

节点集合仅为：

```python
set(valid_common["classifier"]) | set(valid_common["word"])
```

当前共有 23,231 个词：113 个量词、23,122 个名词，量词/名词身份重叠 4 个。重叠词的节点类型优先标为 classifier，形状为三角形；`alsoNoun=true` 保留双重身份信息。

关系规则：

- classifier→noun：只有 `valid_common` 中真实存在的配对才合法，方向及指标保持原始 row→column；
- noun↔noun：双向共现平均后重新计算；
- classifier↔classifier：双向共现平均后重新计算；
- 如果一个无向节点对既能被当作同类关系又在 `valid_common` 中有明确角色，浏览器数据让 `valid_common` 关系优先；
- 布局中所有边只产生一个几何 link，当前不画箭头；方向通过 `directed` 字段和 tooltip 中的 `→` 表达。

前端的 `incidentWordRelations()` 还会再次用 `validClassifierNounByPair` 检查跨词类白名单，旧缓存里即使残留普通语料跨词类边也会被丢弃。

### 6.2 当前局部图的准确构造顺序

`app.js::buildWordGraph()` 是运行时口径的最终来源：

1. 读取 TARGET 自己的 Top 400 邻接。
2. 应用 `PMI >= threshold` 与 `coOccurrence >= threshold`。
3. 根据 TARGET 词类限制合法直接邻居：
   - 量词中心：量词↔量词，或由中心量词指向名词的 valid_common 边；
   - 名词中心：名词↔名词，或由量词指向中心名词的 valid_common 边。
4. 节点候选集合为 TARGET 加这些有效 1-hop 邻居。
5. 遍历候选节点的 Top 400，保留候选集合内部且通过 PMI/共现阈值的全部合法边，并按节点对去重。
6. 在这个诱导子图上计算 `prePruneDegree`。
7. 删除 `prePruneDegree < degreeThreshold` 的非中心节点，只执行一次；TARGET 无条件保留。
8. 删除没有连接任何可见名词的非中心量词；重叠节点作为 valid_common 的名词端时会被正确识别。
9. 再计算最终 `currentDegree`。
10. 在最终可见图上运行 Local Louvain，然后绘图。

如果中心量词最后没有保留任何 valid_common 名词搭配，页面只保留中心并明确提示，不会强制留下未通过 Degree 的名词。

### 6.3 阈值和视觉指标

结构阈值固定为：

```text
PMI >= 当前值
AND co_occurrence >= 当前值
随后 degree >= 当前值，只修剪一次
```

默认值为 PMI 3、co-occurrence 30、degree 3。

- 共现滑条用 `exp(log(max) × position^1.6)`，低值区变化慢、高值区变化快；实际最大值为 26,021,095。
- Degree 最大值由每词 Top 400 决定，为 400；滑条前半段线性覆盖 1–100，后半段对数覆盖 100–400。
- 三个结构 slider 的重绘使用 220 ms debounce。

视觉选择器彼此独立：

- 节点距离：PMI / Co-occurrence / NPMI / `NPMI_log_co_score`；越强目标距离越短。
- 边宽：同四项指标。
- 节点大小：Current Degree / Full Degree / Co-occurrence with target / Betweenness / Closeness / Eigenvector / Clustering。
- Betweenness 与 Closeness 因完整固定图规模过大没有精确计算，网页选项已禁用，没有用近似值替代。
- 计数型节点大小使用平方根视觉缩放，中心节点固定突出。

这里的 `Full Degree` 是保留下来的完整混合统计图 degree，不等于当前 valid_common-only 浏览器可见图 degree。不要混淆两者。

### 6.4 Local 与 Global Community

默认使用 Local Community：

- 输入图：Degree 修剪和“非中心量词必须连接可见名词”检查后的最终可见图；
- 图类型：Graphology `UndirectedGraph`，有向 classifier→noun 在 Community 中按弱连接的一条边处理；
- 权重：PMI；
- 只纳入 `PMI > 0` 的可见边；非正 PMI 边仍可显示，但不参加 Louvain；
- 算法：`graphologyLibrary.communitiesLouvain.detailed()`；
- 随机源：按 TARGET 与三个结构阈值生成固定 seed；
- cache key：`TARGET|PMI threshold|co threshold|degree threshold`；
- 同一 TARGET 小幅改阈值时，以 community 成员 Jaccard 重叠匹配颜色，阈值为 0.2；这只稳定颜色，不改 Louvain partition。

切换为 Global Community 只改变颜色和说明，不改变节点、边、阈值或布局。

Global Community 是预处理时保留的对照层：完整混合关系图先按 PMI≥3、共现≥30 过滤，再做一次 Degree≥3 修剪，随后用 `python-louvain` 计算。它并不是当前 Top-400、valid_common-only 可见图的实时 Community，因此投射到局部图时可能混杂；这是保留用于研究对照的预期差异。

## 7. 当前数据快照

数字来自 `data/word_network_build_report.json` 与当前 JS 文件：

| 项目 | 数值 |
| --- | ---: |
| 原 vocabulary | 140,325 |
| valid_words | 23,231 |
| 量词 | 113 |
| 名词 | 23,122 |
| 量词/名词重叠 | 4 |
| valid_words 不在 vocabulary | 0 |
| valid_common 记录 | 44,485 |
| classifier→noun 全量指标匹配 | 44,485 / 44,485，容差 `1e-9` |
| 正 cosine 量词对 | 1,811 |
| 浏览器 Top-400 邻接记录 | 9,268,437 |
| 浏览器二进制数据 | 111,221,244 bytes，91 chunks |

全局分析缓存中的完整关系数：

| 关系 | 数量 |
| --- | ---: |
| classifier→noun | 1,229,966 |
| noun↔noun | 62,913,752 |
| classifier↔classifier | 5,758 |
| 总计 | 64,149,476 |

这些“完整关系数”描述保留的 Global 分析图统计空间；浏览器跨词类边另受 `valid_common_only` 规则限制。

固定 Global Community 图：

- Degree 修剪前：23,231 nodes / 692,595 edges；
- Degree 修剪后：23,054 nodes / 692,347 edges；
- communities：10；
- modularity：0.5057617696；
- 最大 community：5,259；
- 最大 connected component：23,054；
- Clustering：精确非加权；
- Eigenvector：精确 PMI 加权；
- Closeness / Betweenness：未计算。

## 8. 页面交互与状态

三个 Tab 共享搜索状态，但各自只接受合理词类：

- 选择量词会同步 `currentClassifier` 与 `wordTarget`；
- 在量词—名词 Tab 选择名词会同步 `nounCenter` 与 `wordTarget`；
- 词汇网络可以搜索全部 valid_words；
- 量词—量词 Tab 只能以量词为中心，因此从名词切回时继续使用最近一次量词。

全部网络都支持：

- 点击节点重新中心化；
- 节点拖动；
- 空白区域拖动平移；
- 滚轮缩放，范围 0.45–2.8；
- 重置视图；
- 重新布局；
- hover 邻域高亮与 tooltip；
- 标签模式：重要节点 / 全部 / 仅悬停；中心标签始终显示；
- 右侧详细信息、当前网络统计和图例。

词汇网络布局使用 `requestAnimationFrame` 短暂运行，包含节点排斥、按视觉半径碰撞、link pull 和中心吸引，随后随 alpha 冷却停止。Community 只控制颜色，不参与空间力。

页面末尾的词汇星图测试界面：

- 进入时使用当前 `wordTarget`，没有独立搜索框；
- 只为当前中心和通过固定阈值的候选节点按需加载二进制分块，不为星图复制整套边数据；
- 默认隐藏全部节点标签，悬停时只显示当前节点及其可见相邻节点的标签；
- 点击节点按椭圆球面投影旋转：目标节点沿球面轨迹进入固定中心，原有节点按深度移动和明暗变化，新外围网络从旋转后的共有节点位置承接；所有节点动画必须使用绝对 SVG 坐标，不能恢复相对 CSS 位移，否则会先飞向左上角；
- 中心切换不重置 `starView`，画布、用户已有平移和缩放均保持不动；过渡只发生在内部 `starField`；
- 支持从星体或空白处拖动平移、滚轮缩放、双击重置；拖动超过 3px 才捕获指针并抑制随后的 click；
- 边数不超过 600 时以 24fps 更新轨道；高密度网络将全部关系按样式合并为少量 SVG path，以 12fps 更新各星体及连线，不能恢复整层 CSS 旋转/呼吸（曾引起闪烁）。中心固定 `(600, 400)`；悬停暂停轨道，移开后保留累计时间，从原位置续行，防止节点穿过鼠标反复高亮；
- 切换先构建下一张图：退出节点在球面转动中淡出，共有节点接续坐标、亮度和大小，新节点错峰淡入并缓慢变大。每次重建必须取消持久边/轨道容器上的旧动画，避免 forwards 填充在新动画结束后重新压暗整个图层；动画起点读取实际悬停亮度；
- 普通星体与中心星体均不使用 SVG blur/filter 发光，节点焦点也不绘制矩形 outline；不要恢复全节点滤镜，否则高密度图会出现黑框和闪烁；
- 打开星图时停止底层词汇网络的力模拟，关闭时由普通网络重绘恢复；边与轨道的进出场按图层动画，不为每条边创建独立动画；
- 固定阈值说明收在右上角点击展开的菜单中，不提供调整控件；
- 关闭星图时清除星图 SVG 节点和边，减少额外 DOM 占用。

Hover 只修改 class、tooltip 和标签，不应触发重新筛图、重新 Louvain 或完整 DOM 重建。`style.css` 对词汇网络节点和边禁用了 transition，这是此前 Hover 白屏修复的一部分，修改 hover 样式时不要无意删除。

## 9. 如何启动

不要直接双击 `index.html`。词汇网络要用 `fetch()` 读取二进制分块，`file://` 会导致 `Failed to fetch`。

最简单的方法：

```text
双击 启动语义网络.bat
```

或在本目录运行：

```powershell
& 'C:\anaconda\envs\codex\python.exe' '.\serve_semantic_network.py'
```

浏览器入口：

```text
http://127.0.0.1:8765/
```

服务只监听本机，使用期间保留命令窗口；按 `Ctrl+C` 停止。`serve_semantic_network.py` 会加 `Cache-Control: no-store`，便于调试当前文件。

## 10. 重新生成数据

仅 `valid_common`、cosine 或前两个 Tab 数据变化：

```powershell
& 'C:\anaconda\envs\codex\python.exe' '.\prepare_data.py'
```

只修改浏览器合法关系或 Top 400 规则，并希望保留现有 Global Community 与节点指标：

```powershell
& 'C:\anaconda\envs\codex\python.exe' '.\prepare_word_network.py' '--browser-only'
```

原矩阵、词表、同类词定义或 Global 分析图发生正式变化时才运行完整流程：

```powershell
& 'C:\anaconda\envs\codex\python.exe' '.\prepare_word_network.py'
```

完整流程会处理超大稀疏矩阵，成本很高。运行前先确认确实需要，不要为了改 UI 重算数据。

## 11. 后续修改时从哪里下手

| 需求 | 首先检查 |
| --- | --- |
| 修改控件、Tab 或文案 | `index.html` |
| 修改视觉样式、hover、响应式布局 | `style.css` |
| 修改搜索、筛选、1-hop 构图、布局、Local Louvain | `app.js` |
| 修改 valid_common 或 cosine 导出 | `prepare_data.py` |
| 修改三类关系、Top 400、Global Community 或节点指标 | `prepare_word_network.py`、`build_symmetric_cache.py` |
| 修改本地启动方式 | `serve_semantic_network.py`、`启动语义网络.bat` |
| 核对当前生成结果 | `data/word_network_build_report.json` |

浏览器 Console 中可用：

```javascript
window.__NETWORK_DEBUG__.snapshot()
```

它会返回当前 Tab、TARGET、阈值、可见节点/边、关系类型、Local Community 次数与耗时、modularity、布局坐标等，适合做自动化测试和回归核对。

## 12. 最小回归检查

修改后至少通过本地 HTTP 服务核查：

1. 搜索“一棵”：量词—量词网络可点邻居，Top 10 信息不受 slider 影响。
2. 切到量词—名词：能从“一棵”点到名词，再从名词点回另一个量词；搜索“树”只返回 valid_common 量词。
3. 切到词汇网络：确认不是整张 connected component，而是 TARGET Top-400 有效 1-hop 诱导子图。
4. 检查所有 classifier→noun 可见边都能在 `valid_common` 找到。
5. 提高 PMI、共现和 Degree：Degree 只修剪一次，中心节点不消失。
6. Local/Global Community 切换：节点和边数量不变，只改颜色及说明。
7. 切换距离、边宽、节点大小：视觉变化，但同一结构条件下 Local Louvain 应命中 cache。
8. 连续 hover 名词、量词和高 degree 节点，快速移入移出并点击；页面不能白屏。
9. 拖动、缩放、平移、重新布局和重置视图均正常。
10. 用 `window.__NETWORK_DEBUG__.snapshot()` 核对实际节点、边、阈值与 Community 统计。
11. 从页尾进入词汇星图：默认中心应与 `wordTarget` 一致；默认无标签，悬停仅显示当前节点及相邻标签；点击节点应准确成为新中心且外围网络连续切换；从星体和空白处都能拖动，拖动不能误切换中心；菜单中的固定条件不可编辑；返回后三个原模块状态仍正常。
12. 用 `客厅` 做高密度回归：应为 165 节点 / 1,485 条关系，边层仅 4 个基础路径加 1 个高亮路径；外围节点坐标持续变化而中心保持 `(600, 400)`，悬停无矩形黑框。连续切换并等待动画结束，边层 opacity 应保持 1，不应回落到 0.04。

2026-09-05 本地验证：`node --check app.js` 通过；浏览器完成客厅（165 节点）→吸顶灯（21 节点）→客厅往返，最终边层 opacity 为 1，中心保持 `(600,400)`，已有平移不变。拖动空白处能平移且不切换中心；两次 DOM 采样中全部 164 个外围节点坐标变化、中心不变，未见控制台 warning/error。当前浏览器自动化接口没有单独 hover 动作，悬停暂停/续行仍需人工视觉复核；静态截图不能替代持续闪烁的最终感知检查。

## 13. 容易踩错的地方

- `Failed to fetch` 首先检查是否用 `file://` 打开；必须从 `http://127.0.0.1:8765/` 访问。
- 不要根据“页面以前计划用 Sigma”而重写渲染；当前是稳定的 SVG 实现。
- 不要把 Global Community 当成当前局部图重新计算的结果。
- 不要把 `9,268,437` 邻接记录误写成相同数量的唯一边。
- 不要把第三个 Tab 改回整张 connected component 或偷偷截为当前网络 Top N。
- 不要让非法跨词类语料共现进入浏览器，即使原始矩阵中非零。
- 不要把有向 classifier→noun 反转成“TARGET→邻居”；名词中心时仍是 `classifier → TARGET noun`。
- 不要改变第二个 Tab 中 `NPMI_log_co_score <= threshold` 的既定方向。
- 不要给 NPMI 猜一个过滤方向；当前实现明确不筛 NPMI。
- 不要让 hover 触发构图、Louvain 或完整 render。
- 不要直接手改生成的 `.js` 或 `.bin` 数据；应修改脚本后重建，并复查构建报告。
