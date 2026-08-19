"use strict";

const SVG_NS = "http://www.w3.org/2000/svg";
const nounRelations = window.CLASSIFIER_NOUN_DATA;
const similarityRelations = window.CLASSIFIER_SIMILARITY_DATA;

if (!Array.isArray(nounRelations) || !Array.isArray(similarityRelations)) {
  throw new Error("网页数据未正确加载，请先运行 prepare_data.py。\n");
}

const dom = {
  classifierCount: document.querySelector("#classifierCount"),
  similarityCount: document.querySelector("#similarityCount"),
  nounRelationCount: document.querySelector("#nounRelationCount"),
  tabs: [...document.querySelectorAll(".tab-button")],
  searchForm: document.querySelector("#searchForm"),
  classifierSearch: document.querySelector("#classifierSearch"),
  classifierOptions: document.querySelector("#classifierOptions"),
  searchMessage: document.querySelector("#searchMessage"),
  similarityControl: document.querySelector("#similarityControl"),
  similaritySlider: document.querySelector("#similaritySlider"),
  similarityNumber: document.querySelector("#similarityNumber"),
  npmiControl: document.querySelector("#npmiControl"),
  npmiSlider: document.querySelector("#npmiSlider"),
  npmiNumber: document.querySelector("#npmiNumber"),
  topNControl: document.querySelector("#topNControl"),
  topNButtons: [...document.querySelectorAll("[data-topn]")],
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
  networkStats: document.querySelector("#networkStats"),
  graphLegendContent: document.querySelector("#graphLegendContent"),
  tooltip: document.querySelector("#tooltip"),
  relayoutGraph: document.querySelector("#relayoutGraph"),
  resetView: document.querySelector("#resetView"),
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

for (const relations of classifierToNouns.values()) {
  relations.sort((a, b) => b.score - a.score);
}
for (const relations of nounToClassifiers.values()) {
  relations.sort((a, b) => b.score - a.score);
}
for (const relations of classifierToSimilarities.values()) {
  relations.sort((a, b) => b.similarity - a.similarity);
}

const classifiers = [...classifierToNouns.keys()].sort((a, b) => a.localeCompare(b, "zh-CN"));
const classifierSet = new Set(classifiers);
const classifierNounCount = new Map(
  [...classifierToNouns].map(([classifier, relations]) => [
    classifier,
    new Set(relations.map((row) => row.word)).size,
  ]),
);
const nounClassifierCount = new Map(
  [...nounToClassifiers].map(([noun, relations]) => [
    noun,
    new Set(relations.map((row) => row.classifier)).size,
  ]),
);
const fullSimilarityDegree = new Map(
  classifiers.map((classifier) => [
    classifier,
    (classifierToSimilarities.get(classifier) || []).length,
  ]),
);

const scoreValues = nounRelations.map((row) => row.score);
const similarityValues = similarityRelations.map((row) => row.similarity);
const scoreMin = Math.min(...scoreValues);
const scoreMax = Math.max(...scoreValues);
const similarityMax = Math.max(...similarityValues);
const classifierCountRange = extent([...classifierNounCount.values()]);
const nounCountRange = extent([...nounClassifierCount.values()]);
const commonNounRange = extent(similarityRelations.map((row) => row.commonNouns));

const state = {
  activeTab: "classifier",
  currentClassifier: classifierSet.has("一棵") ? "一棵" : classifiers[0],
  nounCenter: null,
  similarityThreshold: 0,
  npmiThreshold: scoreMax,
  topN: 10,
  labelMode: "important",
  layoutRevision: 0,
  view: { x: 0, y: 0, scale: 1 },
  currentGraph: { nodes: [], edges: [] },
  drag: null,
  pan: null,
};

let suppressNextNodeClick = false;

function addToIndex(index, key, value) {
  if (!index.has(key)) index.set(key, []);
  index.get(key).push(value);
}

function extent(values) {
  return [Math.min(...values), Math.max(...values)];
}

function scaleLog(value, [min, max], outputMin, outputMax) {
  if (max === min) return (outputMin + outputMax) / 2;
  const normalized = (Math.log1p(value) - Math.log1p(min)) / (Math.log1p(max) - Math.log1p(min));
  return outputMin + normalized * (outputMax - outputMin);
}

function scaleSqrt(value, [min, max], outputMin, outputMax) {
  if (max === min) return (outputMin + outputMax) / 2;
  const normalized = (Math.sqrt(value) - Math.sqrt(min)) / (Math.sqrt(max) - Math.sqrt(min));
  return outputMin + normalized * (outputMax - outputMin);
}

function scaleLinear(value, [min, max], outputMin, outputMax) {
  if (max === min) return (outputMin + outputMax) / 2;
  const normalized = (value - min) / (max - min);
  return outputMin + normalized * (outputMax - outputMin);
}

function formatNumber(value, digits = 3) {
  return Number(value).toFixed(digits);
}

function classifierNodeSize(classifier, center = false) {
  const size = scaleSqrt(classifierNounCount.get(classifier) || 1, classifierCountRange, 10, 24);
  return center ? Math.max(21, size + 5) : size;
}

function nounNodeSize(noun, center = false) {
  const size = scaleSqrt(nounClassifierCount.get(noun) || 1, nounCountRange, 9, 22);
  return center ? Math.max(21, size + 5) : size;
}

function classifierTooltip(classifier, contextLine = "") {
  const similarities = classifierToSimilarities.get(classifier) || [];
  const highest = similarities[0]?.similarity ?? 0;
  const lines = [
    `搭配名词数：${classifierNounCount.get(classifier).toLocaleString()}`,
    `相似量词数：${similarities.length.toLocaleString()}`,
    `最高 cosine：${formatNumber(highest)}`,
  ];
  if (contextLine) lines.push(contextLine);
  return lines.join("<br>");
}

function nounTooltip(noun, contextLine) {
  return [
    `完整数据可搭配量词数：${nounClassifierCount.get(noun).toLocaleString()}`,
    contextLine,
  ].join("<br>");
}

function buildClassifierGraph() {
  const center = state.currentClassifier;
  const allNeighbors = classifierToSimilarities.get(center) || [];
  const eligibleFullNeighbors = allNeighbors.filter(
    (row) => (fullSimilarityDegree.get(row.classifier) || 0) !== 1,
  );
  const visible = eligibleFullNeighbors.filter(
    (row) => row.similarity >= state.similarityThreshold,
  );
  const stableIndex = new Map(
    eligibleFullNeighbors.map((row, index) => [row.classifier, index]),
  );

  const nodes = [{
    id: `c:${center}`,
    label: center,
    type: "classifier",
    center: true,
    size: classifierNodeSize(center, true),
    fullCount: classifierNounCount.get(center),
    x: 0,
    y: 0,
    tooltip: classifierTooltip(center),
  }];
  const edges = [];

  for (const row of visible) {
    const similarityRatio = row.similarity / similarityMax;
    const baseAngle = -Math.PI / 2 + stableIndex.get(row.classifier) * 2.399963;
    nodes.push({
      id: `c:${row.classifier}`,
      label: row.classifier,
      type: "classifier",
      center: false,
      size: classifierNodeSize(row.classifier),
      fullCount: classifierNounCount.get(row.classifier),
      baseAngle,
      distanceFactor: 1 - Math.pow(similarityRatio, 0.34),
      tooltip: classifierTooltip(
        row.classifier,
        `与“${center}”的 cosine：${formatNumber(row.similarity)}`,
      ),
    });
    edges.push({
      id: `s:${center}|${row.classifier}`,
      source: `c:${center}`,
      target: `c:${row.classifier}`,
      width: scaleLog(row.commonNouns, commonNounRange, 1.2, 7),
      opacity: scaleLinear(row.similarity, [0, similarityMax], 0.18, 0.92),
      metric: "similarity",
      value: row.similarity,
      commonNouns: row.commonNouns,
      tooltip: `<strong>${center} ↔ ${row.classifier}</strong><br>Cosine similarity：${formatNumber(row.similarity)}<br>共同搭配名词数：${row.commonNouns.toLocaleString()}`,
    });
  }

  return {
    nodes,
    edges,
    visibleCount: visible.length,
    thresholdCount: visible.length,
  };
}

function buildClassifierNounGraph() {
  if (state.nounCenter) return buildNounCenterGraph();

  const classifier = state.currentClassifier;
  const allRelations = classifierToNouns.get(classifier) || [];
  const eligible = allRelations.filter(
    (row) => (nounClassifierCount.get(row.word) || 0) >= 2,
  );
  const thresholdMatches = eligible.filter((row) => row.score <= state.npmiThreshold);
  const filtered = thresholdMatches.slice(0, state.topN);
  const stableIndex = new Map(eligible.map((row, index) => [row.word, index]));

  const nodes = [{
    id: `c:${classifier}`,
    label: classifier,
    type: "classifier",
    center: true,
    size: classifierNodeSize(classifier, true),
    fullCount: classifierNounCount.get(classifier),
    x: 0,
    y: 0,
    tooltip: classifierTooltip(classifier),
  }];
  const edges = [];

  for (const row of filtered) {
    const baseAngle = -Math.PI / 2 + stableIndex.get(row.word) * 2.399963;
    nodes.push({
      id: `n:${row.word}`,
      label: row.word,
      type: "noun",
      center: false,
      size: nounNodeSize(row.word),
      fullCount: nounClassifierCount.get(row.word),
      baseAngle,
      distanceFactor: 1 - Math.pow(row.score / scoreMax, 0.32),
      tooltip: nounTooltip(
        row.word,
        `与“${classifier}”的 NPMI_log_co_score：${formatNumber(row.score)}`,
      ),
    });
    edges.push({
      id: `n:${classifier}|${row.word}`,
      source: `c:${classifier}`,
      target: `n:${row.word}`,
      width: scaleLog(row.score, [scoreMin, scoreMax], 1.1, 6.5),
      opacity: scaleLinear(row.score, [scoreMin, scoreMax], 0.24, 0.88),
      metric: "score",
      value: row.score,
      tooltip: `<strong>${classifier} ↔ ${row.word}</strong><br>NPMI_log_co_score：${formatNumber(row.score)}`,
    });
  }

  return {
    nodes,
    edges,
    visibleCount: filtered.length,
    thresholdCount: thresholdMatches.length,
    visibleRelations: filtered,
  };
}

function buildNounCenterGraph() {
  const noun = state.nounCenter;
  const allRelations = nounToClassifiers.get(noun) || [];
  const thresholdMatches = allRelations.filter((row) => row.score <= state.npmiThreshold);
  const filtered = thresholdMatches.slice(0, state.topN);
  const stableIndex = new Map(allRelations.map((row, index) => [row.classifier, index]));

  const nodes = [{
    id: `n:${noun}`,
    label: noun,
    type: "noun",
    center: true,
    size: nounNodeSize(noun, true),
    fullCount: nounClassifierCount.get(noun),
    x: 0,
    y: 0,
    tooltip: nounTooltip(noun, `当前阈值下可见量词数：${filtered.length}`),
  }];
  const edges = [];

  for (const row of filtered) {
    const baseAngle = -Math.PI / 2 + stableIndex.get(row.classifier) * 2.399963;
    nodes.push({
      id: `c:${row.classifier}`,
      label: row.classifier,
      type: "classifier",
      center: false,
      size: classifierNodeSize(row.classifier),
      fullCount: classifierNounCount.get(row.classifier),
      baseAngle,
      distanceFactor: 1 - Math.pow(row.score / scoreMax, 0.32),
      tooltip: classifierTooltip(
        row.classifier,
        `与“${noun}”的 NPMI_log_co_score：${formatNumber(row.score)}`,
      ),
    });
    edges.push({
      id: `n:${noun}|${row.classifier}`,
      source: `n:${noun}`,
      target: `c:${row.classifier}`,
      width: scaleLog(row.score, [scoreMin, scoreMax], 1.1, 6.5),
      opacity: scaleLinear(row.score, [scoreMin, scoreMax], 0.24, 0.88),
      metric: "score",
      value: row.score,
      tooltip: `<strong>${noun} ↔ ${row.classifier}</strong><br>NPMI_log_co_score：${formatNumber(row.score)}`,
    });
  }

  return {
    nodes,
    edges,
    visibleCount: filtered.length,
    thresholdCount: thresholdMatches.length,
    visibleRelations: filtered,
  };
}

function assignNodePositions(graph) {
  const rect = dom.graphStage.getBoundingClientRect();
  const farRadius = Math.max(130, Math.min(rect.width, rect.height) * 0.39);
  const nearRadius = Math.min(135, farRadius * 0.52);
  const neighbors = graph.nodes.filter((node) => !node.center);

  for (const node of graph.nodes) {
    if (node.center) {
      node.x = 0;
      node.y = 0;
      continue;
    }
    node.angle = node.baseAngle + state.layoutRevision * 0.47;
    node.radius = nearRadius + (farRadius - nearRadius) * node.distanceFactor;
  }

  separateNodeAngles(neighbors);
  for (const node of neighbors) {
    node.x = Math.cos(node.angle) * node.radius;
    node.y = Math.sin(node.angle) * node.radius;
  }
}

// 只调整角度来减轻节点重叠，因此 cosine 控制的中心距离保持不变。
function separateNodeAngles(nodes) {
  for (let iteration = 0; iteration < 120; iteration += 1) {
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const first = nodes[i];
        const second = nodes[j];
        const minimumDistance = first.size + second.size + 12;
        if (Math.abs(first.radius - second.radius) >= minimumDistance) continue;

        const cosineLimit = Math.max(-1, Math.min(1,
          (first.radius ** 2 + second.radius ** 2 - minimumDistance ** 2)
          / (2 * first.radius * second.radius),
        ));
        const minimumGap = Math.acos(cosineLimit);
        const signedGap = Math.atan2(
          Math.sin(second.angle - first.angle),
          Math.cos(second.angle - first.angle),
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

function renderNetwork(resetView = true) {
  const graph = state.activeTab === "classifier"
    ? buildClassifierGraph()
    : buildClassifierNounGraph();
  assignNodePositions(graph);
  state.currentGraph = graph;
  document.body.dataset.activeTab = state.activeTab;
  document.body.dataset.currentClassifier = state.currentClassifier;
  document.body.dataset.nounCenter = state.nounCenter || "";
  document.body.dataset.labelMode = state.labelMode;
  if (resetView) state.view = { x: 0, y: 0, scale: 1 };
  drawGraph(graph);
  updateGraphHeading();
  renderNetworkStats(graph);
  renderGraphLegend();
  renderInformation(graph);
}

function drawGraph(graph) {
  dom.edgeLayer.replaceChildren();
  dom.nodeLayer.replaceChildren();
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  markImportantLabels(graph);

  for (const edge of graph.edges) {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    const line = createSvg("line", {
      class: "network-edge",
      "data-edge-id": edge.id,
      "data-source": edge.source,
      "data-target": edge.target,
      "data-metric": edge.metric,
      "data-value": edge.value,
      "data-common-nouns": edge.commonNouns ?? "",
      x1: source.x,
      y1: source.y,
      x2: target.x,
      y2: target.y,
      "stroke-width": edge.width,
      "stroke-opacity": edge.opacity,
    });
    const hitLine = createSvg("line", {
      class: "network-edge-hit",
      "data-edge-id": edge.id,
      "data-source": edge.source,
      "data-target": edge.target,
      x1: source.x,
      y1: source.y,
      x2: target.x,
      y2: target.y,
      "stroke-width": Math.max(12, edge.width + 8),
    });
    bindEdgeEvents(hitLine, edge);
    dom.edgeLayer.append(line, hitLine);
  }

  for (const node of graph.nodes) {
    const group = createSvg("g", {
      class: `network-node ${node.type}${node.center ? " center" : ""}`,
      "data-node-id": node.id,
      "data-label": node.label,
      "data-node-type": node.type,
      "data-full-count": node.fullCount,
      "data-center": String(node.center),
      transform: `translate(${node.x} ${node.y})`,
      tabindex: "0",
      role: "button",
      "aria-label": `${node.label}${node.center ? "，当前中心节点" : ""}`,
    });
    const circle = createSvg("circle", {
      class: "node-circle",
      r: node.size,
    });
    const label = createSvg("text", {
      class: "node-label",
      y: node.size + 18,
    });
    label.textContent = node.label;
    group.append(circle, label);
    bindNodeEvents(group, node);
    dom.nodeLayer.append(group);
  }

  dom.graphEmpty.classList.toggle("is-hidden", graph.visibleCount !== 0);
  dom.graphEmpty.textContent = graph.visibleCount === 0
    ? "当前阈值下没有可显示的邻居。中心节点仍然保留；请调整阈值继续探索。"
    : "";
  updateLabelVisibility();
  updateViewportTransform();
}

function markImportantLabels(graph) {
  const neighbors = graph.nodes.filter((node) => !node.center);
  const importantCount = Math.min(8, neighbors.length);
  const importantIds = new Set(
    [...neighbors]
      .sort((a, b) => b.size - a.size)
      .slice(0, importantCount)
      .map((node) => node.id),
  );
  for (const node of graph.nodes) {
    node.importantLabel = node.center || importantIds.has(node.id);
  }
}

function renderNetworkStats(graph) {
  const center = state.nounCenter || state.currentClassifier;
  const stats = state.activeTab === "classifier"
    ? [
        ["当前中心", center],
        ["当前可见量词", graph.nodes.length.toLocaleString()],
        ["当前可见关系", graph.edges.length.toLocaleString()],
        ["Cosine", `≥ ${formatNumber(state.similarityThreshold)}`],
      ]
    : [
        ["当前中心", center],
        ["符合当前阈值", `${graph.thresholdCount.toLocaleString()} 个${state.nounCenter ? "量词" : "名词"}`],
        ["当前显示", `${graph.visibleCount.toLocaleString()} / Top ${state.topN}`],
        ["NPMI_log_co_score", `≤ ${formatNumber(state.npmiThreshold)}`],
      ];

  dom.networkStats.replaceChildren(...stats.map(([label, value]) => {
    const item = document.createElement("span");
    item.append(`${label}：`, Object.assign(document.createElement("strong"), { textContent: value }));
    return item;
  }));
}

function renderGraphLegend() {
  const lines = state.activeTab === "classifier"
    ? [
        "节点大小 = 完整数据中的搭配名词数（平方根缩放）",
        "边宽 = 共同搭配名词数",
        "边深浅 = Cosine similarity",
        "节点距离 = Cosine similarity（越相似越近）",
      ]
    : [
        "蓝灰节点 = 量词；赭色节点 = 名词",
        "名词节点大小 = 完整数据中的可搭配量词数（平方根缩放）",
        "边宽与深浅 = NPMI_log_co_score",
      ];
  dom.graphLegendContent.replaceChildren(...lines.map((line) => {
    const paragraph = document.createElement("p");
    paragraph.textContent = line;
    return paragraph;
  }));
}

function relayoutCurrentGraph() {
  state.layoutRevision += 1;
  assignNodePositions(state.currentGraph);
  drawGraph(state.currentGraph);
}

function resetView() {
  const rect = dom.graphStage.getBoundingClientRect();
  const center = state.currentGraph.nodes.find((node) => node.center);
  if (!center) return;

  const horizontalExtent = Math.max(
    1,
    ...state.currentGraph.nodes.map((node) => Math.abs(node.x - center.x) + node.size + 24),
  );
  const verticalExtent = Math.max(
    1,
    ...state.currentGraph.nodes.map((node) => Math.abs(node.y - center.y) + node.size + 24),
  );
  const fitScale = Math.min(
    1,
    (rect.width * 0.46) / horizontalExtent,
    (rect.height * 0.43) / verticalExtent,
  );
  state.view.scale = clamp(fitScale, 0.5, 1);
  state.view.x = -center.x * state.view.scale;
  state.view.y = -center.y * state.view.scale;
  updateViewportTransform();
}

function createSvg(tag, attributes) {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, value);
  }
  return element;
}

function bindNodeEvents(element, node) {
  element.addEventListener("pointerenter", (event) => {
    highlightNode(node.id);
    showTooltip(event, `<strong>${node.label}</strong><br>${node.tooltip}`);
  });
  element.addEventListener("pointermove", positionTooltip);
  element.addEventListener("pointerleave", () => {
    clearHighlight();
    hideTooltip();
  });
  element.addEventListener("pointerdown", (event) => startNodeDrag(event, node));
  element.addEventListener("click", () => {
    if (suppressNextNodeClick) {
      suppressNextNodeClick = false;
      return;
    }
    activateNode(node);
  });
  element.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activateNode(node);
    }
  });
}

