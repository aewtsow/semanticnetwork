"use strict";

const SVG_NS = "http://www.w3.org/2000/svg";
const nounRelations = window.CLASSIFIER_NOUN_DATA;
const similarityRelations = window.CLASSIFIER_SIMILARITY_DATA;
const wordNodes = window.WORD_NETWORK_NODES;
const wordManifest = window.WORD_NETWORK_EDGE_MANIFEST;

if (![nounRelations, similarityRelations, wordNodes].every(Array.isArray) || !wordManifest) {
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
};

const classifierToNouns = new Map();
const nounToClassifiers = new Map();
const classifierToSimilarities = new Map();

for (const relation of nounRelations) {
  addToIndex(classifierToNouns, relation.classifier, relation);
  addToIndex(nounToClassifiers, relation.word, relation);
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
const COMMUNITY_COLORS = [
  "#8f5d5d", "#58758a", "#8a7750", "#56796f", "#75698d",
  "#9a6d4a", "#607c91", "#7f6555", "#687d58", "#8b6477",
];
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
  wordBuffersLoaded: false,
  wordBuffersPromise: null,
  layoutSeed: 0,
  view: { x: 0, y: 0, scale: 1 },
  currentGraph: { nodes: [], edges: [], visibleCount: 0 },
  drag: null,
  pan: null,
  renderToken: 0,
  wordLayoutTarget: null,
  wordPositionCache: new Map(),
  wordSimulation: null,
};

let suppressNextNodeClick = false;

function addToIndex(index, key, value) {
  if (!index.has(key)) index.set(key, []);
  index.get(key).push(value);
}

function zhSort(a, b) {
  return String(a).localeCompare(String(b), "zh-CN");
}

function extent(values) {
  return [Math.min(...values), Math.max(...values)];
}

