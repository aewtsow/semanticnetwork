"use strict";

const SVG_NS = "http://www.w3.org/2000/svg";
const nounRelations = window.CLASSIFIER_NOUN_DATA;
const similarityRelations = window.CLASSIFIER_SIMILARITY_DATA;
const wordNodes = window.WORD_NETWORK_NODES;
const wordManifest = window.WORD_NETWORK_EDGE_MANIFEST;
const GraphologyUndirectedGraph = window.graphology?.UndirectedGraph;
const graphologyLouvain = window.graphologyLibrary?.communitiesLouvain;
const graphologyModularity = window.graphologyLibrary?.metrics?.graph?.modularity;

if (![nounRelations, similarityRelations, wordNodes].every(Array.isArray) || !wordManifest
  || wordManifest.classifierNounPolicy !== "valid_common_only"
  || !GraphologyUndirectedGraph || !graphologyLouvain || !graphologyModularity) {
  throw new Error("网页数据未正确加载，请先运行 prepare_data.py 和 prepare_word_network.py。");
}

const dom = {
  classifierCount: document.querySelector("#classifierCount"),
  similarityCount: document.querySelector("#similarityCount"),
  nounRelationCount: document.querySelector("#nounRelationCount"),
  wordCount: document.querySelector("#wordCount"),
  tabs: [...document.querySelectorAll(".tab-button")],
  searchForm: document.querySelector("#searchForm"),
  searchLabel: document.querySelector("#searchLabel"),
  classifierSearch: document.querySelector("#classifierSearch"),
  classifierOptions: document.querySelector("#classifierOptions"),
  searchMessage: document.querySelector("#searchMessage"),
  similarityControl: document.querySelector("#similarityControl"),
  similaritySlider: document.querySelector("#similaritySlider"),
  similarityNumber: document.querySelector("#similarityNumber"),
  npmiControl: document.querySelector("#npmiControl"),
  nounMetric: document.querySelector("#nounMetric"),
  nounThresholdLabel: document.querySelector("#nounThresholdLabel"),
  nounThresholdHelp: document.querySelector("#nounThresholdHelp"),
  npmiSlider: document.querySelector("#npmiSlider"),
  npmiNumber: document.querySelector("#npmiNumber"),
  topNControl: document.querySelector("#topNControl"),
  topNButtons: [...document.querySelectorAll("[data-topn]")],
  wordControls: document.querySelector("#wordControls"),
  wordPmiSlider: document.querySelector("#wordPmiSlider"),
  wordPmiNumber: document.querySelector("#wordPmiNumber"),
  wordCoSlider: document.querySelector("#wordCoSlider"),
  wordCoNumber: document.querySelector("#wordCoNumber"),
  wordDegreeSlider: document.querySelector("#wordDegreeSlider"),
  wordDegreeNumber: document.querySelector("#wordDegreeNumber"),
  wordDistanceMetric: document.querySelector("#wordDistanceMetric"),
  wordWidthMetric: document.querySelector("#wordWidthMetric"),
  wordSizeMetric: document.querySelector("#wordSizeMetric"),
  wordRankMetric: document.querySelector("#wordRankMetric"),
  wordCommunityMode: document.querySelector("#wordCommunityMode"),
  labelMode: document.querySelector("#labelMode"),
  graphStage: document.querySelector("#graphStage"),
  svg: document.querySelector("#networkSvg"),
  viewport: document.querySelector("#networkViewport"),
  edgeLayer: document.querySelector("#edgeLayer"),
  nodeLayer: document.querySelector("#nodeLayer"),
  graphModeLabel: document.querySelector("#graphModeLabel"),
  graphTitle: document.querySelector("#graphTitle"),
  graphEmpty: document.querySelector("#graphEmpty"),
  nounLegend: document.querySelector("#nounLegend"),
  tooltip: document.querySelector("#tooltip"),
  resetView: document.querySelector("#resetView"),
  relayoutView: document.querySelector("#relayoutView"),
  networkStats: document.querySelector("#networkStats"),
  legendContent: document.querySelector("#legendContent"),
  infoTitle: document.querySelector("#infoTitle"),
  primaryMetric: document.querySelector("#primaryMetric"),
  thresholdNote: document.querySelector("#thresholdNote"),
  infoSections: document.querySelector("#infoSections"),
  openStarMap: document.querySelector("#openStarMap"),
  starMap: document.querySelector("#starMap"),
  closeStarMap: document.querySelector("#closeStarMap"),
  starRuleMenu: document.querySelector("#starRuleMenu"),
  starStage: document.querySelector("#starStage"),
  starSvg: document.querySelector("#starSvg"),
  starViewport: document.querySelector("#starViewport"),
  starField: document.querySelector("#starField"),
  starOrbitLayer: document.querySelector("#starOrbitLayer"),
  starEdgeLayer: document.querySelector("#starEdgeLayer"),
  starNodeLayer: document.querySelector("#starNodeLayer"),
  starLoading: document.querySelector("#starLoading"),
  starEmpty: document.querySelector("#starEmpty"),
  starStatus: document.querySelector("#starStatus"),
};

const classifierToNouns = new Map();
const nounToClassifiers = new Map();
const classifierToSimilarities = new Map();
const validClassifierNounByPair = new Map();

for (const relation of nounRelations) {
  addToIndex(classifierToNouns, relation.classifier, relation);
  addToIndex(nounToClassifiers, relation.word, relation);
  const pairKey = unorderedWordPairKey(relation.classifier, relation.word);
  const previous = validClassifierNounByPair.get(pairKey);
  if (previous && (previous.classifier !== relation.classifier || previous.word !== relation.word)) {
    throw new Error(`valid_common 中存在无法无歧义表示的双向角色：${relation.classifier}—${relation.word}`);
  }
  validClassifierNounByPair.set(pairKey, relation);
}
for (const relation of similarityRelations) {
  addToIndex(classifierToSimilarities, relation.source, {
    classifier: relation.target,
    similarity: relation.similarity,
    commonNouns: relation.commonNouns,
  });
  addToIndex(classifierToSimilarities, relation.target, {
    classifier: relation.source,
    similarity: relation.similarity,
    commonNouns: relation.commonNouns,
  });
}
for (const rows of classifierToNouns.values()) rows.sort((a, b) => b.score - a.score);
for (const rows of nounToClassifiers.values()) rows.sort((a, b) => b.score - a.score);
for (const rows of classifierToSimilarities.values()) rows.sort((a, b) => b.similarity - a.similarity);

const classifiers = [...classifierToNouns.keys()].sort(zhSort);
const classifierSet = new Set(classifiers);
const nouns = [...nounToClassifiers.keys()].sort(zhSort);
const nounSet = new Set(nouns);
const classifierNounSearchWords = [...new Set([...classifiers, ...nouns])].sort(zhSort);
const classifierNounSearchSet = new Set(classifierNounSearchWords);
const classifierNounCount = new Map([...classifierToNouns].map(([key, rows]) => [
  key, new Set(rows.map((row) => row.word)).size,
]));
const nounClassifierCount = new Map([...nounToClassifiers].map(([key, rows]) => [
  key, new Set(rows.map((row) => row.classifier)).size,
]));
const fullSimilarityDegree = new Map(classifiers.map((classifier) => [
  classifier, (classifierToSimilarities.get(classifier) || []).length,
]));
const wordNodeById = new Map(wordNodes.map((node, index) => [node.id, { ...node, index }]));
const wordSet = new Set(wordNodeById.keys());
const wordChunkBuffers = new Map();

const similarityMax = Math.max(...similarityRelations.map((row) => row.similarity));
const classifierCountRange = extent([...classifierNounCount.values()]);
const nounCountRange = extent([...nounClassifierCount.values()]);
const commonNounRange = extent(similarityRelations.map((row) => row.commonNouns));
const WORD_CO_MAX = Number(wordManifest.coOccurrenceMax);
const WORD_CO_SLIDER_MAX = 1000;
const WORD_CO_CURVE = 1.6;
const WORD_DEGREE_MAX = Number(wordManifest.topKPerNode);
const WORD_DEGREE_SLIDER_MAX = 1000;
const WORD_DEGREE_SLIDER_MID = WORD_DEGREE_SLIDER_MAX / 2;
const WORD_DEGREE_KNEE = Math.min(100, WORD_DEGREE_MAX);
const COMMUNITY_COLORS = [
  "#8f5d5d", "#58758a", "#8a7750", "#56796f", "#75698d",
  "#9a6d4a", "#607c91", "#7f6555", "#687d58", "#8b6477",
];
const NEUTRAL_COMMUNITY_COLOR = "#aaa79f";
const GLOBAL_MODULARITY = Number(wordManifest.communityGraph?.modularity);
const WORD_RENDER_DEBOUNCE_MS = 220;
const STAR_PMI_THRESHOLD = 3;
const STAR_CO_THRESHOLD = 100;
const STAR_DEGREE_THRESHOLD = 2;
const STAR_CENTER_X = 600;
const STAR_CENTER_Y = 400;
const STAR_VIEWBOX_WIDTH = 1200;
const STAR_VIEWBOX_HEIGHT = 800;
const STAR_FRAME_INTERVAL_MS = 1000 / 24;
const STAR_LIVE_MOTION_EDGE_LIMIT = 600;
const STAR_GLOBE_RADIUS_X = 500;
const STAR_GLOBE_RADIUS_Y = 305;
const STAR_TURN_DURATION_MS = 900;
const STAR_ARRIVAL_DURATION_MS = 1000;
const STAR_ARRIVAL_STAGGER_MS = 180;
const nounMetricSpecs = {
  score: {
    label: "NPMI_log_co_score", direction: "lte", step: 0.01,
    help: "严格显示 NPMI_log_co_score ≤ 当前阈值的搭配。",
  },
  npmi: {
    label: "NPMI", direction: "none", step: 0.001,
    help: "项目尚未规定 NPMI 的阈值方向；当前仅按 NPMI 排序和编码，不做阈值筛选。",
  },
  pmi: {
    label: "PMI", direction: "gte", step: 0.01,
    help: "严格显示 PMI ≥ 当前阈值的搭配。",
  },
  coOccurrence: {
    label: "Co-occurrence", direction: "gte", step: 1,
    help: "严格显示 co_occurrence ≥ 当前阈值的搭配。",
  },
};
const nounMetricRanges = Object.fromEntries(Object.keys(nounMetricSpecs).map((metric) => [
  metric, extent(nounRelations.map((row) => row[metric])),
]));

const state = {
  activeTab: "classifier",
  currentClassifier: classifierSet.has("一棵") ? "一棵" : classifiers[0],
  nounCenter: null,
  wordTarget: wordSet.has("一棵") ? "一棵" : wordNodes[0].id,
  similarityThreshold: 0,
  nounMetric: "score",
  nounThreshold: nounMetricRanges.score[1],
  topN: 10,
  labelMode: "important",
  hoveredNodeId: null,
  wordPmiThreshold: Number(wordManifest.defaults.pmiThreshold),
  wordCoThreshold: Number(wordManifest.defaults.coOccurrenceThreshold),
  wordDegreeThreshold: Number(wordManifest.defaults.degreeThreshold),
  wordDistanceMetric: "pmi",
  wordWidthMetric: "coOccurrence",
  wordSizeMetric: "currentDegree",
  wordRankMetric: "pmi",
  wordCommunityMode: "local",
  wordCommunityCache: new Map(),
  wordLocalColorState: { target: null, groups: [], nextSlot: 0 },
  wordCommunityRunCount: 0,
  wordRenderTimer: null,
  wordBuffersLoaded: false,
  wordBuffersPromise: null,
  wordChunkPromises: new Map(),
  layoutSeed: 0,
  view: { x: 0, y: 0, scale: 1 },
  currentGraph: { nodes: [], edges: [], visibleCount: 0 },
  drag: null,
  pan: null,
  renderToken: 0,
  wordLayoutTarget: null,
  wordPositionCache: new Map(),
  wordSimulation: null,
  starOpen: false,
  starGraph: null,
  starAnimationFrame: null,
  starAnimationStarted: null,
  starLastFrame: 0,
  starRenderToken: 0,
  starTransitioning: false,
  starView: { x: 0, y: 0, scale: 1 },
  starPan: null,
  starSuppressClickUntil: 0,
};

let suppressNextNodeClick = false;

function addToIndex(index, key, value) {
  if (!index.has(key)) index.set(key, []);
  index.get(key).push(value);
}

function unorderedWordPairKey(first, second) {
  return first <= second ? `${first}\u0000${second}` : `${second}\u0000${first}`;
}

function zhSort(a, b) {
  return String(a).localeCompare(String(b), "zh-CN");
}

function extent(values) {
  return [Math.min(...values), Math.max(...values)];
}