function bindEdgeEvents(element, edge) {
  element.addEventListener("pointerenter", (event) => {
    highlightEdge(edge);
    showTooltip(event, edge.tooltip);
  });
  element.addEventListener("pointermove", positionTooltip);
  element.addEventListener("pointerleave", () => {
    clearHighlight();
    hideTooltip();
  });
}

function activateNode(node) {
  if (node.center) return;
  if (state.activeTab === "classifier") {
    selectClassifier(node.label);
    return;
  }
  if (node.type === "noun") {
    state.nounCenter = node.label;
    renderNetwork();
  } else {
    selectClassifier(node.label);
  }
}

function selectClassifier(classifier) {
  state.currentClassifier = classifier;
  state.nounCenter = null;
  dom.classifierSearch.value = classifier;
  dom.searchMessage.textContent = "";
  renderNetwork();
}

function highlightNode(nodeId) {
  const connected = new Set([nodeId]);
  for (const edge of state.currentGraph.edges) {
    if (edge.source === nodeId || edge.target === nodeId) {
      connected.add(edge.source);
      connected.add(edge.target);
    }
  }
  for (const element of dom.nodeLayer.children) {
    element.classList.toggle("is-hovered", element.dataset.nodeId === nodeId);
    element.classList.toggle("is-connected", connected.has(element.dataset.nodeId));
    element.classList.toggle("is-muted", !connected.has(element.dataset.nodeId));
  }
  for (const element of dom.edgeLayer.querySelectorAll(".network-edge")) {
    const active = element.dataset.source === nodeId || element.dataset.target === nodeId;
    element.classList.toggle("is-active", active);
    element.classList.toggle("is-muted", !active);
  }
  updateLabelVisibility(new Set([nodeId]));
}