function communityColor(community) {
  if (!Number.isInteger(community)) return "#aaa79f";
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

async function ensureWordBuffers() {
  if (state.wordBuffersLoaded) return;
  if (!state.wordBuffersPromise) {
    state.wordBuffersPromise = Promise.all(wordManifest.chunks.map(async (chunk, index) => {
      const response = await fetch(`${wordManifest.chunkBasePath}${chunk.file}`);
      if (!response.ok) throw new Error(`词汇网络数据分块加载失败：${chunk.file}`);
      wordChunkBuffers.set(index, await response.arrayBuffer());
    })).then(() => { state.wordBuffersLoaded = true; });
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
    const coOccurrence = view.getFloat64(byteOffset + 4, true);
    const neighbor = wordNodes[neighborIndex];
    const sameType = node.type === neighbor.type;
    let sourceIndex;
    let targetIndex;
    let relationType;
    let directed;
    let total;
    let sourceFrequency;
    let targetFrequency;
    if (sameType) {
      sourceIndex = Math.min(nodeIndex, neighborIndex);
      targetIndex = Math.max(nodeIndex, neighborIndex);
      relationType = node.type === "classifier" ? "classifier_classifier" : "noun_noun";
      directed = false;
      total = wordManifest.symmetricTotal;
      sourceFrequency = wordNodes[sourceIndex].symFrequency;
      targetFrequency = wordNodes[targetIndex].symFrequency;
    } else {
      sourceIndex = node.type === "classifier" ? nodeIndex : neighborIndex;
      targetIndex = node.type === "classifier" ? neighborIndex : nodeIndex;
      relationType = "classifier_noun";
      directed = true;
      total = wordManifest.total;
      sourceFrequency = wordNodes[sourceIndex].rowSum;
      targetFrequency = wordNodes[targetIndex].columnSum;
    }
    const pmi = Math.log(total) + Math.log(coOccurrence)
      - Math.log(sourceFrequency) - Math.log(targetFrequency);
    const npmi = pmi / -Math.log(coOccurrence / total);
    rows.push({
      key: `${Math.min(nodeIndex, neighborIndex)}|${Math.max(nodeIndex, neighborIndex)}`,
      nodeIndex, neighborIndex, neighbor: neighbor.id,
      sourceIndex, targetIndex,
      sourceWord: wordNodes[sourceIndex].id,
      targetWord: wordNodes[targetIndex].id,
      relationType, directed,
      coOccurrence, pmi, npmi, score: npmi * Math.log(coOccurrence),
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

function weakComponent(targetIndex, allowedNodes, edges) {
  const adjacency = new Map([...allowedNodes].map((index) => [index, []]));
  for (const edge of edges) {
    if (!allowedNodes.has(edge.sourceIndex) || !allowedNodes.has(edge.targetIndex)) continue;
    adjacency.get(edge.sourceIndex).push(edge.targetIndex);
    adjacency.get(edge.targetIndex).push(edge.sourceIndex);
  }
  const visited = new Set([targetIndex]);
  const queue = [targetIndex];
  while (queue.length) {
    const current = queue.shift();
    for (const next of adjacency.get(current) || []) {
      if (visited.has(next)) continue;
      visited.add(next); queue.push(next);
    }
  }
  return visited;
}

function wordNodeSizeValue(index, currentDegree, directCo) {
  const node = wordNodes[index];
  if (state.wordSizeMetric === "currentDegree") return currentDegree.get(index) || 0;
  if (state.wordSizeMetric === "fullDegree") return node.degreeFull;
  if (state.wordSizeMetric === "coWithTarget") return directCo.get(index) || 0;
  return Number(node[state.wordSizeMetric]);
}

function buildWordGraph() {
  const targetIndex = wordNodeById.get(state.wordTarget).index;
  const targetRelations = incidentWordRelations(targetIndex);
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
  const currentDegree = weakDegree(candidateIndices, filteredEdges);
  const degreeQualified = new Set([...candidateIndices].filter(
    (index) => (currentDegree.get(index) || 0) >= state.wordDegreeThreshold,
  ));
  const targetPruned = !degreeQualified.has(targetIndex);
  const component = targetPruned ? new Set([targetIndex])
    : weakComponent(targetIndex, degreeQualified, filteredEdges);
  const componentEdges = targetPruned ? [] : filteredEdges.filter(
    (edge) => component.has(edge.sourceIndex) && component.has(edge.targetIndex),
  );
  const directCo = new Map(targetRelations.map((row) => [row.neighborIndex, row.coOccurrence]));
  const rawSizes = [...component].map((index) => wordNodeSizeValue(index, currentDegree, directCo));
  const sizeRange = extent(rawSizes.map((value) => Number.isFinite(value) ? value : 0));
  const metricRange = {};
  for (const metric of ["pmi", "coOccurrence", "npmi", "score"]) {
    metricRange[metric] = componentEdges.length ? extent(componentEdges.map((edge) => edge[metric])) : [0, 1];
  }
  const nodes = [...component].map((index) => {
    const source = wordNodes[index];
    const center = index === targetIndex;
    const rawSize = wordNodeSizeValue(index, currentDegree, directCo);
    return {
      id: `w:${index}`, wordIndex: index, label: source.id, type: source.type,
      shape: source.type === "classifier" ? "triangle" : "circle", center,
      size: center ? 24 : scaleSqrt(Number.isFinite(rawSize) ? rawSize : 0, sizeRange, 7, 21),
      fullCount: source.degreeFull, currentDegree: currentDegree.get(index) || 0,
      community: source.community, color: communityColor(source.community), directCo: directCo.get(index) || 0,
      tooltip: [
        `词类：${source.type === "classifier" ? source.alsoNoun ? "量词（亦作名词）" : "量词" : "名词"}`,
        `Community：${Number.isInteger(source.community) ? source.community : "未纳入固定分析图"}`,
        `Current Degree：${currentDegree.get(index) || 0}`,
        `Full Degree：${source.degreeFull.toLocaleString()}`,
        `与当前目标直接共现：${(directCo.get(index) || 0).toLocaleString()}`,
      ].join("<br>"),
    };
  });
  const edges = componentEdges.map((edge, index) => ({
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
  return {
    nodes, edges, visibleCount: Math.max(0, nodes.length - 1),
    qualifiedCount: degreeQualified.size, candidateCount: candidateIndices.size,
    filteredEdgeCount: filteredEdges.length, targetPruned, currentDegree,
    targetRelations, componentNodeCount: nodes.length, componentEdgeCount: edges.length,
  };
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
    ? graph.targetPruned
      ? "当前 Degree 阈值下，该词已被修剪。请降低 Degree threshold。"
      : "当前阈值下没有可显示的邻居。中心节点仍然保留；请调整阈值继续探索。"
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
    if (node.type === "noun") { state.nounCenter = node.label; void renderNetwork(); }
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

function selectWordTarget(word) {
  if (word !== state.wordTarget) {
    state.wordPositionCache.clear();
    state.wordLayoutTarget = word;
  }
  state.wordTarget = word;
  const metadata = wordNodeById.get(word);
  if (metadata?.type === "classifier") state.currentClassifier = word;
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
    dom.graphModeLabel.textContent = "混合词类关系网络 · 弱连通分量";
    dom.graphTitle.textContent = `${state.wordTarget} 的 Top 400 词汇网络`;
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
      ["当前目标", state.wordTarget], ["候选词", graph.candidateCount.toLocaleString()],
      ["当前分量节点", graph.componentNodeCount.toLocaleString()],
      ["当前分量关系", graph.componentEdgeCount.toLocaleString()],
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
    dom.legendContent.innerHTML = [
      "▲ = 量词；● = 名词；颜色 = 固定 Louvain community",
      "量词 → 名词：使用 classifier→noun 原始 row→column 指标",
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
  const currentDegree = graph.currentDegree.get(node.index) || 0;
  dom.infoTitle.textContent = state.wordTarget;
  dom.primaryMetric.innerHTML = [
    `<span>词类：${node.type === "classifier" ? node.alsoNoun ? "量词（亦作名词）" : "量词" : "名词"}</span>`,
    `<span>Community：${Number.isInteger(node.community) ? node.community : "未纳入固定分析图"}</span>`,
    `<strong>Current Degree：${currentDegree.toLocaleString()}</strong>`,
    `<span>Full Degree：${node.degreeFull.toLocaleString()}</span>`,
  ].join("");
  if (graph.targetPruned) {
    dom.thresholdNote.textContent = "当前 Degree 阈值下，该词已被修剪。请降低 Degree threshold。";
    dom.thresholdNote.classList.remove("is-hidden");
  } else if (graph.componentNodeCount > 350 || graph.componentEdgeCount > 5000) {
    dom.thresholdNote.textContent = "当前连通分量较大，交互可能变慢；可提高 PMI、共现或 Degree 阈值。";
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
    `当前弱连通分量：${graph.componentNodeCount.toLocaleString()} nodes / ${graph.componentEdgeCount.toLocaleString()} relations`,
    `显示候选：按完整数据 NPMI_log_co_score 排名前 ${wordManifest.topKPerNode}`,
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
  const values = state.activeTab === "word" ? wordNodes.map((node) => node.id) : classifiers;
  const fragment = document.createDocumentFragment();
  for (const value of values) {
    const option = document.createElement("option"); option.value = value; fragment.append(option);
  }
  dom.classifierOptions.replaceChildren(fragment);
  dom.searchLabel.textContent = state.activeTab === "word" ? "搜索量词或名词" : "搜索量词";
  dom.classifierSearch.placeholder = state.activeTab === "word" ? "例如：树 或 一棵" : "例如：一棵";
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
  dom.wordDegreeSlider.max = String(wordManifest.topKPerNode);
  dom.wordDegreeNumber.max = String(wordManifest.topKPerNode);
  dom.wordDegreeSlider.value = String(state.wordDegreeThreshold); dom.wordDegreeNumber.value = String(state.wordDegreeThreshold);
  const unavailable = ["betweenness", "closeness"];
  for (const option of dom.wordSizeMetric.options) {
    if (unavailable.includes(option.value)) option.disabled = true;
  }
}

function switchTab(tabName) {
  state.activeTab = tabName; state.nounCenter = null;
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
  dom.classifierSearch.value = wordMode ? state.wordTarget : state.currentClassifier;
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

function bindCoOccurrenceInputs() {
  dom.wordCoSlider.addEventListener("input", () => {
    state.wordCoThreshold = coThresholdFromSlider(dom.wordCoSlider.value);
    syncCoOccurrenceControl();
    void renderNetwork();
  });
  const updateFromNumber = () => {
    if (dom.wordCoNumber.value === "" || !Number.isFinite(Number(dom.wordCoNumber.value))) return;
    state.wordCoThreshold = Math.round(clamp(Number(dom.wordCoNumber.value), 1, WORD_CO_MAX));
    syncCoOccurrenceControl();
    void renderNetwork();
  };
  dom.wordCoNumber.addEventListener("input", updateFromNumber);
  dom.wordCoNumber.addEventListener("change", updateFromNumber);
}

function bindControls() {
  for (const tab of dom.tabs) tab.addEventListener("click", () => switchTab(tab.dataset.tab));
  dom.searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = dom.classifierSearch.value.trim();
    const available = state.activeTab === "word" ? wordSet : classifierSet;
    if (!available.has(value)) {
      const nounText = state.activeTab === "word" ? "量词或名词" : "量词";
      dom.searchMessage.textContent = `未找到${nounText}“${value || "（空）"}”。请输入列表中的完整词语。`;
      return;
    }
    if (state.activeTab === "word") selectWordTarget(value); else selectClassifier(value);
  });
  syncInputs(dom.similaritySlider, dom.similarityNumber, (value) => {
    state.similarityThreshold = value; void renderNetwork();
  });
  syncInputs(dom.npmiSlider, dom.npmiNumber, (value) => {
    state.nounThreshold = value; void renderNetwork();
  });
  syncInputs(dom.wordPmiSlider, dom.wordPmiNumber, (value) => {
    state.wordPmiThreshold = value; void renderNetwork();
  });
  bindCoOccurrenceInputs();
  syncInputs(dom.wordDegreeSlider, dom.wordDegreeNumber, (value) => {
    state.wordDegreeThreshold = Math.round(value); void renderNetwork();
  });
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
      visibleNodeCount: state.currentGraph.nodes.length,
      visibleEdgeCount: state.currentGraph.edges.length,
      visibleLabels: state.currentGraph.nodes.map((node) => node.label),
      visibleNodes: state.currentGraph.nodes.map((node) => ({
        label: node.label, type: node.type, community: node.community,
        size: node.size, x: node.x, y: node.y, color: node.color,
      })),
      visibleEdges: state.currentGraph.edges.map((edge) => ({
        source: edge.source, target: edge.target, metric: edge.metric, value: edge.value,
        pmi: edge.pmi, coOccurrence: edge.coOccurrence,
        relationType: edge.relationType, directed: edge.directed,
      })),
    };
  },
};

configureControls();
bindControls();
void renderNetwork();