function communityColor(community) {
  if (!Number.isInteger(community)) return NEUTRAL_COMMUNITY_COLOR;
  return COMMUNITY_COLORS[community % COMMUNITY_COLORS.length];
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function scaleSqrt(value, [min, max], outputMin, outputMax) {
  if (!Number.isFinite(value) || max === min) return (outputMin + outputMax) / 2;
  const normalized = Math.sqrt(Math.max(0, value - min)) / Math.sqrt(max - min);
  return outputMin + clamp(normalized, 0, 1) * (outputMax - outputMin);
}

function scaleLinear(value, [min, max], outputMin, outputMax) {
  if (!Number.isFinite(value) || max === min) return (outputMin + outputMax) / 2;
  return outputMin + clamp((value - min) / (max - min), 0, 1) * (outputMax - outputMin);
}

function scaleMetric(value, range, outputMin, outputMax, metric) {
  if (metric === "coOccurrence") {
    return scaleLinear(
      Math.log1p(Math.max(0, value)),
      range.map((item) => Math.log1p(Math.max(0, item))),
      outputMin,
      outputMax,
    );
  }
  return scaleLinear(value, range, outputMin, outputMax);
}

function formatNumber(value, digits = 3) {
  if (value === null || value === undefined || value === "") return "未计算";
  if (!Number.isFinite(Number(value))) return "未计算";
  return Number(value).toFixed(digits);
}

function classifierNodeSize(classifier, center = false) {
  const size = scaleSqrt(classifierNounCount.get(classifier) || 1, classifierCountRange, 10, 24);
  return center ? Math.max(22, size + 5) : size;
}

function nounNodeSize(noun, center = false) {
  const size = scaleSqrt(nounClassifierCount.get(noun) || 1, nounCountRange, 9, 22);
  return center ? Math.max(22, size + 5) : size;
}

function classifierTooltip(classifier, edgeText = "") {
  const similarities = classifierToSimilarities.get(classifier) || [];
  const maximum = similarities.length ? similarities[0].similarity : 0;
  return [
    `搭配名词数：${(classifierNounCount.get(classifier) || 0).toLocaleString()}`,
    `相似量词数：${similarities.length.toLocaleString()}`,
    `最高 cosine：${formatNumber(maximum)}`,
    edgeText,
  ].filter(Boolean).join("<br>");
}

function buildClassifierGraph() {
  const center = state.currentClassifier;
  const allNeighbors = classifierToSimilarities.get(center) || [];
  const eligible = allNeighbors.filter((row) => (fullSimilarityDegree.get(row.classifier) || 0) !== 1);
  const visible = eligible.filter((row) => row.similarity >= state.similarityThreshold);
  const stableIndex = new Map(eligible.map((row, index) => [row.classifier, index]));
  const nodes = [{
    id: `c:${center}`, label: center, type: "classifier", center: true,
    size: classifierNodeSize(center, true), fullCount: classifierNounCount.get(center),
    x: 0, y: 0, tooltip: classifierTooltip(center),
  }];
  const edges = [];
  for (const row of visible) {
    const ratio = row.similarity / similarityMax;
    nodes.push({
      id: `c:${row.classifier}`, label: row.classifier, type: "classifier", center: false,
      size: classifierNodeSize(row.classifier), fullCount: classifierNounCount.get(row.classifier),
      angle: -Math.PI / 2 + stableIndex.get(row.classifier) * 2.399963 + state.layoutSeed * 0.37,
      distanceFactor: 1 - Math.pow(ratio, 0.34),
      tooltip: classifierTooltip(
        row.classifier,
        `与“${center}”的 cosine：${formatNumber(row.similarity)}<br>共同名词：${row.commonNouns.toLocaleString()}`,
      ),
    });
    edges.push({
      id: `s:${center}|${row.classifier}`, source: `c:${center}`, target: `c:${row.classifier}`,
      width: scaleSqrt(row.commonNouns, commonNounRange, 1.2, 7),
      opacity: scaleLinear(row.similarity, [0, similarityMax], 0.2, 0.92),
      metric: "similarity", value: row.similarity, commonNouns: row.commonNouns,
    });
  }
  return { nodes, edges, visibleCount: visible.length, qualifiedCount: visible.length };
}

function nounRelationPasses(row) {
  const spec = nounMetricSpecs[state.nounMetric];
  if (spec.direction === "lte") return row[state.nounMetric] <= state.nounThreshold;
  if (spec.direction === "gte") return row[state.nounMetric] >= state.nounThreshold;
  return true;
}

function buildClassifierNounGraph() {
  if (state.nounCenter) return buildNounCenterGraph();
  const classifier = state.currentClassifier;
  const allRelations = classifierToNouns.get(classifier) || [];
  const eligible = allRelations.filter((row) => (nounClassifierCount.get(row.word) || 0) >= 2);
  const qualified = eligible.filter(nounRelationPasses)
    .sort((a, b) => b[state.nounMetric] - a[state.nounMetric]);
  const visible = qualified.slice(0, state.topN);
  const stableIndex = new Map(qualified.map((row, index) => [row.word, index]));
  const range = nounMetricRanges[state.nounMetric];
  const nodes = [{
    id: `c:${classifier}`, label: classifier, type: "classifier", center: true,
    size: classifierNodeSize(classifier, true), fullCount: classifierNounCount.get(classifier),
    x: 0, y: 0, tooltip: classifierTooltip(classifier),
  }];
  const edges = [];
  for (const row of visible) {
    const value = row[state.nounMetric];
    const strength = scaleMetric(value, range, 0, 1, state.nounMetric);
    nodes.push({
      id: `n:${row.word}`, label: row.word, type: "noun", center: false,
      size: nounNodeSize(row.word), fullCount: nounClassifierCount.get(row.word),
      angle: -Math.PI / 2 + stableIndex.get(row.word) * 2.399963 + state.layoutSeed * 0.37,
      distanceFactor: 1 - Math.pow(strength, 0.35),
      tooltip: `可搭配量词数：${nounClassifierCount.get(row.word)}<br>与“${classifier}”的 ${nounMetricSpecs[state.nounMetric].label}：${formatNumber(value)}`,
    });
    edges.push({
      id: `n:${classifier}|${row.word}`, source: `c:${classifier}`, target: `n:${row.word}`,
      width: scaleMetric(value, range, 1.1, 6.5, state.nounMetric),
      opacity: scaleMetric(value, range, 0.3, 0.9, state.nounMetric),
      metric: state.nounMetric, value,
    });
  }
  return {
    nodes, edges, visibleCount: visible.length, qualifiedCount: qualified.length,
    visibleRelations: visible,
  };
}

function buildNounCenterGraph() {
  const noun = state.nounCenter;
  const allRelations = nounToClassifiers.get(noun) || [];
  const qualified = allRelations.filter(nounRelationPasses)
    .sort((a, b) => b[state.nounMetric] - a[state.nounMetric]);
  const visible = qualified.slice(0, state.topN);
  const stableIndex = new Map(qualified.map((row, index) => [row.classifier, index]));
  const range = nounMetricRanges[state.nounMetric];
  const nodes = [{
    id: `n:${noun}`, label: noun, type: "noun", center: true,
    size: nounNodeSize(noun, true), fullCount: nounClassifierCount.get(noun),
    x: 0, y: 0,
    tooltip: `完整数据可搭配量词数：${nounClassifierCount.get(noun)}<br>当前阈值下可见量词数：${visible.length}`,
  }];
  const edges = [];
  for (const row of visible) {
    const value = row[state.nounMetric];
    const strength = scaleMetric(value, range, 0, 1, state.nounMetric);
    nodes.push({
      id: `c:${row.classifier}`, label: row.classifier, type: "classifier", center: false,
      size: classifierNodeSize(row.classifier), fullCount: classifierNounCount.get(row.classifier),
      angle: -Math.PI / 2 + stableIndex.get(row.classifier) * 2.399963 + state.layoutSeed * 0.37,
      distanceFactor: 1 - Math.pow(strength, 0.35),
      tooltip: classifierTooltip(
        row.classifier,
        `与“${noun}”的 ${nounMetricSpecs[state.nounMetric].label}：${formatNumber(value)}`,
      ),
    });
    edges.push({
      id: `n:${noun}|${row.classifier}`, source: `n:${noun}`, target: `c:${row.classifier}`,
      width: scaleMetric(value, range, 1.1, 6.5, state.nounMetric),
      opacity: scaleMetric(value, range, 0.3, 0.9, state.nounMetric),
      metric: state.nounMetric, value,
    });
  }
  return {
    nodes, edges, visibleCount: visible.length, qualifiedCount: qualified.length,
    visibleRelations: visible,
  };
}

function loadWordChunk(chunkIndex) {
  if (wordChunkBuffers.has(chunkIndex)) return Promise.resolve();
  if (!state.wordChunkPromises.has(chunkIndex)) {
    const chunk = wordManifest.chunks[chunkIndex];
    const promise = fetch(`${wordManifest.chunkBasePath}${chunk.file}`).then(async (response) => {
      if (!response.ok) throw new Error(`词汇网络数据分块加载失败：${chunk.file}`);
      wordChunkBuffers.set(chunkIndex, await response.arrayBuffer());
    });
    state.wordChunkPromises.set(chunkIndex, promise);
  }
  return state.wordChunkPromises.get(chunkIndex);
}

async function ensureWordChunks(nodeIndices) {
  const chunkIndices = new Set(nodeIndices.map((index) => wordNodes[index].chunk));
  await Promise.all([...chunkIndices].map(loadWordChunk));
}

async function ensureWordBuffers() {
  if (state.wordBuffersLoaded) return;
  if (!state.wordBuffersPromise) {
    state.wordBuffersPromise = Promise.all(
      wordManifest.chunks.map((_, index) => loadWordChunk(index)),
    ).then(() => { state.wordBuffersLoaded = true; });
  }
  await state.wordBuffersPromise;
}

function incidentWordRelations(nodeIndex) {
  const node = wordNodes[nodeIndex];
  const buffer = wordChunkBuffers.get(node.chunk);
  if (!buffer) return [];
  const view = new DataView(buffer);
  const rows = [];
  for (let offset = 0; offset < node.count; offset += 1) {
    const byteOffset = (node.offset + offset) * wordManifest.recordBytes;
    const neighborIndex = view.getUint32(byteOffset, true);
    let coOccurrence = view.getFloat64(byteOffset + 4, true);
    const neighbor = wordNodes[neighborIndex];
    const validClassifierNoun = validClassifierNounByPair.get(
      unorderedWordPairKey(node.id, neighbor.id),
    );
    const sameType = node.type === neighbor.type;
    let sourceIndex;
    let targetIndex;
    let relationType;
    let directed;
    let total;
    let sourceFrequency;
    let targetFrequency;
    let pmi;
    let npmi;
    let score;
    if (validClassifierNoun) {
      sourceIndex = wordNodeById.get(validClassifierNoun.classifier).index;
      targetIndex = wordNodeById.get(validClassifierNoun.word).index;
      relationType = "classifier_noun";
      directed = true;
      coOccurrence = validClassifierNoun.coOccurrence;
      pmi = validClassifierNoun.pmi;
      npmi = validClassifierNoun.npmi;
      score = validClassifierNoun.score;
    } else if (sameType) {
      sourceIndex = Math.min(nodeIndex, neighborIndex);
      targetIndex = Math.max(nodeIndex, neighborIndex);
      relationType = node.type === "classifier" ? "classifier_classifier" : "noun_noun";
      directed = false;
      total = wordManifest.symmetricTotal;
      sourceFrequency = wordNodes[sourceIndex].symFrequency;
      targetFrequency = wordNodes[targetIndex].symFrequency;
    } else {
      // 浏览器数据只允许 valid_common 中存在的量词—名词关系。
      // 若旧缓存中残留普通语料跨词类边，在这里明确忽略。
      continue;
    }
    if (!validClassifierNoun) {
      pmi = Math.log(total) + Math.log(coOccurrence)
        - Math.log(sourceFrequency) - Math.log(targetFrequency);
      npmi = pmi / -Math.log(coOccurrence / total);
      score = npmi * Math.log(coOccurrence);
    }
    rows.push({
      key: `${Math.min(nodeIndex, neighborIndex)}|${Math.max(nodeIndex, neighborIndex)}`,
      nodeIndex, neighborIndex, neighbor: neighbor.id,
      sourceIndex, targetIndex,
      sourceWord: wordNodes[sourceIndex].id,
      targetWord: wordNodes[targetIndex].id,
      relationType, directed,
      coOccurrence, pmi, npmi, score,
    });
  }
  return rows;
}

function weakDegree(nodeIndices, edges) {
  const neighbors = new Map([...nodeIndices].map((index) => [index, new Set()]));
  for (const edge of edges) {
    neighbors.get(edge.sourceIndex)?.add(edge.targetIndex);
    neighbors.get(edge.targetIndex)?.add(edge.sourceIndex);
  }
  return new Map([...neighbors].map(([index, rows]) => [index, rows.size]));
}

function wordNodeSizeValue(index, currentDegree, directCo) {
  const node = wordNodes[index];
  if (state.wordSizeMetric === "currentDegree") return currentDegree.get(index) || 0;
  if (state.wordSizeMetric === "fullDegree") return node.degreeFull;
  if (state.wordSizeMetric === "coWithTarget") return directCo.get(index) || 0;
  return Number(node[state.wordSizeMetric]);
}

function wordCommunityCacheKey() {
  return [
    state.wordTarget,
    state.wordPmiThreshold,
    state.wordCoThreshold,
    state.wordDegreeThreshold,
  ].join("|");
}

function seededRandom(seedText) {
  let seed = 2166136261;
  for (let index = 0; index < seedText.length; index += 1) {
    seed ^= seedText.charCodeAt(index);
    seed = Math.imul(seed, 16777619);
  }
  return () => {
    seed += 0x6D2B79F5;
    let value = seed;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function partitionGroups(partition) {
  const groups = new Map();
  for (const [nodeIndex, community] of partition) {
    if (!groups.has(community)) groups.set(community, new Set());
    groups.get(community).add(nodeIndex);
  }
  return groups;
}

function jaccardSimilarity(first, second) {
  let intersection = 0;
  const smaller = first.size <= second.size ? first : second;
  const larger = smaller === first ? second : first;
  for (const member of smaller) if (larger.has(member)) intersection += 1;
  return intersection / (first.size + second.size - intersection);
}

function stableLocalCommunityColors(partition) {
  if (state.wordLocalColorState.target !== state.wordTarget) {
    state.wordLocalColorState = { target: state.wordTarget, groups: [], nextSlot: 0 };
  }
  const currentGroups = [...partitionGroups(partition)].map(([community, members]) => ({
    community, members, colorSlot: null,
  }));
  const candidates = [];
  state.wordLocalColorState.groups.forEach((previous, previousIndex) => {
    currentGroups.forEach((current, currentIndex) => {
      const similarity = jaccardSimilarity(previous.members, current.members);
      if (similarity >= 0.2) candidates.push({ previousIndex, currentIndex, similarity });
    });
  });
  candidates.sort((a, b) => b.similarity - a.similarity);
  const matchedPrevious = new Set();
  const matchedCurrent = new Set();
  for (const candidate of candidates) {
    if (matchedPrevious.has(candidate.previousIndex) || matchedCurrent.has(candidate.currentIndex)) continue;
    currentGroups[candidate.currentIndex].colorSlot = state.wordLocalColorState.groups[candidate.previousIndex].colorSlot;
    matchedPrevious.add(candidate.previousIndex);
    matchedCurrent.add(candidate.currentIndex);
  }
  const usedSlots = new Set(currentGroups.map((group) => group.colorSlot).filter(Number.isInteger));
  let nextSlot = state.wordLocalColorState.nextSlot;
  for (const group of currentGroups.sort((a, b) => b.members.size - a.members.size)) {
    if (Number.isInteger(group.colorSlot)) continue;
    let attempts = 0;
    while (usedSlots.has(nextSlot % COMMUNITY_COLORS.length) && attempts < COMMUNITY_COLORS.length) {
      nextSlot += 1;
      attempts += 1;
    }
    group.colorSlot = nextSlot % COMMUNITY_COLORS.length;
    usedSlots.add(group.colorSlot);
    nextSlot += 1;
  }
  state.wordLocalColorState = {
    target: state.wordTarget,
    groups: currentGroups.map((group) => ({ members: group.members, colorSlot: group.colorSlot })),
    nextSlot,
  };
  return new Map(currentGroups.map((group) => [group.community, group.colorSlot]));
}

function computeLocalCommunity(component, componentEdges) {
  const cacheKey = wordCommunityCacheKey();
  let result = state.wordCommunityCache.get(cacheKey);
  let cacheHit = true;
  if (!result) {
    cacheHit = false;
    const positiveEdges = componentEdges.filter((edge) => edge.pmi > 0);
    if (component.size < 2 || positiveEdges.length === 0) {
      result = {
        available: false, partition: new Map(), communityCount: null, modularity: null,
        globalProjectedModularity: null, positiveEdgeCount: positiveEdges.length,
        computationMs: 0,
      };
    } else {
      const started = performance.now();
      const graph = new GraphologyUndirectedGraph({ allowSelfLoops: false, multi: false });
      let allGlobalCommunitiesAvailable = true;
      for (const nodeIndex of component) {
        const globalCommunity = wordNodes[nodeIndex].community;
        if (!Number.isInteger(globalCommunity)) allGlobalCommunitiesAvailable = false;
        graph.addNode(String(nodeIndex), {
          globalCommunity: Number.isInteger(globalCommunity) ? globalCommunity : `unassigned:${nodeIndex}`,
        });
      }
      for (const edge of positiveEdges) {
        graph.addUndirectedEdgeWithKey(edge.key, String(edge.sourceIndex), String(edge.targetIndex), {
          weight: edge.pmi,
        });
      }
      const details = graphologyLouvain.detailed(graph, {
        getEdgeWeight: "weight",
        randomWalk: true,
        rng: seededRandom(cacheKey),
      });
      const partition = new Map(Object.entries(details.communities).map(
        ([nodeIndex, community]) => [Number(nodeIndex), community],
      ));
      result = {
        available: true,
        partition,
        communityCount: details.count,
        modularity: details.modularity,
        globalProjectedModularity: allGlobalCommunitiesAvailable
          ? graphologyModularity(graph, {
            getNodeCommunity: "globalCommunity",
            getEdgeWeight: "weight",
          })
          : null,
        positiveEdgeCount: positiveEdges.length,
        computationMs: performance.now() - started,
      };
      state.wordCommunityRunCount += 1;
    }
    state.wordCommunityCache.set(cacheKey, result);
  }
  return {
    ...result,
    cacheHit,
    colorSlots: result.available ? stableLocalCommunityColors(result.partition) : new Map(),
  };
}

function displayCommunity(community, unavailableText = "未纳入固定分析图") {
  return Number.isInteger(community) ? community : unavailableText;
}

function wordNodeTooltip(node) {
  const communityRows = state.wordCommunityMode === "local"
    ? [
      `Local Community：${displayCommunity(node.localCommunity, "不可计算")}`,
      `Global Community：${displayCommunity(node.globalCommunity)}`,
    ]
    : [
      `Global Community：${displayCommunity(node.globalCommunity)}`,
      `Local Community：${displayCommunity(node.localCommunity, "不可计算")}`,
    ];
  return [
    `词类：${node.type === "classifier" ? node.alsoNoun ? "量词（亦作名词）" : "量词" : "名词"}`,
    ...communityRows,
    `Current Degree：${node.currentDegree}`,
    `Full Degree：${node.fullCount.toLocaleString()}`,
    `与当前目标直接共现：${node.directCo.toLocaleString()}`,
  ].join("<br>");
}

function applyWordCommunityMode(graph) {
  if (state.activeTab !== "word") return;
  for (const node of graph.nodes) {
    if (state.wordCommunityMode === "local") {
      node.community = node.localCommunity;
      node.color = Number.isInteger(node.localColorSlot)
        ? communityColor(node.localColorSlot) : NEUTRAL_COMMUNITY_COLOR;
    } else {
      node.community = node.globalCommunity;
      node.color = communityColor(node.globalCommunity);
    }
    node.tooltip = wordNodeTooltip(node);
  }
}

function refreshWordCommunityPresentation() {
  if (state.activeTab !== "word" || !state.currentGraph.currentDegree) return;
  applyWordCommunityMode(state.currentGraph);
  document.body.dataset.wordCommunityMode = state.wordCommunityMode;
  const nodeById = new Map(state.currentGraph.nodes.map((node) => [node.id, node]));
  for (const element of dom.nodeLayer.children) {
    const node = nodeById.get(element.dataset.nodeId);
    if (!node) continue;
    element.dataset.community = node.community ?? "";
    element.dataset.localCommunity = node.localCommunity ?? "";
    element.dataset.globalCommunity = node.globalCommunity ?? "";
    const shape = element.querySelector(".node-circle");
    if (shape) shape.style.fill = node.color;
  }
  renderWordInformation(state.currentGraph);
  updateNetworkStats(state.currentGraph);
  updateLegend();
}

function targetRelationIsAllowed(targetIndex, edge) {
  const target = wordNodes[targetIndex];
  if (target.type === "classifier") {
    return edge.relationType === "classifier_classifier"
      || (edge.relationType === "classifier_noun" && edge.sourceIndex === targetIndex);
  }
  return edge.relationType === "noun_noun"
    || (edge.relationType === "classifier_noun" && edge.targetIndex === targetIndex);
}

function buildWordGraph() {
  const targetIndex = wordNodeById.get(state.wordTarget).index;
  const targetRelations = incidentWordRelations(targetIndex).filter(
    (edge) => targetRelationIsAllowed(targetIndex, edge)
      && edge.pmi >= state.wordPmiThreshold
      && edge.coOccurrence >= state.wordCoThreshold,
  );
  const candidateIndices = new Set([targetIndex, ...targetRelations.map((row) => row.neighborIndex)]);
  const filteredEdgeByKey = new Map();
  for (const nodeIndex of candidateIndices) {
    for (const edge of incidentWordRelations(nodeIndex)) {
      if (!candidateIndices.has(edge.neighborIndex)) continue;
      if (edge.pmi < state.wordPmiThreshold || edge.coOccurrence < state.wordCoThreshold) continue;
      if (!filteredEdgeByKey.has(edge.key)) filteredEdgeByKey.set(edge.key, edge);
    }
  }
  const filteredEdges = [...filteredEdgeByKey.values()];
  const prePruneDegree = weakDegree(candidateIndices, filteredEdges);
  const visibleIndices = new Set([targetIndex]);
  for (const nodeIndex of candidateIndices) {
    if (nodeIndex !== targetIndex && (prePruneDegree.get(nodeIndex) || 0) >= state.wordDegreeThreshold) {
      visibleIndices.add(nodeIndex);
    }
  }
  let visibleEdges = filteredEdges.filter(
    (edge) => visibleIndices.has(edge.sourceIndex) && visibleIndices.has(edge.targetIndex),
  );
  const classifiersWithVisibleNoun = new Set();
  const overlapNodesServingAsNouns = new Set();
  for (const edge of visibleEdges) {
    if (edge.relationType !== "classifier_noun") continue;
    classifiersWithVisibleNoun.add(edge.sourceIndex);
    if (wordNodes[edge.targetIndex].alsoNoun) overlapNodesServingAsNouns.add(edge.targetIndex);
  }
  const removedUnpairedClassifiers = [];
  for (const nodeIndex of [...visibleIndices]) {
    if (nodeIndex === targetIndex || wordNodes[nodeIndex].type !== "classifier") continue;
    if (classifiersWithVisibleNoun.has(nodeIndex) || overlapNodesServingAsNouns.has(nodeIndex)) continue;
    visibleIndices.delete(nodeIndex);
    removedUnpairedClassifiers.push(nodeIndex);
  }
  visibleEdges = visibleEdges.filter(
    (edge) => visibleIndices.has(edge.sourceIndex) && visibleIndices.has(edge.targetIndex),
  );
  const currentDegree = weakDegree(visibleIndices, visibleEdges);
  const visibleTargetRelations = targetRelations.filter((edge) => visibleIndices.has(edge.neighborIndex));
  const centerValidNounCount = visibleTargetRelations.filter(
    (edge) => edge.relationType === "classifier_noun" && edge.sourceIndex === targetIndex,
  ).length;
  const localCommunity = computeLocalCommunity(visibleIndices, visibleEdges);
  const directCo = new Map(targetRelations.map((row) => [row.neighborIndex, row.coOccurrence]));
  const rawSizes = [...visibleIndices].map((index) => wordNodeSizeValue(index, currentDegree, directCo));
  const sizeRange = extent(rawSizes.map((value) => Number.isFinite(value) ? value : 0));
  const metricRange = {};
  for (const metric of ["pmi", "coOccurrence", "npmi", "score"]) {
    metricRange[metric] = visibleEdges.length ? extent(visibleEdges.map((edge) => edge[metric])) : [0, 1];
  }
  const nodes = [...visibleIndices].map((index) => {
    const source = wordNodes[index];
    const center = index === targetIndex;
    const rawSize = wordNodeSizeValue(index, currentDegree, directCo);
    return {
      id: `w:${index}`, wordIndex: index, label: source.id, type: source.type,
      alsoNoun: source.alsoNoun,
      shape: source.type === "classifier" ? "triangle" : "circle", center,
      size: center ? 24 : scaleSqrt(Number.isFinite(rawSize) ? rawSize : 0, sizeRange, 7, 21),
      fullCount: source.degreeFull, currentDegree: currentDegree.get(index) || 0,
      prePruneDegree: prePruneDegree.get(index) || 0,
      globalCommunity: source.community,
      localCommunity: localCommunity.partition.get(index) ?? null,
      localColorSlot: localCommunity.colorSlots.get(localCommunity.partition.get(index)) ?? null,
      directCo: directCo.get(index) || 0,
    };
  });
  const edges = visibleEdges.map((edge, index) => ({
    ...edge,
    id: `w:${edge.key}:${index}`,
    source: `w:${edge.sourceIndex}`, target: `w:${edge.targetIndex}`,
    width: scaleMetric(edge[state.wordWidthMetric], metricRange[state.wordWidthMetric], 0.7, 5.8, state.wordWidthMetric),
    opacity: scaleMetric(edge.pmi, metricRange.pmi, 0.18, 0.78, "pmi"),
    distance: scaleMetric(edge[state.wordDistanceMetric], metricRange[state.wordDistanceMetric], 220, 75, state.wordDistanceMetric),
    layoutStrength: scaleMetric(
      edge[state.wordDistanceMetric], metricRange[state.wordDistanceMetric], 0.45, 1,
      state.wordDistanceMetric,
    ),
    metric: state.wordWidthMetric, value: edge[state.wordWidthMetric],
  }));
  const graph = {
    nodes, edges, visibleCount: Math.max(0, nodes.length - 1),
    qualifiedCount: Math.max(0, visibleIndices.size - 1), candidateCount: candidateIndices.size,
    filteredEdgeCount: filteredEdges.length, currentDegree, prePruneDegree,
    targetRelations: visibleTargetRelations,
    directNeighborCount: targetRelations.length,
    finalDirectNeighborCount: visibleTargetRelations.length,
    centerValidNounCount,
    removedUnpairedClassifierCount: removedUnpairedClassifiers.length,
    validClassifierNounEdgeCount: visibleEdges.filter(
      (edge) => edge.relationType === "classifier_noun",
    ).length,
    centerPrePruneDegree: prePruneDegree.get(targetIndex) || 0,
    componentNodeCount: nodes.length, componentEdgeCount: edges.length,
    localCommunityAvailable: localCommunity.available,
    localCommunityCount: localCommunity.communityCount,
    localModularity: localCommunity.modularity,
    globalProjectedModularity: localCommunity.globalProjectedModularity,
    localPositiveEdgeCount: localCommunity.positiveEdgeCount,
    localCommunityMs: localCommunity.computationMs,
    localCommunityCacheHit: localCommunity.cacheHit,
  };
  applyWordCommunityMode(graph);
  return graph;
}

function starRelationPasses(edge) {
  return edge.pmi > STAR_PMI_THRESHOLD && edge.coOccurrence > STAR_CO_THRESHOLD;
}

async function ensureStarGraphBuffers(targetIndex) {
  await ensureWordChunks([targetIndex]);
  const directNeighborIndices = incidentWordRelations(targetIndex)
    .filter((edge) => targetRelationIsAllowed(targetIndex, edge) && starRelationPasses(edge))
    .map((edge) => edge.neighborIndex);
  await ensureWordChunks([targetIndex, ...directNeighborIndices]);
}

function buildStarGraph(targetIndex = wordNodeById.get(state.wordTarget).index) {
  const targetRelations = incidentWordRelations(targetIndex).filter(
    (edge) => targetRelationIsAllowed(targetIndex, edge) && starRelationPasses(edge),
  );
  const candidateIndices = new Set([targetIndex, ...targetRelations.map((edge) => edge.neighborIndex)]);
  const edgeByKey = new Map();
  for (const nodeIndex of candidateIndices) {
    for (const edge of incidentWordRelations(nodeIndex)) {
      if (!candidateIndices.has(edge.neighborIndex) || !starRelationPasses(edge)) continue;
      if (!edgeByKey.has(edge.key)) edgeByKey.set(edge.key, edge);
    }
  }
  const filteredEdges = [...edgeByKey.values()];
  const prePruneDegree = weakDegree(candidateIndices, filteredEdges);
  const visibleIndices = new Set([targetIndex]);
  for (const nodeIndex of candidateIndices) {
    if (nodeIndex !== targetIndex && (prePruneDegree.get(nodeIndex) || 0) > STAR_DEGREE_THRESHOLD) {
      visibleIndices.add(nodeIndex);
    }
  }
  let visibleEdges = filteredEdges.filter(
    (edge) => visibleIndices.has(edge.sourceIndex) && visibleIndices.has(edge.targetIndex),
  );

  const classifiersWithVisibleNoun = new Set();
  const overlapNodesServingAsNouns = new Set();
  for (const edge of visibleEdges) {
    if (edge.relationType !== "classifier_noun") continue;
    classifiersWithVisibleNoun.add(edge.sourceIndex);
    if (wordNodes[edge.targetIndex].alsoNoun) overlapNodesServingAsNouns.add(edge.targetIndex);
  }
  for (const nodeIndex of [...visibleIndices]) {
    if (nodeIndex === targetIndex || wordNodes[nodeIndex].type !== "classifier") continue;
    if (classifiersWithVisibleNoun.has(nodeIndex) || overlapNodesServingAsNouns.has(nodeIndex)) continue;
    visibleIndices.delete(nodeIndex);
  }
  visibleEdges = visibleEdges.filter(
    (edge) => visibleIndices.has(edge.sourceIndex) && visibleIndices.has(edge.targetIndex),
  );

  const currentDegree = weakDegree(visibleIndices, visibleEdges);
  const directRelationByIndex = new Map(
    targetRelations
      .filter((edge) => visibleIndices.has(edge.neighborIndex))
      .map((edge) => [edge.neighborIndex, edge]),
  );
  const nodes = [...visibleIndices].map((wordIndex) => ({
    wordIndex,
    label: wordNodes[wordIndex].id,
    type: wordNodes[wordIndex].type,
    alsoNoun: wordNodes[wordIndex].alsoNoun,
    community: wordNodes[wordIndex].community,
    center: wordIndex === targetIndex,
    currentDegree: currentDegree.get(wordIndex) || 0,
    prePruneDegree: prePruneDegree.get(wordIndex) || 0,
    fullDegree: wordNodes[wordIndex].degreeFull,
    directRelation: directRelationByIndex.get(wordIndex) || null,
    x: STAR_CENTER_X,
    y: STAR_CENTER_Y,
  }));
  const neighborByIndex = new Map(nodes.map((node) => [node.wordIndex, new Set()]));
  for (const edge of visibleEdges) {
    neighborByIndex.get(edge.sourceIndex)?.add(edge.targetIndex);
    neighborByIndex.get(edge.targetIndex)?.add(edge.sourceIndex);
  }
  return {
    targetIndex,
    nodes,
    edges: visibleEdges,
    nodeByIndex: new Map(nodes.map((node) => [node.wordIndex, node])),
    neighborByIndex,
    directNeighborCount: directRelationByIndex.size,
    candidateCount: candidateIndices.size,
  };
}

function assignStarLayout(graph) {
  const center = graph.nodeByIndex.get(graph.targetIndex);
  center.x = STAR_CENTER_X;
  center.y = STAR_CENTER_Y;
  center.size = 16;
  center.orbit = null;

  const orbiting = graph.nodes.filter((node) => !node.center).sort((a, b) => {
    const pmiDifference = (b.directRelation?.pmi || 0) - (a.directRelation?.pmi || 0);
    return pmiDifference || zhSort(a.label, b.label);
  });
  if (!orbiting.length) return;
  const degreeRange = extent(orbiting.map((node) => node.prePruneDegree));
  const ringCount = Math.min(4, Math.max(1, Math.ceil(orbiting.length / 26)));
  const perRing = Math.ceil(orbiting.length / ringCount);
  const xStart = ringCount === 1 ? 280 : 155;
  const xStep = ringCount === 1 ? 0 : 315 / (ringCount - 1);
  const yStart = ringCount === 1 ? 168 : 92;
  const yStep = ringCount === 1 ? 0 : 190 / (ringCount - 1);
  const layoutTarget = wordNodes[graph.targetIndex].id;

  orbiting.forEach((node, rank) => {
    const ring = Math.min(ringCount - 1, Math.floor(rank / perRing));
    const ringStart = ring * perRing;
    const ringPopulation = Math.min(perRing, orbiting.length - ringStart);
    const slot = rank - ringStart;
    const random = seededRandom(`${layoutTarget}|${node.label}|star`);
    const angle = slot / Math.max(1, ringPopulation) * Math.PI * 2
      + random() * 0.18 + ring * 0.47;
    const tilt = (random() - 0.5) * 0.34;
    const radiusX = xStart + ring * xStep + (random() - 0.5) * 26;
    const radiusY = yStart + ring * yStep + (random() - 0.5) * 18;
    node.size = scaleSqrt(node.prePruneDegree, degreeRange, 4, 8.6)
      + (node.type === "classifier" ? 0.8 : 0);
    node.orbit = {
      ring,
      radiusX,
      radiusY,
      tilt,
      angle,
      speed: (ring % 2 === 0 ? 1 : -1) * (0.000018 + random() * 0.00002),
    };
  });
  graph.rings = [...new Set(orbiting.map((node) => node.orbit.ring))].map((ring) => {
    const members = orbiting.filter((node) => node.orbit.ring === ring);
    return {
      ring,
      radiusX: members.reduce((sum, node) => sum + node.orbit.radiusX, 0) / members.length,
      radiusY: members.reduce((sum, node) => sum + node.orbit.radiusY, 0) / members.length,
      tilt: members.reduce((sum, node) => sum + node.orbit.tilt, 0) / members.length,
    };
  });
}

function starPointOnOrbit(orbit, elapsed) {
  const angle = orbit.angle + elapsed * orbit.speed;
  const rawX = Math.cos(angle) * orbit.radiusX;
  const rawY = Math.sin(angle) * orbit.radiusY;
  const cosTilt = Math.cos(orbit.tilt);
  const sinTilt = Math.sin(orbit.tilt);
  return {
    x: STAR_CENTER_X + rawX * cosTilt - rawY * sinTilt,
    y: STAR_CENTER_Y + rawX * sinTilt + rawY * cosTilt,
  };
}

function starClassifierPath(size) {
  const inner = size * 0.34;
  return [
    `M 0 ${-size}`,
    `L ${inner} ${-inner}`,
    `L ${size} 0`,
    `L ${inner} ${inner}`,
    `L 0 ${size}`,
    `L ${-inner} ${inner}`,
    `L ${-size} 0`,
    `L ${-inner} ${-inner}`,
    "Z",
  ].join(" ");
}

function starEdgePath(edges, nodeByIndex) {
  const segments = [];
  for (const edge of edges) {
    const source = nodeByIndex.get(edge.sourceIndex);
    const target = nodeByIndex.get(edge.targetIndex);
    if (!source || !target) continue;
    segments.push(`M${source.x.toFixed(2)} ${source.y.toFixed(2)}L${target.x.toFixed(2)} ${target.y.toFixed(2)}`);
  }
  return segments.join("");
}

function updateBundledStarEdges(graph) {
  for (const bundle of graph.edgeBundles || []) {
    bundle.element.setAttribute("d", starEdgePath(bundle.edges, graph.nodeByIndex));
  }
  if (graph.activeEdgeElement) {
    graph.activeEdgeElement.setAttribute(
      "d",
      starEdgePath(graph.activeEdges || [], graph.nodeByIndex),
    );
  }
}

function updateStarGeometry(elapsed) {
  const graph = state.starGraph;
  if (!graph) return;
  for (const node of graph.nodes) {
    if (node.orbit) {
      const point = starPointOnOrbit(node.orbit, elapsed);
      node.x = point.x;
      node.y = point.y;
    }
    node.element?.setAttribute("transform", `translate(${node.x} ${node.y})`);
  }
  if (graph.edgeBundles) {
    updateBundledStarEdges(graph);
  } else {
    for (const edge of graph.edges) {
      const source = graph.nodeByIndex.get(edge.sourceIndex);
      const target = graph.nodeByIndex.get(edge.targetIndex);
      edge.element?.setAttribute("x1", source.x);
      edge.element?.setAttribute("y1", source.y);
      edge.element?.setAttribute("x2", target.x);
      edge.element?.setAttribute("y2", target.y);
    }
  }
}

function stopStarMotion() {
  if (state.starAnimationFrame !== null) cancelAnimationFrame(state.starAnimationFrame);
  state.starAnimationFrame = null;
  state.starAnimationStarted = null;
  state.starLastFrame = 0;
}

function tickStarMap(timestamp) {
  if (!state.starOpen || !state.starGraph || state.starTransitioning) {
    state.starAnimationFrame = null;
    return;
  }
  if (state.starAnimationStarted === null) {
    state.starAnimationStarted = timestamp - (state.starGraph.motionElapsed || 0);
  }
  const frameInterval = state.starGraph.edgeBundles ? 1000 / 12 : STAR_FRAME_INTERVAL_MS;
  if (timestamp - state.starLastFrame >= frameInterval) {
    state.starGraph.motionElapsed = timestamp - state.starAnimationStarted;
    updateStarGeometry(state.starGraph.motionElapsed);
    state.starLastFrame = timestamp;
  }
  state.starAnimationFrame = requestAnimationFrame(tickStarMap);
}

function startStarMotion() {
  stopStarMotion();
  if (!state.starOpen || state.starTransitioning || state.starPan || state.starGraph?.hoveredIndex != null) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return;
  }
  state.starAnimationFrame = requestAnimationFrame(tickStarMap);
}

function starSpherePoint(x, y) {
  let sphereX = (x - STAR_CENTER_X) / STAR_GLOBE_RADIUS_X;
  let sphereY = (y - STAR_CENTER_Y) / STAR_GLOBE_RADIUS_Y;
  const radial = Math.hypot(sphereX, sphereY);
  if (radial > 0.965) {
    const shrink = 0.965 / radial;
    sphereX *= shrink;
    sphereY *= shrink;
  }
  return {
    x: sphereX,
    y: sphereY,
    z: Math.sqrt(Math.max(0.001, 1 - sphereX * sphereX - sphereY * sphereY)),
  };
}

function createStarGlobeTurn(targetNode) {
  const target = starSpherePoint(targetNode.x, targetNode.y);
  const planarLength = Math.hypot(target.x, target.y);
  if (planarLength < 0.0001) {
    return { axis: { x: 0, y: 1, z: 0 }, angle: 0 };
  }
  return {
    axis: {
      x: target.y / planarLength,
      y: -target.x / planarLength,
      z: 0,
    },
    angle: Math.acos(clamp(target.z, -1, 1)),
  };
}

function rotateStarVector(vector, axis, angle) {
  if (Math.abs(angle) < 0.0001) return vector;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const dot = axis.x * vector.x + axis.y * vector.y + axis.z * vector.z;
  const cross = {
    x: axis.y * vector.z - axis.z * vector.y,
    y: axis.z * vector.x - axis.x * vector.z,
    z: axis.x * vector.y - axis.y * vector.x,
  };
  return {
    x: vector.x * cosine + cross.x * sine + axis.x * dot * (1 - cosine),
    y: vector.y * cosine + cross.y * sine + axis.y * dot * (1 - cosine),
    z: vector.z * cosine + cross.z * sine + axis.z * dot * (1 - cosine),
  };
}

function projectStarGlobePoint(node, turn, progress) {
  const rotated = rotateStarVector(
    starSpherePoint(node.x, node.y),
    turn.axis,
    turn.angle * progress,
  );
  return {
    x: STAR_CENTER_X + rotated.x * STAR_GLOBE_RADIUS_X,
    y: STAR_CENTER_Y + rotated.y * STAR_GLOBE_RADIUS_Y,
    depth: rotated.z,
  };
}

function starDepthOpacity(depth, isCenter = false) {
  if (isCenter) return 1;
  return clamp(0.18 + (depth + 1) * 0.32, 0.18, 0.82);
}

function absoluteStarTransform(point) {
  return `translate(${point.x}px, ${point.y}px)`;
}

function animateStarArrival(graph, originPositions) {
  if (!originPositions || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
  for (const node of graph.nodes) {
    const retainedOrigin = originPositions.get(node.wordIndex);
    const arrivalRandom = seededRandom(`${wordNodes[graph.targetIndex].id}|${node.label}|arrival`);
    const arrivalDelay = retainedOrigin ? 0 : 35 + arrivalRandom() * STAR_ARRIVAL_STAGGER_MS;
    const origin = retainedOrigin || {
      x: STAR_CENTER_X + (node.x - STAR_CENTER_X) * 1.08,
      y: STAR_CENTER_Y + (node.y - STAR_CENTER_Y) * 1.08,
      depth: -0.2,
    };
    const midpoint = {
      x: origin.x + (node.x - origin.x) * 0.58,
      y: origin.y + (node.y - origin.y) * 0.58,
    };
    node.element.animate([
      {
        transform: absoluteStarTransform(origin),
        opacity: retainedOrigin ? origin.opacity : 0,
        offset: 0,
      },
      {
        transform: absoluteStarTransform(midpoint),
        opacity: node.center ? 1 : 0.68,
        offset: 0.58,
      },
      {
        transform: absoluteStarTransform(node),
        opacity: node.center ? 1 : 0.82,
        offset: 1,
      },
    ], {
      duration: STAR_ARRIVAL_DURATION_MS,
      delay: arrivalDelay,
      easing: "cubic-bezier(0.4, 0, 0.2, 1)",
      fill: "backwards",
    });
    node.visualElement.animate([
      { transform: `scale(${retainedOrigin ? retainedOrigin.size / node.size : 0.72})` },
      { transform: "scale(1)" },
    ], {
      duration: STAR_ARRIVAL_DURATION_MS,
      delay: arrivalDelay,
      easing: "ease-in-out",
      fill: "backwards",
    });
  }
  dom.starEdgeLayer.animate(
    [{ opacity: 0 }, { opacity: 1 }],
    { duration: STAR_ARRIVAL_DURATION_MS, delay: 70, easing: "ease-out", fill: "backwards" },
  );
  dom.starOrbitLayer.animate(
    [{ opacity: 0 }, { opacity: 1 }],
    { duration: STAR_ARRIVAL_DURATION_MS, easing: "ease-out" },
  );
  return true;
}

function renderStarField(graph, originPositions = null) {
  stopStarMotion();
  // These containers survive graph replacement; a forwards-filled departure
  // animation must not reappear when the arrival animation ends.
  for (const layer of [dom.starEdgeLayer, dom.starOrbitLayer]) {
    for (const animation of layer.getAnimations()) animation.cancel();
  }
  const denseGraph = graph.edges.length > STAR_LIVE_MOTION_EDGE_LIMIT;
  graph.edgeBundles = denseGraph ? [] : null;
  graph.activeEdges = [];
  graph.activeEdgeElement = null;
  dom.starStage.classList.toggle("is-dense", denseGraph);
  dom.starOrbitLayer.replaceChildren();
  dom.starEdgeLayer.replaceChildren();
  dom.starNodeLayer.replaceChildren();
  const orbitFragment = document.createDocumentFragment();
  for (const ring of graph.rings || []) {
    orbitFragment.append(createSvg("ellipse", {
      class: "star-orbit",
      cx: STAR_CENTER_X,
      cy: STAR_CENTER_Y,
      rx: ring.radiusX,
      ry: ring.radiusY,
      transform: `rotate(${ring.tilt * 180 / Math.PI} ${STAR_CENTER_X} ${STAR_CENTER_Y})`,
    }));
  }
  dom.starOrbitLayer.append(orbitFragment);

  const coRange = graph.edges.length
    ? extent(graph.edges.map((edge) => Math.log1p(edge.coOccurrence))) : [0, 1];
  const edgeFragment = document.createDocumentFragment();
  if (denseGraph) {
    const peripheralBins = [[], [], []];
    const centerEdges = [];
    for (const edge of graph.edges) {
      edge.element = null;
      const direct = edge.sourceIndex === graph.targetIndex || edge.targetIndex === graph.targetIndex;
      if (direct) {
        centerEdges.push(edge);
        continue;
      }
      const strength = scaleLinear(Math.log1p(edge.coOccurrence), coRange, 0, 2.999);
      peripheralBins[Math.min(2, Math.floor(strength))].push(edge);
    }
    const bundleSpecs = [
      { edges: peripheralBins[0], opacity: 0.05, width: 0.42, className: "" },
      { edges: peripheralBins[1], opacity: 0.09, width: 0.62, className: "" },
      { edges: peripheralBins[2], opacity: 0.15, width: 0.86, className: "" },
      { edges: centerEdges, opacity: 0.38, width: 1.12, className: " is-center-link" },
    ];
    for (const spec of bundleSpecs) {
      if (!spec.edges.length) continue;
      const element = createSvg("path", {
        class: `star-edge star-edge-bundle${spec.className}`,
        fill: "none",
      });
      element.style.opacity = String(spec.opacity);
      element.style.strokeWidth = String(spec.width);
      graph.edgeBundles.push({ element, edges: spec.edges });
      edgeFragment.append(element);
    }
    graph.activeEdgeElement = createSvg("path", {
      class: "star-edge star-edge-active-bundle is-active",
      fill: "none",
      d: "",
    });
    edgeFragment.append(graph.activeEdgeElement);
  } else {
    for (const edge of graph.edges) {
      const direct = edge.sourceIndex === graph.targetIndex || edge.targetIndex === graph.targetIndex;
      const element = createSvg("line", {
        class: `star-edge${direct ? " is-center-link" : ""}`,
        "data-source-index": edge.sourceIndex,
        "data-target-index": edge.targetIndex,
      });
      element.style.opacity = String(scaleLinear(
        Math.log1p(edge.coOccurrence), coRange, direct ? 0.2 : 0.045, direct ? 0.48 : 0.16,
      ));
      element.style.strokeWidth = String(scaleLinear(
        Math.log1p(edge.coOccurrence), coRange, direct ? 0.8 : 0.35, direct ? 1.55 : 0.8,
      ));
      edge.element = element;
      edgeFragment.append(element);
    }
  }
  dom.starEdgeLayer.append(edgeFragment);

  const nodeFragment = document.createDocumentFragment();
  for (const node of graph.nodes) {
    const group = createSvg("g", {
      class: `star-node ${node.type}${node.center ? " center" : ""}`,
      "data-word-index": node.wordIndex,
      role: "button",
      tabindex: "0",
      "aria-label": `${node.label}，点击设为星图中心`,
    });
    const halo = createSvg("circle", {
      class: "star-node-halo",
      r: node.center ? node.size * 2.8 : node.size * 2.25,
    });
    const core = node.type === "classifier" && !node.center
      ? createSvg("path", {
        class: "star-node-core star-classifier-core",
        d: starClassifierPath(node.size),
        fill: "url(#starClassifierGradient)",
      })
      : createSvg("circle", {
        class: "star-node-core",
        r: node.size,
        fill: node.center ? "url(#starCenterGradient)" : "url(#starNounGradient)",
      });
    const visual = createSvg("g", { class: "star-node-visual" });
    visual.append(halo, core);
    group.append(visual);
    if (node.center) {
      visual.append(createSvg("path", {
        class: "star-center-mark",
        d: "M0,-9 C2,-3 3,-2 9,0 C3,2 2,3 0,9 C-2,3 -3,2 -9,0 C-3,-2 -2,-3 0,-9Z",
      }));
    }
    const label = createSvg("text", {
      class: "star-label",
      y: node.size + 18,
      "text-anchor": "middle",
      "aria-hidden": "true",
    });
    label.textContent = node.label;
    group.append(label);
    group.addEventListener("pointerenter", () => highlightStarNode(node.wordIndex));
    group.addEventListener("pointerleave", clearStarHighlight);
    group.addEventListener("click", () => { void navigateStarTo(node.wordIndex); });
    group.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        void navigateStarTo(node.wordIndex);
      }
    });
    node.element = group;
    node.visualElement = visual;
    node.labelElement = label;
    nodeFragment.append(group);
  }
  dom.starNodeLayer.append(nodeFragment);
  updateStarGeometry(0);
  dom.starStage.classList.remove("is-arriving");
  const hasGlobeArrival = animateStarArrival(graph, originPositions);
  if (!hasGlobeArrival) {
    void dom.starStage.offsetWidth;
    dom.starStage.classList.add("is-arriving");
    dom.starNodeLayer.firstElementChild?.addEventListener("animationend", () => {
      dom.starStage.classList.remove("is-arriving");
    }, { once: true });
  }
  updateStarStatus();
  if (hasGlobeArrival) {
    window.setTimeout(() => {
      if (!state.starOpen || state.starGraph !== graph) return;
      dom.starStage.classList.remove("is-transitioning");
      state.starTransitioning = false;
      startStarMotion();
    }, STAR_ARRIVAL_DURATION_MS + STAR_ARRIVAL_STAGGER_MS + 90);
  } else {
    dom.starStage.classList.remove("is-transitioning");
    state.starTransitioning = false;
    startStarMotion();
  }
}