function highlightEdge(edge) {
  const connected = new Set([edge.source, edge.target]);
  for (const element of dom.nodeLayer.children) {
    element.classList.toggle("is-connected", connected.has(element.dataset.nodeId));
    element.classList.toggle("is-muted", !connected.has(element.dataset.nodeId));
  }
  for (const element of dom.edgeLayer.querySelectorAll(".network-edge")) {
    const active = element.dataset.edgeId === edge.id;
    element.classList.toggle("is-active", active);
    element.classList.toggle("is-muted", !active);
  }
  updateLabelVisibility(connected);
}

function clearHighlight() {
  for (const element of dom.nodeLayer.children) {
    element.classList.remove("is-muted", "is-hovered", "is-connected");
  }
  for (const element of dom.edgeLayer.querySelectorAll(".network-edge")) {
    element.classList.remove("is-muted", "is-active");
  }
  updateLabelVisibility();
}

function updateLabelVisibility(temporaryIds = new Set()) {
  const nodeById = new Map(state.currentGraph.nodes.map((node) => [node.id, node]));
  for (const element of dom.nodeLayer.children) {
    const node = nodeById.get(element.dataset.nodeId);
    const visible = node.center
      || state.labelMode === "all"
      || (state.labelMode === "important" && node.importantLabel)
      || temporaryIds.has(node.id);
    element.classList.toggle("is-label-visible", visible);
  }
}

function showTooltip(event, html) {
  dom.tooltip.innerHTML = html;
  dom.tooltip.classList.remove("is-hidden");
  positionTooltip(event);
}

function positionTooltip(event) {
  const rect = dom.graphStage.getBoundingClientRect();
  const margin = 10;
  const desiredX = event.clientX - rect.left + 12;
  const desiredY = event.clientY - rect.top + 12;
  const maxX = rect.width - dom.tooltip.offsetWidth - margin;
  const maxY = rect.height - dom.tooltip.offsetHeight - margin;
  dom.tooltip.style.left = `${Math.max(margin, Math.min(desiredX, maxX))}px`;
  dom.tooltip.style.top = `${Math.max(margin, Math.min(desiredY, maxY))}px`;
}

function hideTooltip() {
  dom.tooltip.classList.add("is-hidden");
}

function startNodeDrag(event, node) {
  event.stopPropagation();
  const point = graphPoint(event);
  state.drag = {
    node,
    offsetX: point.x - node.x,
    offsetY: point.y - node.y,
    startX: event.clientX,
    startY: event.clientY,
    moved: false,
  };
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
  const point = graphPoint(event);
  const { node } = state.drag;
  node.x = point.x - state.drag.offsetX;
  node.y = point.y - state.drag.offsetY;
  state.drag.moved ||= Math.hypot(
    event.clientX - state.drag.startX,
    event.clientY - state.drag.startY,
  ) > 4;
  updateNodeElement(node);
}