function updateStarStatus(hoveredNode = null) {
  const counts = dom.starStatus.querySelector(".star-status-counts");
  if (!state.starGraph) {
    counts.textContent = "—";
    return;
  }
  if (hoveredNode) {
    const type = hoveredNode.type === "classifier"
      ? hoveredNode.alsoNoun ? "量词（亦作名词）" : "量词" : "名词";
    counts.textContent = `${hoveredNode.label} · ${type} · 筛选时 Degree ${hoveredNode.prePruneDegree}`;
    return;
  }
  counts.textContent = `${Math.max(0, state.starGraph.nodes.length - 1)} 个相邻词 · ${state.starGraph.edges.length} 条关系`;
}

function highlightStarNode(wordIndex) {
  const graph = state.starGraph;
  if (!graph || state.starTransitioning || state.starPan || graph.hoveredIndex === wordIndex) return;
  graph.hoveredIndex = wordIndex;
  stopStarMotion();
  const connected = new Set([wordIndex, ...(graph.neighborByIndex.get(wordIndex) || [])]);
  for (const node of graph.nodes) {
    node.element.classList.toggle("is-hovered", node.wordIndex === wordIndex);
    node.element.classList.toggle("is-neighbor", node.wordIndex !== wordIndex && connected.has(node.wordIndex));
    node.element.classList.toggle("is-muted", !connected.has(node.wordIndex));
    node.labelElement.classList.toggle("is-visible", connected.has(node.wordIndex));
  }
  if (graph.edgeBundles) {
    graph.activeEdges = graph.edges.filter(
      (edge) => edge.sourceIndex === wordIndex || edge.targetIndex === wordIndex,
    );
    for (const bundle of graph.edgeBundles) bundle.element.classList.add("is-muted");
    updateBundledStarEdges(graph);
  } else {
    for (const edge of graph.edges) {
      const active = edge.sourceIndex === wordIndex || edge.targetIndex === wordIndex;
      edge.element.classList.toggle("is-active", active);
      edge.element.classList.toggle("is-muted", !active);
    }
  }
  updateStarStatus(graph.nodeByIndex.get(wordIndex));
}