function updateNodeElement(node) {
  const nodeElement = dom.nodeLayer.querySelector(`[data-node-id="${CSS.escape(node.id)}"]`);
  if (nodeElement) nodeElement.setAttribute("transform", `translate(${node.x} ${node.y})`);
  for (const edgeElement of dom.edgeLayer.children) {
    if (edgeElement.dataset.source === node.id) {
      edgeElement.setAttribute("x1", node.x);
      edgeElement.setAttribute("y1", node.y);
    }
    if (edgeElement.dataset.target === node.id) {
      edgeElement.setAttribute("x2", node.x);
      edgeElement.setAttribute("y2", node.y);
    }
  }
}

function startPan(event) {
  if (event.target.closest(".network-node")) return;
  state.pan = {
    startX: event.clientX,
    startY: event.clientY,
    viewX: state.view.x,
    viewY: state.view.y,
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
  suppressNextNodeClick = Boolean(state.drag?.moved);
  state.drag = null;
  state.pan = null;
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
    return;
  }
  dom.graphModeLabel.textContent = state.nounCenter ? "名词中心视图" : "量词—名词局部网络";
  dom.graphTitle.textContent = state.nounCenter
    ? `${state.nounCenter} 的量词搭配`
    : `${state.currentClassifier} 的名词搭配`;
}