function clearStarHighlight() {
  if (!state.starGraph) return;
  const wasHovered = state.starGraph.hoveredIndex != null;
  state.starGraph.hoveredIndex = null;
  for (const node of state.starGraph.nodes) {
    node.element.classList.remove("is-hovered", "is-neighbor", "is-muted");
    node.labelElement.classList.remove("is-visible");
  }
  if (state.starGraph.edgeBundles) {
    state.starGraph.activeEdges = [];
    for (const bundle of state.starGraph.edgeBundles) bundle.element.classList.remove("is-muted");
    updateBundledStarEdges(state.starGraph);
  } else {
    for (const edge of state.starGraph.edges) {
      edge.element.classList.remove("is-active", "is-muted");
    }
  }
  updateStarStatus();
  if (wasHovered) startStarMotion();
}

function applyStarViewport() {
  const { x, y, scale } = state.starView;
  dom.starViewport.setAttribute(
    "transform",
    `translate(${x} ${y}) translate(${STAR_CENTER_X} ${STAR_CENTER_Y}) scale(${scale}) translate(${-STAR_CENTER_X} ${-STAR_CENTER_Y})`,
  );
}

function startStarPan(event) {
  if (event.button !== 0 || state.starTransitioning) return;
  // Pointer-down may be a click, not a drag. Keep its highlight and position
  // stable until the gesture is known, so clicking cannot flash or miss a star.
  stopStarMotion();
  state.starPan = {
    pointerId: event.pointerId,
    clientX: event.clientX,
    clientY: event.clientY,
    originX: state.starView.x,
    originY: state.starView.y,
    moved: false,
    captured: false,
  };
}

function moveStarPan(event) {
  if (!state.starPan || state.starPan.pointerId !== event.pointerId) return;
  if ((event.buttons & 1) === 0) {
    endStarPan(event);
    return;
  }
  const rect = dom.starSvg.getBoundingClientRect();
  const scaleX = STAR_VIEWBOX_WIDTH / Math.max(1, rect.width);
  const scaleY = STAR_VIEWBOX_HEIGHT / Math.max(1, rect.height);
  const screenDistance = Math.hypot(
    event.clientX - state.starPan.clientX,
    event.clientY - state.starPan.clientY,
  );
  if (screenDistance > 3) {
    event.preventDefault();
    if (!state.starPan.moved) clearStarHighlight();
    state.starPan.moved = true;
    if (!state.starPan.captured) {
      dom.starSvg.setPointerCapture(event.pointerId);
      state.starPan.captured = true;
    }
    dom.starStage.classList.add("is-panning");
  }
  state.starView.x = state.starPan.originX + (event.clientX - state.starPan.clientX) * scaleX;
  state.starView.y = state.starPan.originY + (event.clientY - state.starPan.clientY) * scaleY;
  applyStarViewport();
}

function endStarPan(event) {
  if (!state.starPan || state.starPan.pointerId !== event.pointerId) return;
  if (state.starPan.moved) state.starSuppressClickUntil = performance.now() + 120;
  if (state.starPan.captured && dom.starSvg.hasPointerCapture(event.pointerId)) {
    dom.starSvg.releasePointerCapture(event.pointerId);
  }
  state.starPan = null;
  dom.starStage.classList.remove("is-panning");
  startStarMotion();
}

function setWordTargetState(word) {
  if (word !== state.wordTarget) {
    state.wordPositionCache.clear();
    state.wordLayoutTarget = word;
  }
  state.wordTarget = word;
  const metadata = wordNodeById.get(word);
  if (metadata?.type === "classifier") state.currentClassifier = word;
}

async function navigateStarTo(wordIndex) {
  const graph = state.starGraph;
  const node = graph?.nodeByIndex.get(wordIndex);
  if (!node || node.center || state.starTransitioning || performance.now() < state.starSuppressClickUntil) return;
  state.starTransitioning = true;
  state.starPan = null;
  dom.starStage.classList.remove("is-panning");
  dom.starStage.classList.add("is-transitioning");
  const renderToken = ++state.starRenderToken;
  stopStarMotion();
  try {
    await ensureStarGraphBuffers(wordIndex);
    if (!state.starOpen || renderToken !== state.starRenderToken) return;
    const nextGraph = buildStarGraph(wordIndex);
    assignStarLayout(nextGraph);
    const nextIndices = new Set(nextGraph.nodes.map((nextNode) => nextNode.wordIndex));
    // Continue from the actual hover brightness, not the unhighlighted CSS
    // defaults. Otherwise clicking a dimmed neighborhood causes a bright flash.
    const departureOpacities = new Map(graph.nodes.map((currentNode) => [
      currentNode.wordIndex, Number(getComputedStyle(currentNode.element).opacity),
    ]));
    clearStarHighlight();
    node.element.classList.add("is-selected");
    const globeTurn = createStarGlobeTurn(node);
    const originPositions = new Map();
    for (const currentNode of graph.nodes) {
      const destination = projectStarGlobePoint(currentNode, globeTurn, 1);
      if (currentNode.wordIndex === wordIndex) {
        destination.x = STAR_CENTER_X;
        destination.y = STAR_CENTER_Y;
        destination.depth = 1;
      }
      destination.opacity = currentNode.wordIndex === wordIndex ? 1
        : starDepthOpacity(destination.depth, currentNode.center);
      destination.size = currentNode.size;
      originPositions.set(currentNode.wordIndex, destination);
    }

    const departureAnimations = [];
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      for (const currentNode of graph.nodes) {
        const destination = originPositions.get(currentNode.wordIndex);
        const quarterTurn = projectStarGlobePoint(currentNode, globeTurn, 0.34);
        const threeQuarterTurn = projectStarGlobePoint(currentNode, globeTurn, 0.72);
        const selected = currentNode.wordIndex === wordIndex;
        const retained = nextIndices.has(currentNode.wordIndex);
        const depthOpacity = (point, progress) => {
          if (selected) return 1;
          const retention = retained ? 1 : 1 - progress;
          return starDepthOpacity(point.depth, currentNode.center) * retention;
        };
        const animation = currentNode.element.animate([
          {
            transform: absoluteStarTransform(currentNode),
            opacity: departureOpacities.get(currentNode.wordIndex),
            offset: 0,
          },
          {
            transform: absoluteStarTransform(quarterTurn),
            opacity: depthOpacity(quarterTurn, 0.34),
            offset: 0.34,
          },
          {
            transform: absoluteStarTransform(threeQuarterTurn),
            opacity: depthOpacity(threeQuarterTurn, 0.72),
            offset: 0.72,
          },
          {
            transform: absoluteStarTransform(destination),
            opacity: depthOpacity(destination, 1),
            offset: 1,
          },
        ], {
          duration: STAR_TURN_DURATION_MS,
          easing: "cubic-bezier(0.34, 0.02, 0.18, 1)",
          fill: "forwards",
        });
        departureAnimations.push(animation.finished.catch(() => undefined));
      }
      const edgeAnimation = dom.starEdgeLayer.animate(
        [{ opacity: 1 }, { opacity: 0.04 }],
        { duration: STAR_TURN_DURATION_MS, easing: "ease-in-out", fill: "forwards" },
      );
      departureAnimations.push(edgeAnimation.finished.catch(() => undefined));
      const orbitAnimation = dom.starOrbitLayer.animate(
        [{ opacity: 1 }, { opacity: 0.1 }],
        { duration: STAR_TURN_DURATION_MS, easing: "ease-in-out", fill: "forwards" },
      );
      departureAnimations.push(orbitAnimation.finished.catch(() => undefined));
    }
    await Promise.all(departureAnimations);
    if (!state.starOpen || renderToken !== state.starRenderToken) return;
    setWordTargetState(node.label);
    state.starGraph = nextGraph;
    renderStarField(nextGraph, originPositions);
    dom.starEmpty.classList.toggle("is-hidden", nextGraph.nodes.length !== 1);
    if (nextGraph.nodes.length === 1) {
      dom.starEmpty.textContent = "当前固定条件下没有保留可见邻居；中心词仍作为探索锚点保留。";
    }
  } catch (error) {
    if (renderToken !== state.starRenderToken) return;
    state.starTransitioning = false;
    dom.starStage.classList.remove("is-transitioning");
    dom.starEmpty.textContent = `中心切换失败：${error.message}`;
    dom.starEmpty.classList.remove("is-hidden");
    await renderStarMap();
  }
}

async function renderStarMap() {
  const renderToken = ++state.starRenderToken;
  dom.starLoading.classList.remove("is-hidden");
  dom.starEmpty.classList.add("is-hidden");
  try {
    const targetIndex = wordNodeById.get(state.wordTarget).index;
    await ensureStarGraphBuffers(targetIndex);
    if (!state.starOpen || renderToken !== state.starRenderToken) return;
    const graph = buildStarGraph();
    assignStarLayout(graph);
    state.starGraph = graph;
    renderStarField(graph);
    if (graph.nodes.length === 1) {
      dom.starEmpty.textContent = "当前固定条件下没有保留可见邻居；中心词仍作为探索锚点保留。";
      dom.starEmpty.classList.remove("is-hidden");
    }
  } catch (error) {
    if (renderToken !== state.starRenderToken) return;
    state.starGraph = null;
    dom.starOrbitLayer.replaceChildren();
    dom.starEdgeLayer.replaceChildren();
    dom.starNodeLayer.replaceChildren();
    dom.starEmpty.textContent = `星图数据加载失败：${error.message}`;
    dom.starEmpty.classList.remove("is-hidden");
    updateStarStatus();
  } finally {
    if (renderToken === state.starRenderToken) dom.starLoading.classList.add("is-hidden");
  }
}

function openStarMap() {
  stopWordSimulation();
  state.starOpen = true;
  state.starView = { x: 0, y: 0, scale: 1 };
  applyStarViewport();
  document.body.classList.add("star-map-open");
  dom.starMap.classList.remove("is-hidden");
  dom.starMap.setAttribute("aria-hidden", "false");
  dom.closeStarMap.focus();
  void renderStarMap();
}

function closeStarMap() {
  state.starOpen = false;
  state.starRenderToken += 1;
  state.starTransitioning = false;
  state.starPan = null;
  dom.starStage.classList.remove("is-panning");
  stopStarMotion();
  state.starGraph = null;
  dom.starOrbitLayer.replaceChildren();
  dom.starEdgeLayer.replaceChildren();
  dom.starNodeLayer.replaceChildren();
  dom.starLoading.classList.add("is-hidden");
  dom.starEmpty.classList.add("is-hidden");
  updateStarStatus();
  dom.starRuleMenu.open = false;
  dom.starMap.classList.add("is-hidden");
  dom.starMap.setAttribute("aria-hidden", "true");
  document.body.classList.remove("star-map-open");
  if (state.activeTab === "word") dom.classifierSearch.value = state.wordTarget;
  else if (state.activeTab === "noun") dom.classifierSearch.value = state.nounCenter || state.currentClassifier;
  else dom.classifierSearch.value = state.currentClassifier;
  dom.openStarMap.focus();
  void renderNetwork();
}

function assignRadialPositions(graph) {
  const rect = dom.graphStage.getBoundingClientRect();
  const farRadius = Math.max(130, Math.min(rect.width, rect.height) * 0.39);
  const nearRadius = Math.min(135, farRadius * 0.52);
  const neighbors = graph.nodes.filter((node) => !node.center);
  for (const node of graph.nodes) {
    if (node.center) { node.x = 0; node.y = 0; continue; }
    node.radius = nearRadius + (farRadius - nearRadius) * node.distanceFactor;
  }
  separateNodeAngles(neighbors);
  for (const node of neighbors) {
    node.x = Math.cos(node.angle) * node.radius;
    node.y = Math.sin(node.angle) * node.radius;
  }
}

function separateNodeAngles(nodes) {
  for (let iteration = 0; iteration < 120; iteration += 1) {
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const first = nodes[i]; const second = nodes[j];
        const minimumDistance = first.size + second.size + 12;
        if (Math.abs(first.radius - second.radius) >= minimumDistance) continue;
        const cosineLimit = clamp(
          (first.radius ** 2 + second.radius ** 2 - minimumDistance ** 2)
          / (2 * first.radius * second.radius), -1, 1,
        );
        const minimumGap = Math.acos(cosineLimit);
        const signedGap = Math.atan2(
          Math.sin(second.angle - first.angle), Math.cos(second.angle - first.angle),
        );
        if (Math.abs(signedGap) >= minimumGap) continue;
        const direction = signedGap >= 0 ? 1 : -1;
        const correction = (minimumGap - Math.abs(signedGap)) * 0.27;
        first.angle -= direction * correction;
        second.angle += direction * correction;
      }
    }
  }
}

function initializeWordPositions(graph) {
  if (state.wordLayoutTarget !== state.wordTarget) {
    state.wordPositionCache.clear();
    state.wordLayoutTarget = state.wordTarget;
  }
  const golden = 2.3999632297;
  graph.nodes.forEach((node, index) => {
    const cached = state.wordPositionCache.get(node.id);
    if (node.center) {
      node.x = 0; node.y = 0;
    } else if (cached) {
      node.x = cached.x; node.y = cached.y;
    } else {
      const radius = 18 * Math.sqrt(index + 1);
      const angle = index * golden + state.layoutSeed * 0.61;
      node.x = Math.cos(angle) * radius; node.y = Math.sin(angle) * radius;
    }
    node.vx = 0; node.vy = 0; node.fx = null; node.fy = null;
  });
}

function stopWordSimulation() {
  if (state.wordSimulation?.frameId) cancelAnimationFrame(state.wordSimulation.frameId);
  state.wordSimulation = null;
}

function startWordSimulation(graph, alpha = 0.82, alphaTarget = 0) {
  stopWordSimulation();
  const simulation = {
    graph,
    nodeById: new Map(graph.nodes.map((node) => [node.id, node])),
    nodeElements: new Map([...dom.nodeLayer.children].map((element) => [element.dataset.nodeId, element])),
    edgeElements: [...dom.edgeLayer.children],
    alpha,
    alphaTarget,
    frameId: null,
  };
  state.wordSimulation = simulation;
  simulation.frameId = requestAnimationFrame(tickWordSimulation);
}

function reheatWordSimulation(alpha, alphaTarget = 0) {
  if (state.activeTab !== "word") return;
  const simulation = state.wordSimulation;
  if (!simulation || simulation.graph !== state.currentGraph) {
    startWordSimulation(state.currentGraph, alpha, alphaTarget);
    return;
  }
  simulation.alpha = Math.max(simulation.alpha, alpha);
  simulation.alphaTarget = alphaTarget;
  if (!simulation.frameId) simulation.frameId = requestAnimationFrame(tickWordSimulation);
}

function tickWordSimulation() {
  const simulation = state.wordSimulation;
  if (!simulation || simulation.graph !== state.currentGraph || state.activeTab !== "word") return;
  simulation.frameId = null;
  stepWordSimulation(simulation);
  refreshWordGraphGeometry(simulation);
  simulation.alpha += (simulation.alphaTarget - simulation.alpha) * 0.04;
  if (simulation.alphaTarget === 0) simulation.alpha *= 0.98;
  if (simulation.alpha > 0.014 || simulation.alphaTarget > 0.01) {
    simulation.frameId = requestAnimationFrame(tickWordSimulation);
  }
}

function stepWordSimulation(simulation) {
  const { graph, nodeById, alpha } = simulation;
  const nodes = graph.nodes;
  for (const node of nodes) { node.forceX = 0; node.forceY = 0; }
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const first = nodes[i]; const second = nodes[j];
      let dx = second.x - first.x; let dy = second.y - first.y;
      const distance = Math.hypot(dx, dy) || 0.01;
      dx /= distance; dy /= distance;
      const collisionDistance = first.size + second.size + 10;
      const repulsion = distance < collisionDistance
        ? (collisionDistance - distance) * 0.18 + 0.9
        : Math.min(2.4, 1150 / (distance * distance));
      first.forceX -= dx * repulsion; first.forceY -= dy * repulsion;
      second.forceX += dx * repulsion; second.forceY += dy * repulsion;
    }
  }
  for (const edge of graph.edges) {
    const source = nodeById.get(edge.source); const target = nodeById.get(edge.target);
    if (!source || !target) continue;
    let dx = target.x - source.x; let dy = target.y - source.y;
    const distance = Math.hypot(dx, dy) || 0.01;
    dx /= distance; dy /= distance;
    const pull = clamp((distance - edge.distance) * 0.008 * edge.layoutStrength, -3.5, 3.5);
    source.forceX += dx * pull; source.forceY += dy * pull;
    target.forceX -= dx * pull; target.forceY -= dy * pull;
  }
  for (const node of nodes) {
    if (Number.isFinite(node.fx) && Number.isFinite(node.fy)) {
      node.x = node.fx; node.y = node.fy; node.vx = 0; node.vy = 0;
      continue;
    }
    const centerPull = node.center ? 0.028 : 0.0032;
    node.forceX -= node.x * centerPull;
    node.forceY -= node.y * centerPull;
    node.vx = (node.vx + node.forceX * alpha) * 0.79;
    node.vy = (node.vy + node.forceY * alpha) * 0.79;
    node.x += clamp(node.vx, -8, 8);
    node.y += clamp(node.vy, -8, 8);
  }
}