function renderInformation(graph) {
  dom.thresholdNote.classList.add("is-hidden");
  dom.thresholdNote.textContent = "";

  if (state.activeTab === "noun" && state.nounCenter) {
    renderNounInformation(graph);
  } else {
    renderClassifierInformation(graph);
  }
}

function renderClassifierInformation(graph) {
  const classifier = state.currentClassifier;
  const allSimilar = classifierToSimilarities.get(classifier) || [];
  const representativeNouns = classifierToNouns.get(classifier) || [];
  dom.infoTitle.textContent = classifier;
  dom.primaryMetric.innerHTML = `完整数据中的搭配名词数<strong>${classifierNounCount.get(classifier).toLocaleString()}</strong>`;

  if (graph.visibleCount <= 1) {
    dom.thresholdNote.textContent = state.activeTab === "classifier"
      ? graph.visibleCount === 1
        ? "当前相似性阈值下仅有 1 个可见邻居。"
        : "当前相似性阈值下没有符合条件的邻居。"
      : graph.visibleCount === 1
        ? "当前 NPMI_log_co_score 阈值下仅有 1 个可见名词。"
        : "当前 NPMI_log_co_score 阈值下没有符合条件的名词。";
    dom.thresholdNote.classList.remove("is-hidden");
  }

  const sections = [];
  if (state.activeTab === "classifier") {
    sections.push(infoSection(
      "最相似量词 · 完整数据 Top 10",
      rankedButtons(allSimilar.slice(0, 10), "classifier", "similarity"),
    ));
  } else {
    sections.push(infoSection(
      `当前阈值下显示的名词 · Top ${state.topN}`,
      rankedLabels(graph.visibleRelations || [], "word", "score"),
    ));
  }
  sections.push(infoSection(
    "代表性名词 · 完整数据 Top 10",
    rankedLabels(representativeNouns.slice(0, 10), "word", "score"),
  ));
  dom.infoSections.replaceChildren(...sections);
}