function refreshWordGraphGeometry(simulation) {
  for (const node of simulation.graph.nodes) {
    simulation.nodeElements.get(node.id)?.setAttribute("transform", `translate(${node.x} ${node.y})`);
    state.wordPositionCache.set(node.id, { x: node.x, y: node.y });
  }
  simulation.graph.edges.forEach((edge, index) => {
    const element = simulation.edgeElements[index];
    if (element) setEdgeCoordinates(element, edge, simulation.nodeById);
  });
}

function coThresholdFromSlider(sliderValue) {
  const position = clamp(Number(sliderValue) / WORD_CO_SLIDER_MAX, 0, 1);
  return Math.max(1, Math.round(Math.exp(Math.log(WORD_CO_MAX) * position ** WORD_CO_CURVE)));
}

function coSliderFromThreshold(threshold) {
  const value = clamp(Number(threshold), 1, WORD_CO_MAX);
  const position = (Math.log(value) / Math.log(WORD_CO_MAX)) ** (1 / WORD_CO_CURVE);
  return Math.round(position * WORD_CO_SLIDER_MAX);
}

function syncCoOccurrenceControl() {
  dom.wordCoSlider.value = String(coSliderFromThreshold(state.wordCoThreshold));
  dom.wordCoNumber.value = String(state.wordCoThreshold);
  dom.wordCoSlider.setAttribute(
    "aria-valuetext",
    `实际共现阈值 ${state.wordCoThreshold.toLocaleString()}`,
  );
}

function resetWordLayout() {
  state.wordPositionCache.clear();
  state.layoutSeed += 1;
}

async function renderNetwork() {
  if (state.wordRenderTimer) {
    clearTimeout(state.wordRenderTimer);
    state.wordRenderTimer = null;
  }
  const renderStarted = performance.now();
  stopWordSimulation();
  const token = ++state.renderToken;
  state.view = { x: 0, y: 0, scale: 1 };
  if (state.activeTab === "word" && window.location.protocol === "file:") {
    showLoading(
      "当前页面由 file:// 直接打开，浏览器不允许读取词汇网络二进制分块。请关闭本页并双击项目目录中的“启动语义网络.bat”。",
      true,
    );
    dom.networkStats.innerHTML = "<span>词汇网络需要通过本项目自带的本地静态 HTTP 服务打开。</span>";
    return;
  }
  if (state.activeTab === "word" && !state.wordBuffersLoaded) {
    showLoading("正在加载约 111 MB 的混合关系 Top-400 词汇网络分块…");
    try {
      await ensureWordBuffers();
    } catch (error) {
      showLoading(
        `词汇网络数据加载失败：${error.message}。请双击项目目录中的“启动语义网络.bat”重新打开。`,
        true,
      );
      return;
    }
    if (token !== state.renderToken) return;
  }
  const graph = state.activeTab === "classifier" ? buildClassifierGraph()
    : state.activeTab === "noun" ? buildClassifierNounGraph() : buildWordGraph();
  if (state.activeTab === "word") initializeWordPositions(graph);
  else assignRadialPositions(graph);
  state.currentGraph = graph;
  document.body.dataset.activeTab = state.activeTab;
  document.body.dataset.currentClassifier = state.currentClassifier;
  document.body.dataset.nounCenter = state.nounCenter || "";
  document.body.dataset.wordTarget = state.wordTarget;
  drawGraph(graph);
  if (state.activeTab === "word") startWordSimulation(graph);
  updateGraphHeading();
  renderInformation(graph);
  graph.totalUpdateMs = performance.now() - renderStarted;
  if (state.activeTab === "word") {
    document.body.dataset.wordCommunityMode = state.wordCommunityMode;
    document.body.dataset.localCommunityRuns = String(state.wordCommunityRunCount);
    document.body.dataset.localCommunityMs = String(graph.localCommunityMs);
    document.body.dataset.totalGraphUpdateMs = String(graph.totalUpdateMs);
    document.body.dataset.wordDirectNeighbors = String(graph.directNeighborCount);
    document.body.dataset.wordFinalNeighbors = String(graph.finalDirectNeighborCount);
  }
  updateNetworkStats(graph);
  updateLegend();
}

function showLoading(message, error = false) {
  dom.edgeLayer.replaceChildren(); dom.nodeLayer.replaceChildren();
  dom.graphEmpty.textContent = message;
  dom.graphEmpty.classList.remove("is-hidden");
  dom.graphEmpty.classList.toggle("is-error", error);
}

function drawGraph(graph) {
  dom.edgeLayer.replaceChildren(); dom.nodeLayer.replaceChildren();
  dom.graphEmpty.classList.remove("is-error");
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const edgeFragment = document.createDocumentFragment();
  for (const edge of graph.edges) {
    const line = createSvg("line", {
      class: `network-edge${edge.directed ? " directed" : ""}`,
      "data-edge-id": edge.id, "data-source": edge.source, "data-target": edge.target,
      "data-metric": edge.metric, "data-value": edge.value,
      "data-relation-type": edge.relationType ?? "", "data-directed": edge.directed ? "true" : "false",
      "data-common-nouns": edge.commonNouns ?? "",
      "stroke-width": edge.width, "stroke-opacity": edge.opacity ?? 0.58,
    });
    setEdgeCoordinates(line, edge, nodeById);
    if (state.activeTab === "word") bindWordEdgeEvents(line, edge);
    edgeFragment.append(line);
  }
  dom.edgeLayer.append(edgeFragment);
  const nodeFragment = document.createDocumentFragment();
  for (const node of graph.nodes) {
    const group = createSvg("g", {
      class: `network-node ${node.type}${node.center ? " center" : ""}`,
      "data-node-id": node.id, "data-label": node.label, "data-node-type": node.type,
      "data-full-count": node.fullCount ?? "", "data-community": node.community ?? "",
      "data-current-degree": node.currentDegree ?? "",
      "data-pre-prune-degree": node.prePruneDegree ?? "",
      "data-local-community": node.localCommunity ?? "",
      "data-global-community": node.globalCommunity ?? "",
      transform: `translate(${node.x} ${node.y})`,
      tabindex: "0", role: "button", "aria-label": `${node.label}${node.center ? "，当前中心节点" : ""}`,
    });
    const shape = node.shape === "triangle"
      ? createSvg("polygon", {
        class: "node-circle node-triangle",
        points: `0,${-node.size} ${node.size * 0.9},${node.size * 0.72} ${-node.size * 0.9},${node.size * 0.72}`,
      })
      : createSvg("circle", { class: "node-circle", r: node.size });
    if (node.color) shape.style.fill = node.color;
    const label = createSvg("text", { class: "node-label", y: node.size + 18 });
    label.textContent = node.label; group.append(shape, label);
    bindNodeEvents(group, node); nodeFragment.append(group);
  }
  dom.nodeLayer.append(nodeFragment);
  const empty = graph.visibleCount === 0;
  dom.graphEmpty.classList.toggle("is-hidden", !empty);
  dom.graphEmpty.textContent = empty
    ? "当前阈值下没有可显示的邻居。中心节点仍然保留；请调整阈值继续探索。"
    : "";
  updateLabels(); updateViewportTransform();
}

function createSvg(tag, attributes) {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  return element;
}

function setEdgeCoordinates(element, edge, nodeById) {
  const source = nodeById.get(edge.source); const target = nodeById.get(edge.target);
  if (!source || !target) return;
  const dx = target.x - source.x; const dy = target.y - source.y;
  const distance = Math.hypot(dx, dy) || 1;
  const sourcePad = source.size + 2; const targetPad = target.size + 2;
  element.setAttribute("x1", source.x + dx / distance * sourcePad);
  element.setAttribute("y1", source.y + dy / distance * sourcePad);
  element.setAttribute("x2", target.x - dx / distance * targetPad);
  element.setAttribute("y2", target.y - dy / distance * targetPad);
}

function bindNodeEvents(element, node) {
  element.addEventListener("pointerenter", (event) => {
    state.hoveredNodeId = node.id; highlightNode(node.id); updateLabels();
    showTooltip(event, `<strong>${node.label}</strong><br>${node.tooltip}`);
  });
  element.addEventListener("pointermove", positionTooltip);
  element.addEventListener("pointerleave", () => {
    state.hoveredNodeId = null; clearHighlight(); updateLabels(); hideTooltip();
  });
  element.addEventListener("pointerdown", (event) => startNodeDrag(event, node));
  element.addEventListener("click", () => {
    if (suppressNextNodeClick) { suppressNextNodeClick = false; return; }
    activateNode(node);
  });
  element.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault(); activateNode(node);
    }
  });
}

function bindWordEdgeEvents(element, edge) {
  element.addEventListener("pointerenter", (event) => {
    const endpoints = new Set([edge.source, edge.target]);
    for (const nodeElement of dom.nodeLayer.children) {
      nodeElement.classList.toggle("is-muted", !endpoints.has(nodeElement.dataset.nodeId));
    }
    for (const edgeElement of dom.edgeLayer.children) {
      const active = edgeElement.dataset.edgeId === edge.id;
      edgeElement.classList.toggle("is-active", active);
      edgeElement.classList.toggle("is-muted", !active);
    }
    const connector = edge.directed ? "→" : "↔";
    const relation = edge.relationType === "classifier_noun"
      ? "量词 → 名词（原始 row→column）"
      : edge.relationType === "noun_noun"
        ? "名词 ↔ 名词（双向共现平均）"
        : "量词 ↔ 量词（双向共现平均）";
    showTooltip(event, [
      `<strong>${edge.sourceWord} ${connector} ${edge.targetWord}</strong>`,
      `关系：${relation}`,
      `PMI：${formatNumber(edge.pmi)}`,
      `NPMI：${formatNumber(edge.npmi)}`,
      `NPMI_log_co_score：${formatNumber(edge.score)}`,
      `Co-occurrence：${formatNumber(edge.coOccurrence)}`,
    ].join("<br>"));
  });
  element.addEventListener("pointermove", positionTooltip);
  element.addEventListener("pointerleave", () => { clearHighlight(); hideTooltip(); });
}

function activateNode(node) {
  if (node.center) return;
  if (state.activeTab === "classifier") { selectClassifier(node.label); return; }
  if (state.activeTab === "noun") {
    if (node.type === "noun") selectNoun(node.label);
    else selectClassifier(node.label);
    return;
  }
  selectWordTarget(node.label);
}

function selectClassifier(classifier) {
  state.currentClassifier = classifier; state.nounCenter = null; state.wordTarget = classifier;
  dom.classifierSearch.value = classifier; dom.searchMessage.textContent = "";
  void renderNetwork();
}

function selectNoun(noun) {
  state.nounCenter = noun; state.wordTarget = noun;
  dom.classifierSearch.value = noun; dom.searchMessage.textContent = "";
  void renderNetwork();
}

function selectWordTarget(word) {
  setWordTargetState(word);
  dom.classifierSearch.value = word; dom.searchMessage.textContent = "";
  void renderNetwork();
}

function highlightNode(nodeId) {
  const connected = new Set([nodeId]);
  for (const edge of state.currentGraph.edges) {
    if (edge.source === nodeId || edge.target === nodeId) {
      connected.add(edge.source); connected.add(edge.target);
    }
  }
  for (const element of dom.nodeLayer.children) {
    element.classList.toggle("is-muted", !connected.has(element.dataset.nodeId));
    element.classList.toggle("is-hovered", element.dataset.nodeId === nodeId);
  }
  for (const element of dom.edgeLayer.children) {
    const active = element.dataset.source === nodeId || element.dataset.target === nodeId;
    element.classList.toggle("is-active", active); element.classList.toggle("is-muted", !active);
  }
}

function clearHighlight() {
  for (const element of [...dom.nodeLayer.children, ...dom.edgeLayer.children]) {
    element.classList.remove("is-muted", "is-active", "is-hovered");
  }
}

function updateLabels() {
  const important = new Set([...state.currentGraph.nodes]
    .filter((node) => !node.center).sort((a, b) => b.size - a.size)
    .slice(0, state.activeTab === "word" ? 14 : 10).map((node) => node.id));
  const graphNodes = new Map(state.currentGraph.nodes.map((node) => [node.id, node]));
  for (const element of dom.nodeLayer.children) {
    const nodeId = element.dataset.nodeId; const node = graphNodes.get(nodeId);
    const visible = Boolean(node?.center) || state.labelMode === "all"
      || (state.labelMode === "important" && important.has(nodeId))
      || state.hoveredNodeId === nodeId;
    element.querySelector(".node-label")?.classList.toggle("label-hidden", !visible);
  }
}

function showTooltip(event, html) {
  dom.tooltip.innerHTML = html; dom.tooltip.classList.remove("is-hidden"); positionTooltip(event);
}

function positionTooltip(event) {
  const rect = dom.graphStage.getBoundingClientRect();
  dom.tooltip.style.left = `${event.clientX - rect.left}px`;
  dom.tooltip.style.top = `${event.clientY - rect.top}px`;
}

function hideTooltip() { dom.tooltip.classList.add("is-hidden"); }

function startNodeDrag(event, node) {
  event.stopPropagation();
  const point = graphPoint(event);
  state.drag = {
    node, offsetX: point.x - node.x, offsetY: point.y - node.y,
    startX: event.clientX, startY: event.clientY, moved: false,
  };
  if (state.activeTab === "word") {
    node.fx = node.x; node.fy = node.y;
    reheatWordSimulation(0.24, 0.12);
  }
  event.currentTarget.setPointerCapture(event.pointerId);
}

function graphPoint(event) {
  const rect = dom.svg.getBoundingClientRect();
  const screenX = event.clientX - rect.left - rect.width / 2;
  const screenY = event.clientY - rect.top - rect.height / 2;
  return {
    x: (screenX - state.view.x) / state.view.scale,
    y: (screenY - state.view.y) / state.view.scale,
  };
}

function moveDraggedNode(event) {
  if (!state.drag) return;
  const point = graphPoint(event); const { node } = state.drag;
  node.x = point.x - state.drag.offsetX; node.y = point.y - state.drag.offsetY;
  if (state.activeTab === "word") { node.fx = node.x; node.fy = node.y; }
  state.drag.moved ||= Math.hypot(
    event.clientX - state.drag.startX, event.clientY - state.drag.startY,
  ) > 4;
  updateNodeElement(node);
}

function updateNodeElement(node) {
  const nodeElement = dom.nodeLayer.querySelector(`[data-node-id="${CSS.escape(node.id)}"]`);
  if (nodeElement) nodeElement.setAttribute("transform", `translate(${node.x} ${node.y})`);
  const nodeById = new Map(state.currentGraph.nodes.map((item) => [item.id, item]));
  for (const edgeElement of dom.edgeLayer.children) {
    if (edgeElement.dataset.source !== node.id && edgeElement.dataset.target !== node.id) continue;
    const edge = state.currentGraph.edges.find((item) => item.id === edgeElement.dataset.edgeId);
    if (edge) setEdgeCoordinates(edgeElement, edge, nodeById);
  }
}

function startPan(event) {
  if (event.target.closest(".network-node")) return;
  state.pan = {
    startX: event.clientX, startY: event.clientY,
    viewX: state.view.x, viewY: state.view.y,
  };
  dom.svg.setPointerCapture(event.pointerId);
}

function movePan(event) {
  if (!state.pan) return;
  state.view.x = state.pan.viewX + event.clientX - state.pan.startX;
  state.view.y = state.pan.viewY + event.clientY - state.pan.startY;
  updateViewportTransform();
}

function endPointerAction() {
  const draggedNode = state.drag?.node;
  suppressNextNodeClick = Boolean(state.drag?.moved); state.drag = null; state.pan = null;
  if (state.activeTab === "word" && draggedNode) {
    draggedNode.fx = null; draggedNode.fy = null;
    reheatWordSimulation(0.18, 0);
  }
}

function updateViewportTransform() {
  const rect = dom.svg.getBoundingClientRect();
  dom.svg.setAttribute("viewBox", `0 0 ${Math.max(rect.width, 1)} ${Math.max(rect.height, 1)}`);
  dom.viewport.setAttribute(
    "transform",
    `translate(${rect.width / 2 + state.view.x} ${rect.height / 2 + state.view.y}) scale(${state.view.scale})`,
  );
}