function renderNounInformation(graph) {
  const noun = state.nounCenter;
  dom.infoTitle.textContent = noun;
  dom.primaryMetric.innerHTML = `完整数据中的搭配量词数<strong>${nounClassifierCount.get(noun).toLocaleString()}</strong>`;

  if (graph.visibleCount <= 1) {
    dom.thresholdNote.textContent = graph.visibleCount === 1
      ? "当前 NPMI_log_co_score 阈值下仅有 1 个符合条件的量词搭配。"
      : "当前 NPMI_log_co_score 阈值下没有符合条件的量词搭配。";
    dom.thresholdNote.classList.remove("is-hidden");
  }

  dom.infoSections.replaceChildren(
    infoSection(
      `当前阈值下的量词搭配 · Top ${state.topN}`,
      rankedButtons(graph.visibleRelations || [], "classifier", "score"),
    ),
  );
}

function infoSection(title, list) {
  const section = document.createElement("section");
  section.className = "info-section";
  const heading = document.createElement("h3");
  heading.textContent = title;
  section.append(heading, list);
  return section;
}

function rankedButtons(rows, labelKey, valueKey) {
  if (!rows.length) return emptyList();
  const list = document.createElement("ol");
  list.className = "ranked-list";
  rows.forEach((row, index) => {
    const item = document.createElement("li");
    const number = rankNumber(index);
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = row[labelKey];
    button.addEventListener("click", () => selectClassifier(row[labelKey]));
    const value = rankValue(row[valueKey]);
    item.append(number, button, value);
    list.append(item);
  });
  return list;
}

function rankedLabels(rows, labelKey, valueKey) {
  if (!rows.length) return emptyList();
  const list = document.createElement("ol");
  list.className = "ranked-list";
  rows.forEach((row, index) => {
    const item = document.createElement("li");
    const label = document.createElement("span");
    label.className = "rank-label";
    label.textContent = row[labelKey];
    item.append(rankNumber(index), label, rankValue(row[valueKey]));
    list.append(item);
  });
  return list;
}

function rankNumber(index) {
  const number = document.createElement("span");
  number.className = "rank-number";
  number.textContent = String(index + 1).padStart(2, "0");
  return number;
}

function rankValue(value) {
  const element = document.createElement("span");
  element.className = "rank-value";
  element.textContent = formatNumber(value);
  return element;
}