function updateGraphHeading() {
  if (state.activeTab === "classifier") {
    dom.graphModeLabel.textContent = "量词—量词局部网络";
    dom.graphTitle.textContent = `${state.currentClassifier} 的相似量词`;
  } else if (state.activeTab === "noun") {
    dom.graphModeLabel.textContent = state.nounCenter ? "名词中心视图" : "量词—名词局部网络";
    dom.graphTitle.textContent = state.nounCenter
      ? `${state.nounCenter} 的量词搭配` : `${state.currentClassifier} 的名词搭配`;
  } else {
    dom.graphModeLabel.textContent = "混合词类关系网络 · 1-hop 诱导子图";
    dom.graphTitle.textContent = `${state.wordTarget} 的合理关系 Top 400 直接邻域`;
  }
}

function updateNetworkStats(graph) {
  let rows;
  if (state.activeTab === "classifier") {
    rows = [
      ["当前中心", state.currentClassifier], ["当前可见量词", graph.nodes.length.toLocaleString()],
      ["当前可见关系", graph.edges.length.toLocaleString()], ["Cosine ≥", formatNumber(state.similarityThreshold)],
    ];
  } else if (state.activeTab === "noun") {
    rows = [
      ["当前中心", state.nounCenter || state.currentClassifier],
      ["符合当前条件", graph.qualifiedCount.toLocaleString()],
      ["当前显示", Math.min(graph.qualifiedCount, state.topN).toLocaleString()],
      ["当前指标", nounMetricSpecs[state.nounMetric].label],
    ];
  } else {
    rows = [
      ["当前目标", state.wordTarget],
      ["有效直接邻居", graph.directNeighborCount.toLocaleString()],
      ["最终节点", graph.componentNodeCount.toLocaleString()],
      ["最终关系", graph.componentEdgeCount.toLocaleString()],
      ["合理量词—名词关系", graph.validClassifierNounEdgeCount.toLocaleString()],
      ["Local Communities", graph.localCommunityAvailable
        ? graph.localCommunityCount.toLocaleString() : "不可计算"],
      ["Local Modularity", graph.localCommunityAvailable
        ? formatNumber(graph.localModularity, 3) : "不可计算"],
      ["Global Modularity", Number.isFinite(GLOBAL_MODULARITY)
        ? formatNumber(GLOBAL_MODULARITY, 3) : "未计算"],
    ];
  }
  dom.networkStats.replaceChildren(...rows.map(([label, value]) => {
    const item = document.createElement("span"); item.innerHTML = `${label}<strong>${value}</strong>`;
    return item;
  }));
}

function updateLegend() {
  if (state.activeTab === "classifier") {
    dom.legendContent.innerHTML = [
      "节点大小 = 完整数据搭配名词数（平方根缩放）",
      "边宽 = 共同搭配名词数", "边深浅 = Cosine similarity",
      "节点距离 = Cosine similarity（越相似越近）",
    ].map((text) => `<p>${text}</p>`).join("");
  } else if (state.activeTab === "noun") {
    dom.legendContent.innerHTML = [
      "蓝色圆点 = 量词；赭色圆点 = 名词",
      "名词大小 = 完整数据可搭配量词数（平方根缩放）",
      `边宽与深浅 = ${nounMetricSpecs[state.nounMetric].label}`,
    ].map((text) => `<p>${text}</p>`).join("");
  } else {
    const communityDescription = state.wordCommunityMode === "local"
      ? "颜色 = 当前可见图的局部 Louvain Community"
      : "颜色 = 完整词汇网络的全局固定 Louvain Community";
    dom.legendContent.innerHTML = [
      `▲ = 量词；● = 名词；${communityDescription}`,
      `当前网络 = 先限定合法关系，再取 TARGET 的 Top ${wordManifest.topKPerNode} 直接邻居诱导子图`,
      "局部 Community 仅使用当前可见网络中的正 PMI 边，权重 = PMI",
      "量词 → 名词：仅使用 valid_common 中的合理搭配及原始 row→column 指标",
      "名词 ↔ 名词：双向共现平均后重新计算指标",
      "量词 ↔ 量词：双向共现平均后重新计算指标",
      "画布连线不显示箭头；关系方向与类型可在边 Tooltip 中核查",
      `节点距离 = ${metricDisplayName(state.wordDistanceMetric)}（越强越近）`,
      `边宽 = ${metricDisplayName(state.wordWidthMetric)}`,
      `节点大小 = ${wordSizeDisplayName(state.wordSizeMetric)}`,
    ].map((text) => `<p>${text}</p>`).join("");
  }
}

function renderInformation(graph) {
  dom.thresholdNote.classList.add("is-hidden"); dom.thresholdNote.textContent = "";
  if (state.activeTab === "word") renderWordInformation(graph);
  else if (state.activeTab === "noun" && state.nounCenter) renderNounInformation(graph);
  else renderClassifierInformation(graph);
}

function renderClassifierInformation(graph) {
  const classifier = state.currentClassifier;
  const representative = classifierToNouns.get(classifier) || [];
  dom.infoTitle.textContent = classifier;
  dom.primaryMetric.innerHTML = `完整数据中的搭配名词数<strong>${classifierNounCount.get(classifier).toLocaleString()}</strong>`;
  if (graph.visibleCount <= 1) {
    const metricLabel = nounMetricSpecs[state.nounMetric].label;
    dom.thresholdNote.textContent = state.activeTab === "classifier"
      ? graph.visibleCount === 1 ? "当前相似性阈值下仅有 1 个可见邻居。" : "当前相似性阈值下没有符合条件的邻居。"
      : graph.visibleCount === 1 ? `当前 ${metricLabel} 条件下仅有 1 个可见名词。`
        : `当前 ${metricLabel} 条件下没有符合条件的名词。`;
    dom.thresholdNote.classList.remove("is-hidden");
  }
  const sections = [];
  if (state.activeTab === "classifier") {
    sections.push(infoSection(
      "最相似量词 · 完整数据 Top 10",
      rankedButtons((classifierToSimilarities.get(classifier) || []).slice(0, 10), "classifier", "similarity"),
    ));
  } else {
    sections.push(infoSection(
      `当前条件下显示的名词 · Top ${state.topN}`,
      rankedLabels(graph.visibleRelations || [], "word", state.nounMetric),
    ));
  }
  sections.push(infoSection(
    "代表性名词 · 完整数据 Top 10",
    rankedLabels(representative.slice(0, 10), "word", "score"),
  ));
  dom.infoSections.replaceChildren(...sections);
}

function renderNounInformation(graph) {
  const noun = state.nounCenter;
  dom.infoTitle.textContent = noun;
  dom.primaryMetric.innerHTML = `完整数据中的搭配量词数<strong>${nounClassifierCount.get(noun).toLocaleString()}</strong>`;
  if (graph.visibleCount <= 1) {
    const label = nounMetricSpecs[state.nounMetric].label;
    dom.thresholdNote.textContent = graph.visibleCount === 1
      ? `当前 ${label} 条件下仅有 1 个符合条件的量词搭配。`
      : `当前 ${label} 条件下没有符合条件的量词搭配。`;
    dom.thresholdNote.classList.remove("is-hidden");
  }
  dom.infoSections.replaceChildren(infoSection(
    `当前条件下的量词搭配 · Top ${state.topN}`,
    rankedButtons(graph.visibleRelations || [], "classifier", state.nounMetric),
  ));
}

function renderWordInformation(graph) {
  const node = wordNodeById.get(state.wordTarget);
  const visibleNode = graph.nodes.find((item) => item.center);
  const currentDegree = graph.currentDegree.get(node.index) || 0;
  const localRow = `<span>Local Community：${displayCommunity(visibleNode?.localCommunity, "不可计算")}</span>`;
  const globalRow = `<span>Global Community：${displayCommunity(node.community)}</span>`;
  const communityRows = state.wordCommunityMode === "local"
    ? [localRow, globalRow] : [globalRow, localRow];
  dom.infoTitle.textContent = state.wordTarget;
  dom.primaryMetric.innerHTML = [
    `<span>词类：${node.type === "classifier" ? node.alsoNoun ? "量词（亦作名词）" : "量词" : "名词"}</span>`,
    ...communityRows,
    `<strong>Current Degree：${currentDegree.toLocaleString()}</strong>`,
    `<span>Full Degree：${node.degreeFull.toLocaleString()}</span>`,
  ].join("");
  const notes = [];
  if (graph.centerPrePruneDegree < state.wordDegreeThreshold) {
    notes.push(`中心词修剪前 Degree 为 ${graph.centerPrePruneDegree}，低于当前阈值，但中心词按规则保留。`);
  }
  if (graph.finalDirectNeighborCount <= 1) {
    notes.push(graph.finalDirectNeighborCount === 1
      ? "当前阈值下中心词仅保留 1 个有效邻居。"
      : "当前阈值下中心词没有保留有效邻居。");
  }
  if (node.type === "classifier" && graph.centerValidNounCount === 0) {
    notes.push("当前条件下中心量词没有保留 valid_common 中的合理名词搭配；中心词仍按规则显示。");
  }
  if (graph.removedUnpairedClassifierCount > 0) {
    notes.push(`已删除 ${graph.removedUnpairedClassifierCount} 个未连接任何可见名词的非中心量词。`);
  }
  if (!graph.localCommunityAvailable) {
    notes.push("当前过滤条件下没有可用于 Community 计算的正 PMI 边。");
  } else if (graph.componentNodeCount > 350 || graph.componentEdgeCount > 5000) {
    notes.push("当前 1-hop 诱导子图较大，交互可能变慢；可提高 PMI、共现或 Degree 阈值。");
  }
  if (notes.length) {
    dom.thresholdNote.textContent = notes.join(" ");
    dom.thresholdNote.classList.remove("is-hidden");
  }
  const strongest = [...graph.targetRelations]
    .sort((a, b) => b[state.wordRankMetric] - a[state.wordRankMetric]).slice(0, 10);
  dom.infoSections.replaceChildren(
    infoSection("网络指标", wordMetricList(node)),
    infoSection(`最强关联词 · ${metricDisplayName(state.wordRankMetric)} Top 10`, wordRankedButtons(strongest)),
    infoSection("当前过滤", wordFilterSummary(graph)),
  );
}

function wordMetricList(node) {
  const list = document.createElement("dl"); list.className = "metric-list";
  const rows = [
    ["Betweenness", node.betweenness], ["Closeness", node.closeness],
    ["Eigenvector", node.eigenvector], ["Clustering", node.clustering],
  ];
  for (const [label, value] of rows) {
    const term = document.createElement("dt"); term.textContent = label;
    const detail = document.createElement("dd"); detail.textContent = formatNumber(value, 4);
    list.append(term, detail);
  }
  const note = document.createElement("p"); note.className = "method-note";
  note.textContent = "Clustering 为精确非加权值，Eigenvector 为 PMI 加权精确值；Closeness 与 Betweenness 因固定分析图规模过大未计算，未用近似值替代。";
  const wrapper = document.createElement("div"); wrapper.append(list, note); return wrapper;
}

function wordRankedButtons(rows) {
  if (!rows.length) return emptyList();
  const list = document.createElement("ol"); list.className = "ranked-list word-ranked-list";
  rows.forEach((row, index) => {
    const item = document.createElement("li");
    const button = document.createElement("button"); button.type = "button"; button.textContent = row.neighbor;
    button.addEventListener("click", () => selectWordTarget(row.neighbor));
    const details = document.createElement("span"); details.className = "rank-details";
    details.textContent = `${metricDisplayName(state.wordRankMetric)} ${formatNumber(row[state.wordRankMetric])} · 共现 ${row.coOccurrence.toLocaleString()}`;
    item.append(rankNumber(index), button, details); list.append(item);
  });
  return list;
}

function wordFilterSummary(graph) {
  const element = document.createElement("div"); element.className = "filter-summary";
  element.innerHTML = [
    `PMI ≥ ${formatNumber(state.wordPmiThreshold, 2)}`,
    `Co-occurrence ≥ ${state.wordCoThreshold.toLocaleString()}`,
    `Degree ≥ ${state.wordDegreeThreshold}`,
    `TARGET 有效直接邻居：${graph.directNeighborCount.toLocaleString()}；Degree 修剪后保留：${graph.finalDirectNeighborCount.toLocaleString()}`,
    `当前 1-hop 诱导子图：${graph.componentNodeCount.toLocaleString()} nodes / ${graph.componentEdgeCount.toLocaleString()} relations`,
    `合理量词—名词关系：${graph.validClassifierNounEdgeCount.toLocaleString()}；无名词连接而删除的量词：${graph.removedUnpairedClassifierCount.toLocaleString()}`,
    `Local Louvain：${graph.localCommunityAvailable
      ? `${graph.localCommunityCount} communities / modularity ${formatNumber(graph.localModularity, 4)}`
      : "不可计算"}`,
    `当前图上的 Global assignment modularity：${formatNumber(graph.globalProjectedModularity, 4)}`,
    `Global Modularity（完整固定图）：${formatNumber(GLOBAL_MODULARITY, 4)}`,
    `Local Community 使用 ${graph.localPositiveEdgeCount.toLocaleString()} 条正 PMI 边，weight = PMI`,
    `Local Louvain 用时：${formatNumber(graph.localCommunityMs, 2)} ms${graph.localCommunityCacheHit ? "（cache 命中，未重算）" : ""}`,
    `每个词的浏览器候选：先限定合法关系，再按 NPMI_log_co_score 排名前 ${wordManifest.topKPerNode}`,
  ].map((text) => `<p>${text}</p>`).join("");
  return element;
}

function infoSection(title, content) {
  const section = document.createElement("section"); section.className = "info-section";
  const heading = document.createElement("h3"); heading.textContent = title;
  section.append(heading, content); return section;
}

function rankedButtons(rows, labelKey, valueKey) {
  if (!rows.length) return emptyList();
  const list = document.createElement("ol"); list.className = "ranked-list";
  rows.forEach((row, index) => {
    const item = document.createElement("li");
    const button = document.createElement("button"); button.type = "button"; button.textContent = row[labelKey];
    button.addEventListener("click", () => selectClassifier(row[labelKey]));
    item.append(rankNumber(index), button, rankValue(row[valueKey])); list.append(item);
  });
  return list;
}

function rankedLabels(rows, labelKey, valueKey) {
  if (!rows.length) return emptyList();
  const list = document.createElement("ol"); list.className = "ranked-list";
  rows.forEach((row, index) => {
    const item = document.createElement("li");
    const label = document.createElement("span"); label.className = "rank-label"; label.textContent = row[labelKey];
    item.append(rankNumber(index), label, rankValue(row[valueKey])); list.append(item);
  });
  return list;
}

function rankNumber(index) {
  const number = document.createElement("span"); number.className = "rank-number";
  number.textContent = String(index + 1).padStart(2, "0"); return number;
}

function rankValue(value) {
  const element = document.createElement("span"); element.className = "rank-value";
  element.textContent = formatNumber(value); return element;
}

function emptyList() {
  const message = document.createElement("p"); message.className = "empty-list";
  message.textContent = "暂无符合条件的记录。"; return message;
}

function metricDisplayName(metric) {
  return ({
    pmi: "PMI", coOccurrence: "Co-occurrence", npmi: "NPMI", score: "NPMI_log_co_score",
  })[metric] || metric;
}

function wordSizeDisplayName(metric) {
  return ({
    currentDegree: "Current Degree", fullDegree: "Full Degree",
    coWithTarget: "Co-occurrence with current target", betweenness: "Betweenness",
    closeness: "Closeness", eigenvector: "Eigenvector", clustering: "Clustering",
  })[metric] || metric;
}

function updateSearchOptions() {
  const values = state.activeTab === "word"
    ? wordNodes.map((node) => node.id)
    : state.activeTab === "noun" ? classifierNounSearchWords : classifiers;
  const fragment = document.createDocumentFragment();
  for (const value of values) {
    const option = document.createElement("option"); option.value = value; fragment.append(option);
  }
  dom.classifierOptions.replaceChildren(fragment);
  const searchesWords = state.activeTab === "word" || state.activeTab === "noun";
  dom.searchLabel.textContent = searchesWords ? "搜索量词或名词" : "搜索量词";
  dom.classifierSearch.placeholder = searchesWords ? "例如：树 或 一棵" : "例如：一棵";
}