function emptyList() {
  const message = document.createElement("p");
  message.className = "empty-list";
  message.textContent = "暂无符合条件的记录。";
  return message;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function applySimilarityThreshold(value) {
  const max = Number(dom.similaritySlider.max);
  state.similarityThreshold = clamp(Number(value), 0, max);
  dom.similaritySlider.value = String(state.similarityThreshold);
  dom.similarityNumber.value = formatNumber(state.similarityThreshold);
  renderNetwork(false);
}

function applyNpmiThreshold(value) {
  const max = Number(dom.npmiSlider.max);
  state.npmiThreshold = clamp(Number(value), 0, max);
  dom.npmiSlider.value = String(state.npmiThreshold);
  dom.npmiNumber.value = formatNumber(state.npmiThreshold);
  renderNetwork(false);
}

function normalizeNumberInput(input, currentValue) {
  if (input.value.trim() === "" || !Number.isFinite(Number(input.value))) {
    input.value = formatNumber(currentValue);
  }
}

function configureControls() {
  dom.classifierCount.textContent = classifiers.length.toLocaleString();
  dom.similarityCount.textContent = similarityRelations.length.toLocaleString();
  dom.nounRelationCount.textContent = nounRelations.length.toLocaleString();
  dom.classifierSearch.value = state.currentClassifier;

  const options = document.createDocumentFragment();
  for (const classifier of classifiers) {
    const option = document.createElement("option");
    option.value = classifier;
    options.append(option);
  }
  dom.classifierOptions.append(options);

  const similarityControlMax = Math.ceil(similarityMax * 1000) / 1000;
  dom.similaritySlider.max = String(similarityControlMax);
  dom.similaritySlider.value = "0";
  dom.similarityNumber.max = String(similarityControlMax);
  dom.similarityNumber.value = "0.000";
  dom.npmiSlider.min = "0";
  const npmiControlMax = Math.ceil(scoreMax * 1000) / 1000;
  dom.npmiSlider.max = String(npmiControlMax);
  dom.npmiSlider.value = String(scoreMax);
  dom.npmiNumber.max = String(npmiControlMax);
  dom.npmiNumber.value = formatNumber(scoreMax);
}

function switchTab(tabName) {
  state.activeTab = tabName;
  state.nounCenter = null;
  for (const tab of dom.tabs) {
    const active = tab.dataset.tab === tabName;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", String(active));
  }
  const nounMode = tabName === "noun";
  dom.similarityControl.classList.toggle("is-hidden", nounMode);
  dom.npmiControl.classList.toggle("is-hidden", !nounMode);
  dom.topNControl.classList.toggle("is-hidden", !nounMode);
  dom.nounLegend.classList.toggle("is-hidden", !nounMode);
  renderNetwork();
}

function bindControls() {
  for (const tab of dom.tabs) {
    tab.addEventListener("click", () => switchTab(tab.dataset.tab));
  }

  dom.searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = dom.classifierSearch.value.trim();
    if (!classifierSet.has(value)) {
      dom.searchMessage.textContent = `未找到量词“${value || "（空）"}”。请输入列表中的完整量词。`;
      return;
    }
    selectClassifier(value);
  });

  dom.similaritySlider.addEventListener("input", () => {
    applySimilarityThreshold(dom.similaritySlider.value);
  });

  dom.similarityNumber.addEventListener("input", () => {
    if (dom.similarityNumber.value !== "") {
      applySimilarityThreshold(dom.similarityNumber.value);
    }
  });
  dom.similarityNumber.addEventListener("change", () => {
    normalizeNumberInput(dom.similarityNumber, state.similarityThreshold);
  });

  dom.npmiSlider.addEventListener("input", () => {
    applyNpmiThreshold(dom.npmiSlider.value);
  });

  dom.npmiNumber.addEventListener("input", () => {
    if (dom.npmiNumber.value !== "") {
      applyNpmiThreshold(dom.npmiNumber.value);
    }
  });
  dom.npmiNumber.addEventListener("change", () => {
    normalizeNumberInput(dom.npmiNumber, state.npmiThreshold);
  });

  for (const button of dom.topNButtons) {
    button.addEventListener("click", () => {
      state.topN = Number(button.dataset.topn);
      dom.topNButtons.forEach((item) => item.classList.toggle("is-active", item === button));
      renderNetwork(false);
    });
  }

  dom.labelMode.addEventListener("change", () => {
    state.labelMode = dom.labelMode.value;
    document.body.dataset.labelMode = state.labelMode;
    updateLabelVisibility();
  });

  dom.relayoutGraph.addEventListener("click", relayoutCurrentGraph);

  dom.resetView.addEventListener("click", resetView);

  dom.svg.addEventListener("pointerdown", startPan);
  dom.svg.addEventListener("pointermove", (event) => {
    moveDraggedNode(event);
    movePan(event);
  });
  dom.svg.addEventListener("pointerup", endPointerAction);
  dom.svg.addEventListener("pointercancel", endPointerAction);
  dom.svg.addEventListener("wheel", (event) => {
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.12 : 0.89;
    state.view.scale = Math.min(2.7, Math.max(0.5, state.view.scale * factor));
    updateViewportTransform();
  }, { passive: false });

  new ResizeObserver(updateViewportTransform).observe(dom.graphStage);
}

// 暴露只读调试快照，便于本地验收阈值和共享状态规则。
window.__NETWORK_DEBUG__ = {
  snapshot() {
    return {
      activeTab: state.activeTab,
      currentClassifier: state.currentClassifier,
      nounCenter: state.nounCenter,
      similarityThreshold: state.similarityThreshold,
      npmiThreshold: state.npmiThreshold,
      topN: state.topN,
      labelMode: state.labelMode,
      layoutRevision: state.layoutRevision,
      view: { ...state.view },
      visibleNodeCount: state.currentGraph.nodes.length,
      visibleEdgeCount: state.currentGraph.edges.length,
      thresholdCount: state.currentGraph.thresholdCount,
      visibleLabels: state.currentGraph.nodes.map((node) => node.label),
      visibleNodes: state.currentGraph.nodes.map((node) => ({
        label: node.label,
        type: node.type,
        center: node.center,
        size: node.size,
        fullCount: node.fullCount,
        x: node.x,
        y: node.y,
      })),
      visibleEdges: state.currentGraph.edges.map((edge) => ({
        source: edge.source,
        target: edge.target,
        metric: edge.metric,
        value: edge.value,
        commonNouns: edge.commonNouns,
        width: edge.width,
        opacity: edge.opacity,
      })),
    };
  },
  fullSimilarityDegree(classifier) {
    return fullSimilarityDegree.get(classifier) || 0;
  },
  nounClassifierCount(noun) {
    return nounClassifierCount.get(noun) || 0;
  },
};

configureControls();
bindControls();
renderNetwork();