function degreeThresholdFromSlider(position) {
  const x = clamp(Number(position), 0, WORD_DEGREE_SLIDER_MAX);
  if (WORD_DEGREE_MAX <= WORD_DEGREE_KNEE) {
    return Math.round(1 + x / WORD_DEGREE_SLIDER_MAX * (WORD_DEGREE_MAX - 1));
  }
  if (x <= WORD_DEGREE_SLIDER_MID) {
    return Math.round(1 + x / WORD_DEGREE_SLIDER_MID * (WORD_DEGREE_KNEE - 1));
  }
  const ratio = (x - WORD_DEGREE_SLIDER_MID) / WORD_DEGREE_SLIDER_MID;
  return Math.round(WORD_DEGREE_KNEE * Math.pow(WORD_DEGREE_MAX / WORD_DEGREE_KNEE, ratio));
}

function degreeSliderFromThreshold(threshold) {
  const value = clamp(Number(threshold), 1, WORD_DEGREE_MAX);
  if (WORD_DEGREE_MAX <= WORD_DEGREE_KNEE) {
    return Math.round((value - 1) / Math.max(1, WORD_DEGREE_MAX - 1) * WORD_DEGREE_SLIDER_MAX);
  }
  if (value <= WORD_DEGREE_KNEE) {
    return Math.round((value - 1) / (WORD_DEGREE_KNEE - 1) * WORD_DEGREE_SLIDER_MID);
  }
  return Math.round(
    WORD_DEGREE_SLIDER_MID
      + Math.log(value / WORD_DEGREE_KNEE) / Math.log(WORD_DEGREE_MAX / WORD_DEGREE_KNEE)
        * WORD_DEGREE_SLIDER_MID,
  );
}

function syncDegreeControl() {
  dom.wordDegreeSlider.value = String(degreeSliderFromThreshold(state.wordDegreeThreshold));
  dom.wordDegreeNumber.value = String(state.wordDegreeThreshold);
}

function configureNounMetric() {
  const spec = nounMetricSpecs[state.nounMetric];
  const [minimum, maximum] = nounMetricRanges[state.nounMetric];
  // Range inputs quantize from their min value. Align both bounds to the
  // metric step so typed values remain exactly synchronized with the slider.
  const sliderMinimum = Math.floor(minimum / spec.step) * spec.step;
  const sliderMaximum = Math.ceil(maximum / spec.step) * spec.step;
  dom.nounThresholdLabel.textContent = `${spec.label} 阈值`; dom.nounThresholdHelp.textContent = spec.help;
  dom.npmiSlider.min = String(sliderMinimum); dom.npmiSlider.max = String(sliderMaximum); dom.npmiSlider.step = String(spec.step);
  dom.npmiNumber.min = String(sliderMinimum); dom.npmiNumber.max = String(sliderMaximum); dom.npmiNumber.step = String(spec.step);
  const disabled = spec.direction === "none";
  dom.npmiSlider.disabled = disabled; dom.npmiNumber.disabled = disabled;
  if (!disabled) {
    state.nounThreshold = spec.direction === "lte" ? sliderMaximum : sliderMinimum;
    dom.npmiSlider.value = String(state.nounThreshold); dom.npmiNumber.value = String(state.nounThreshold);
  } else {
    dom.npmiSlider.value = String(sliderMinimum); dom.npmiNumber.value = "";
  }
}

function configureControls() {
  dom.classifierCount.textContent = classifiers.length.toLocaleString();
  dom.similarityCount.textContent = similarityRelations.length.toLocaleString();
  dom.nounRelationCount.textContent = nounRelations.length.toLocaleString();
  dom.wordCount.textContent = wordNodes.length.toLocaleString();
  dom.classifierSearch.value = state.currentClassifier; updateSearchOptions();
  const similarityCeiling = Math.ceil(similarityMax * 1000) / 1000;
  for (const control of [dom.similaritySlider, dom.similarityNumber]) {
    control.max = String(similarityCeiling); control.value = "0";
  }
  configureNounMetric();
  dom.wordPmiSlider.value = String(state.wordPmiThreshold); dom.wordPmiNumber.value = String(state.wordPmiThreshold);
  dom.wordCoNumber.max = String(WORD_CO_MAX);
  syncCoOccurrenceControl();
  dom.wordDegreeSlider.max = String(WORD_DEGREE_SLIDER_MAX);
  dom.wordDegreeNumber.max = String(WORD_DEGREE_MAX);
  syncDegreeControl();
  dom.wordCommunityMode.value = state.wordCommunityMode;
  const unavailable = ["betweenness", "closeness"];
  for (const option of dom.wordSizeMetric.options) {
    if (unavailable.includes(option.value)) option.disabled = true;
  }
}

function switchTab(tabName) {
  state.activeTab = tabName;
  if (tabName === "classifier") {
    state.nounCenter = null;
  } else if (tabName === "noun") {
    if (classifierSet.has(state.wordTarget)) {
      state.currentClassifier = state.wordTarget;
      state.nounCenter = null;
    } else if (nounSet.has(state.wordTarget)) {
      state.nounCenter = state.wordTarget;
    }
  }
  for (const tab of dom.tabs) {
    const active = tab.dataset.tab === tabName;
    tab.classList.toggle("is-active", active); tab.setAttribute("aria-selected", String(active));
  }
  const classifierMode = tabName === "classifier";
  const nounMode = tabName === "noun"; const wordMode = tabName === "word";
  dom.similarityControl.classList.toggle("is-hidden", !classifierMode);
  dom.npmiControl.classList.toggle("is-hidden", !nounMode);
  dom.topNControl.classList.toggle("is-hidden", !nounMode);
  dom.wordControls.classList.toggle("is-hidden", !wordMode);
  dom.nounLegend.classList.toggle("is-hidden", classifierMode);
  dom.classifierSearch.value = wordMode
    ? state.wordTarget : nounMode ? state.nounCenter || state.currentClassifier : state.currentClassifier;
  updateSearchOptions(); void renderNetwork();
}

function syncInputs(range, number, callback) {
  range.addEventListener("input", () => { number.value = range.value; callback(Number(range.value)); });
  const updateFromNumber = () => {
    if (number.value === "" || !Number.isFinite(Number(number.value))) return;
    const value = clamp(Number(number.value), Number(range.min), Number(range.max));
    number.value = String(value); range.value = String(value); callback(value);
  };
  number.addEventListener("input", updateFromNumber);
  number.addEventListener("change", updateFromNumber);
}

function scheduleWordNetworkRender() {
  if (state.wordRenderTimer) clearTimeout(state.wordRenderTimer);
  state.wordRenderTimer = setTimeout(() => {
    state.wordRenderTimer = null;
    void renderNetwork();
  }, WORD_RENDER_DEBOUNCE_MS);
}

function bindCoOccurrenceInputs() {
  dom.wordCoSlider.addEventListener("input", () => {
    state.wordCoThreshold = coThresholdFromSlider(dom.wordCoSlider.value);
    syncCoOccurrenceControl();
    scheduleWordNetworkRender();
  });
  const updateFromNumber = () => {
    if (dom.wordCoNumber.value === "" || !Number.isFinite(Number(dom.wordCoNumber.value))) return;
    state.wordCoThreshold = Math.round(clamp(Number(dom.wordCoNumber.value), 1, WORD_CO_MAX));
    syncCoOccurrenceControl();
    scheduleWordNetworkRender();
  };
  dom.wordCoNumber.addEventListener("input", updateFromNumber);
  dom.wordCoNumber.addEventListener("change", updateFromNumber);
}

function bindDegreeInputs() {
  dom.wordDegreeSlider.addEventListener("input", () => {
    state.wordDegreeThreshold = degreeThresholdFromSlider(dom.wordDegreeSlider.value);
    syncDegreeControl();
    scheduleWordNetworkRender();
  });
  const updateFromNumber = () => {
    if (dom.wordDegreeNumber.value === "" || !Number.isFinite(Number(dom.wordDegreeNumber.value))) return;
    state.wordDegreeThreshold = Math.round(clamp(Number(dom.wordDegreeNumber.value), 1, WORD_DEGREE_MAX));
    syncDegreeControl();
    scheduleWordNetworkRender();
  };
  dom.wordDegreeNumber.addEventListener("input", updateFromNumber);
  dom.wordDegreeNumber.addEventListener("change", updateFromNumber);
}

function bindControls() {
  for (const tab of dom.tabs) tab.addEventListener("click", () => switchTab(tab.dataset.tab));
  dom.searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = dom.classifierSearch.value.trim();
    const available = state.activeTab === "word"
      ? wordSet : state.activeTab === "noun" ? classifierNounSearchSet : classifierSet;
    if (!available.has(value)) {
      const nounText = state.activeTab === "word" || state.activeTab === "noun" ? "量词或名词" : "量词";
      dom.searchMessage.textContent = `未找到${nounText}“${value || "（空）"}”。请输入列表中的完整词语。`;
      return;
    }
    if (state.activeTab === "word") {
      selectWordTarget(value);
    } else if (state.activeTab === "noun" && !classifierSet.has(value)) {
      selectNoun(value);
    } else {
      selectClassifier(value);
      if (state.activeTab === "noun" && nounSet.has(value)) {
        dom.searchMessage.textContent = "该词同时存在量词和名词身份，当前按量词查询。";
      }
    }
  });
  syncInputs(dom.similaritySlider, dom.similarityNumber, (value) => {
    state.similarityThreshold = value; void renderNetwork();
  });
  syncInputs(dom.npmiSlider, dom.npmiNumber, (value) => {
    state.nounThreshold = value; void renderNetwork();
  });
  syncInputs(dom.wordPmiSlider, dom.wordPmiNumber, (value) => {
    state.wordPmiThreshold = value; scheduleWordNetworkRender();
  });
  bindCoOccurrenceInputs();
  bindDegreeInputs();
  dom.nounMetric.addEventListener("change", () => {
    state.nounMetric = dom.nounMetric.value; configureNounMetric(); void renderNetwork();
  });
  for (const button of dom.topNButtons) {
    button.addEventListener("click", () => {
      state.topN = Number(button.dataset.topn);
      dom.topNButtons.forEach((item) => item.classList.toggle("is-active", item === button));
      void renderNetwork();
    });
  }
  dom.labelMode.addEventListener("change", () => { state.labelMode = dom.labelMode.value; updateLabels(); });
  const wordSelects = [
    [dom.wordDistanceMetric, "wordDistanceMetric"], [dom.wordWidthMetric, "wordWidthMetric"],
    [dom.wordSizeMetric, "wordSizeMetric"], [dom.wordRankMetric, "wordRankMetric"],
  ];
  for (const [control, key] of wordSelects) {
    control.addEventListener("change", () => { state[key] = control.value; void renderNetwork(); });
  }
  dom.wordCommunityMode.addEventListener("change", () => {
    state.wordCommunityMode = dom.wordCommunityMode.value;
    refreshWordCommunityPresentation();
  });
  dom.resetView.addEventListener("click", () => {
    state.view = { x: 0, y: 0, scale: 1 }; updateViewportTransform();
  });
  dom.relayoutView.addEventListener("click", () => {
    if (state.activeTab === "word") resetWordLayout(); else state.layoutSeed += 1;
    void renderNetwork();
  });
  dom.svg.addEventListener("pointerdown", startPan);
  dom.svg.addEventListener("pointermove", (event) => { moveDraggedNode(event); movePan(event); });
  dom.svg.addEventListener("pointerup", endPointerAction);
  dom.svg.addEventListener("pointercancel", endPointerAction);
  dom.svg.addEventListener("wheel", (event) => {
    event.preventDefault();
    state.view.scale = clamp(state.view.scale * (event.deltaY < 0 ? 1.12 : 0.89), 0.45, 2.8);
    updateViewportTransform();
  }, { passive: false });
  new ResizeObserver(updateViewportTransform).observe(dom.graphStage);
  dom.openStarMap.addEventListener("click", openStarMap);
  dom.closeStarMap.addEventListener("click", closeStarMap);
  dom.starSvg.addEventListener("pointerdown", startStarPan);
  dom.starSvg.addEventListener("pointermove", moveStarPan);
  dom.starSvg.addEventListener("pointerup", endStarPan);
  dom.starSvg.addEventListener("pointercancel", endStarPan);
  window.addEventListener("pointerup", endStarPan);
  window.addEventListener("pointercancel", endStarPan);
  dom.starSvg.addEventListener("lostpointercapture", (event) => {
    if (state.starPan?.pointerId !== event.pointerId) return;
    state.starPan = null;
    dom.starStage.classList.remove("is-panning");
  });
  dom.starSvg.addEventListener("wheel", (event) => {
    event.preventDefault();
    state.starView.scale = clamp(state.starView.scale * (event.deltaY < 0 ? 1.1 : 0.9), 0.7, 2.2);
    applyStarViewport();
  }, { passive: false });
  dom.starSvg.addEventListener("dblclick", () => {
    state.starView = { x: 0, y: 0, scale: 1 };
    applyStarViewport();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !state.starOpen) return;
    if (dom.starRuleMenu.open) dom.starRuleMenu.open = false;
    else closeStarMap();
  });
}

window.__NETWORK_DEBUG__ = {
  snapshot() {
    return {
      activeTab: state.activeTab, currentClassifier: state.currentClassifier,
      nounCenter: state.nounCenter, wordTarget: state.wordTarget,
      similarityThreshold: state.similarityThreshold, nounMetric: state.nounMetric,
      nounThreshold: state.nounThreshold, topN: state.topN, labelMode: state.labelMode,
      wordPmiThreshold: state.wordPmiThreshold, wordCoThreshold: state.wordCoThreshold,
      wordCoSliderPosition: Number(dom.wordCoSlider.value),
      wordDegreeThreshold: state.wordDegreeThreshold,
      wordDegreeSliderPosition: Number(dom.wordDegreeSlider.value),
      wordCommunityMode: state.wordCommunityMode,
      localCommunityRunCount: state.wordCommunityRunCount,
      localCommunityAvailable: state.currentGraph.localCommunityAvailable,
      localCommunityCount: state.currentGraph.localCommunityCount,
      localModularity: state.currentGraph.localModularity,
      globalProjectedModularity: state.currentGraph.globalProjectedModularity,
      globalModularity: GLOBAL_MODULARITY,
      localPositiveEdgeCount: state.currentGraph.localPositiveEdgeCount,
      localCommunityMs: state.currentGraph.localCommunityMs,
      localCommunityCacheHit: state.currentGraph.localCommunityCacheHit,
      totalGraphUpdateMs: state.currentGraph.totalUpdateMs,
      visibleNodeCount: state.currentGraph.nodes.length,
      visibleEdgeCount: state.currentGraph.edges.length,
      directNeighborCount: state.currentGraph.directNeighborCount,
      finalDirectNeighborCount: state.currentGraph.finalDirectNeighborCount,
      centerValidNounCount: state.currentGraph.centerValidNounCount,
      removedUnpairedClassifierCount: state.currentGraph.removedUnpairedClassifierCount,
      validClassifierNounEdgeCount: state.currentGraph.validClassifierNounEdgeCount,
      centerPrePruneDegree: state.currentGraph.centerPrePruneDegree,
      visibleLabels: state.currentGraph.nodes.map((node) => node.label),
      visibleNodes: state.currentGraph.nodes.map((node) => ({
        label: node.label, type: node.type, community: node.community,
        localCommunity: node.localCommunity, globalCommunity: node.globalCommunity,
        currentDegree: node.currentDegree, prePruneDegree: node.prePruneDegree,
        size: node.size, x: node.x, y: node.y, color: node.color,
      })),
      visibleEdges: state.currentGraph.edges.map((edge) => ({
        source: edge.source, target: edge.target, metric: edge.metric, value: edge.value,
        pmi: edge.pmi, coOccurrence: edge.coOccurrence,
        relationType: edge.relationType, directed: edge.directed,
      })),
      starMap: {
        open: state.starOpen,
        target: state.wordTarget,
        fixedThresholds: {
          pmiGreaterThan: STAR_PMI_THRESHOLD,
          coOccurrenceGreaterThan: STAR_CO_THRESHOLD,
          degreeGreaterThan: STAR_DEGREE_THRESHOLD,
        },
        visibleNodeCount: state.starGraph?.nodes.length || 0,
        visibleEdgeCount: state.starGraph?.edges.length || 0,
        labelsVisibleByDefault: false,
        loadedChunkCount: wordChunkBuffers.size,
      },
    };
  },
};

configureControls();
bindControls();
void renderNetwork();
