/**
 * mindmap.js — D3.js interactive mind map renderer
 * Supports both radial tree and force-directed layouts
 */

import * as d3 from 'd3';

/* ── Module state ── */
let svg, g, zoom;
let currentLayout = 'radial';   // 'radial' | 'force'
let currentData   = null;
let simulation    = null;
let collapsedIds  = new Set();
let onNodeClick   = null;

/** Initialize the SVG canvas with zoom/pan */
export function initCanvas(svgEl, layoutPreference, nodeClickCallback) {
  currentLayout = layoutPreference || 'radial';
  onNodeClick   = nodeClickCallback;

  svg = d3.select(svgEl);
  svg.selectAll('*').remove();

  const defs = svg.append('defs');

  // Roughen filter — makes circles look hand-drawn
  const roughen = defs.append('filter')
    .attr('id', 'roughen')
    .attr('x', '-8%').attr('y', '-8%')
    .attr('width', '116%').attr('height', '116%');
  roughen.append('feTurbulence')
    .attr('type', 'fractalNoise')
    .attr('baseFrequency', '0.045')
    .attr('numOctaves', '4')
    .attr('seed', '3')
    .attr('result', 'noise');
  roughen.append('feDisplacementMap')
    .attr('in', 'SourceGraphic').attr('in2', 'noise')
    .attr('scale', '2.8')
    .attr('xChannelSelector', 'R').attr('yChannelSelector', 'G');

  // Zoom behaviour
  zoom = d3.zoom()
    .scaleExtent([0.1, 4])
    .on('zoom', e => g.attr('transform', e.transform));
  svg.call(zoom);

  g = svg.append('g').attr('class', 'main-group');
}

/** Render a new tree from mind map data */
export function renderMap(mapData, layout) {
  if (layout) currentLayout = layout;
  currentData = mapData;
  collapsedIds.clear();

  if (currentLayout === 'force') {
    renderForce(mapData.root);
  } else {
    renderRadial(mapData.root);
  }
}

/** Toggle between layouts */
export function toggleLayout() {
  currentLayout = currentLayout === 'radial' ? 'force' : 'radial';
  if (currentData) renderMap(currentData);
  return currentLayout;
}

export function getCurrentLayout() { return currentLayout; }

/** Zoom controls */
export function zoomIn()    { svg.transition().call(zoom.scaleBy, 1.35); }
export function zoomOut()   { svg.transition().call(zoom.scaleBy, 0.75); }
export function resetZoom() {
  const { width, height } = svg.node().getBoundingClientRect();
  svg.transition().duration(600).call(
    zoom.transform,
    d3.zoomIdentity.translate(width / 2, height / 2).scale(0.85)
  );
}

/* ══════════════ Sketch colour palette ══════════════ */
const SKETCH = [
  { stroke: '#c17f3c', fill: 0.12 },  // 0 root   — amber accent
  { stroke: '#dfd5c0', fill: 0.07 },  // 1 primary — cream ink
  { stroke: '#a09278', fill: 0.05 },  // 2 secondary — warm taupe
  { stroke: '#6b5d4f', fill: 0.04 },  // 3 tertiary — muted brown
  { stroke: '#3e3629', fill: 0.03 },  // 4+ deep   — very dim
];
const sk = depth => SKETCH[Math.min(depth, SKETCH.length - 1)];

/* ══════════════ RADIAL TREE ══════════════ */
function renderRadial(root) {
  if (simulation) { simulation.stop(); simulation = null; }
  g.selectAll('*').remove();

  const { width, height } = svg.node().getBoundingClientRect();
  const radius = Math.min(width, height) * 0.44;

  // Flatten to hierarchy
  const hier = d3.hierarchy(root, d => d.children);
  const treeLayout = d3.tree()
    .size([2 * Math.PI, radius])
    .separation((a, b) => (a.parent === b.parent ? 1 : 2) / a.depth);

  const treeData = treeLayout(hier);

  // Links
  g.append('g').attr('class', 'links')
    .selectAll('path')
    .data(treeData.links())
    .join('path')
      .attr('class', 'link-line')
      .attr('d', d3.linkRadial().angle(d => d.x).radius(d => d.y))
      .attr('stroke', d => sk(d.target.depth).stroke)
      .attr('stroke-width', d => Math.max(0.8, 2 - d.target.depth * 0.4))
      .attr('stroke-opacity', d => 0.35 - d.target.depth * 0.04)
      .attr('stroke-dasharray', d => d.target.depth > 1 ? '4 3' : null)
      .style('opacity', 0)
      .transition().duration(700).delay((_, i) => i * 14)
      .style('opacity', 1);

  // Nodes
  const node = g.append('g').attr('class', 'nodes')
    .selectAll('g')
    .data(treeData.descendants())
    .join('g')
      .attr('class', 'node-g')
      .attr('transform', d => {
        const [x, y] = radialPoint(d.x, d.y);
        return `translate(${x},${y})`;
      })
      .style('opacity', 0)
      .call(d3.drag().on('start', dragStarted).on('drag', dragged).on('end', dragEnded));

  node.transition().duration(600).delay((_, i) => i * 20).style('opacity', 1);

  // Node circles
  node.each(function (d) { appendNodeCircle(d3.select(this), d); });

  // Center on mount
  svg.call(zoom.transform,
    d3.zoomIdentity.translate(width / 2, height / 2).scale(0.85)
  );
}

/* ══════════════ FORCE-DIRECTED ══════════════ */
function renderForce(root) {
  g.selectAll('*').remove();
  if (simulation) simulation.stop();

  const { width, height } = svg.node().getBoundingClientRect();
  const nodes = [];
  const links = [];

  function flatten(node, depth = 0, parentId = null) {
    nodes.push({ ...node, depth, id: node.id, _children: node.children });
    if (parentId !== null) links.push({ source: parentId, target: node.id });
    (node.children || []).forEach(c => flatten(c, depth + 1, node.id));
  }
  flatten(root);

  const linkSel = g.append('g').attr('class', 'links')
    .selectAll('line')
    .data(links)
    .join('line')
      .attr('class', 'link-line')
      .attr('stroke', d => {
        const t = nodes.find(n => n.id === (d.target?.id || d.target));
        return sk(t?.depth || 1).stroke;
      })
      .attr('stroke-width', d => {
        const t = nodes.find(n => n.id === (d.target?.id || d.target));
        return Math.max(0.8, 2 - (t?.depth || 1) * 0.4);
      })
      .attr('stroke-opacity', 0.35)
      .attr('stroke-dasharray', d => {
        const t = nodes.find(n => n.id === (d.target?.id || d.target));
        return (t?.depth || 0) > 1 ? '4 3' : null;
      });

  const nodeG = g.append('g').attr('class', 'nodes')
    .selectAll('g')
    .data(nodes)
    .join('g')
      .attr('class', 'node-g')
      .call(d3.drag()
        .on('start', (e, d) => {
          if (!e.active) simulation.alphaTarget(0.3).restart();
          d.fx = d.x; d.fy = d.y;
        })
        .on('drag', (e, d) => { d.fx = e.x; d.fy = e.y; })
        .on('end', (e, d) => {
          if (!e.active) simulation.alphaTarget(0);
          d.fx = null; d.fy = null;
        })
      );

  nodeG.each(function(d) { appendNodeCircle(d3.select(this), d); });

  simulation = d3.forceSimulation(nodes)
    .force('link', d3.forceLink(links).id(d => d.id)
      .distance(d => {
        const t = nodes.find(n => n.id === (d.target?.id || d.target));
        return 80 + (t?.depth || 0) * 30;
      })
      .strength(0.6))
    .force('charge', d3.forceManyBody().strength(d => d.depth === 0 ? -600 : -200))
    .force('center', d3.forceCenter(0, 0))
    .force('collision', d3.forceCollide(d => nodeRadius(d) + 12))
    .on('tick', () => {
      linkSel
        .attr('x1', d => d.source.x).attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
      nodeG.attr('transform', d => `translate(${d.x},${d.y})`);
    });

  svg.call(zoom.transform,
    d3.zoomIdentity.translate(width / 2, height / 2).scale(0.75)
  );
}

/* ══════════════ NODE RENDERING (sketch) ══════════════ */
function nodeRadius(d) {
  const depths = [36, 24, 17, 12, 9];
  return depths[Math.min(d.depth, depths.length - 1)];
}

function appendNodeCircle(sel, d) {
  const r     = nodeRadius(d);
  const depth = d.depth ?? d._depth ?? 0;
  const color = sk(depth).stroke;
  const fillO = sk(depth).fill;
  const label = d.data?.label || d.label || '';
  const icon  = d.data?.icon  || d.icon  || '';

  // Outer dotted ring (sketch double-line effect)
  sel.append('circle')
    .attr('r', r + 3.5)
    .attr('fill', 'none')
    .attr('stroke', color)
    .attr('stroke-width', 0.75)
    .attr('stroke-opacity', 0.2)
    .attr('stroke-dasharray', depth === 0 ? null : '3 4');

  // Main circle — very low fill, emphasis on stroke
  sel.append('circle')
    .attr('r', r)
    .attr('fill', color)
    .attr('fill-opacity', fillO)
    .attr('stroke', color)
    .attr('stroke-width', depth === 0 ? 2 : depth === 1 ? 1.5 : 1.2)
    .attr('class', 'node-circle')
    .attr('filter', depth <= 1 ? 'url(#roughen)' : null)  // rough edges
    .on('mouseenter', function () {
      d3.select(this).transition().duration(140)
        .attr('fill-opacity', fillO * 2.5)
        .attr('r', r * 1.1);
    })
    .on('mouseleave', function () {
      d3.select(this).transition().duration(140)
        .attr('fill-opacity', fillO)
        .attr('r', r);
    })
    .on('click', function (event) {
      event.stopPropagation();
      onNodeClick?.(d.data || d);
    });

  // Icon (root + L1 only)
  if (icon && depth <= 1) {
    sel.append('text')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('font-size', depth === 0 ? '15px' : '10px')
      .attr('fill', '#fff')
      .attr('pointer-events', 'none')
      .attr('dy', depth === 0 ? '-5px' : '0')
      .text(icon);
  }

  // Label — Caveat font, placed outside circle
  if (label) {
    const fontSize = depth === 0 ? 14 : depth === 1 ? 12 : depth === 2 ? 10 : 9;
    const words    = label.split(' ');
    const maxW     = r * 4;
    const lines    = [];
    let cur = '';
    words.forEach(w => {
      const test = cur ? cur + ' ' + w : w;
      if (test.length * (fontSize * 0.58) > maxW && cur) {
        lines.push(cur); cur = w;
      } else { cur = test; }
    });
    if (cur) lines.push(cur);

    const lineH  = fontSize + 2;
    const yStart = depth > 2 ? 0 : r + 9;
    const anchor = depth > 2 ? 'middle' : 'middle';
    const domB   = depth > 2 ? 'central' : 'auto';

    lines.slice(0, 3).forEach((line, li) => {
      sel.append('text')
        .attr('text-anchor', anchor)
        .attr('dominant-baseline', li === 0 ? domB : 'auto')
        .attr('font-family', '"Caveat", cursive')
        .attr('font-size', `${fontSize}px`)
        .attr('font-weight', depth === 0 ? '700' : depth === 1 ? '600' : '400')
        .attr('fill', color)
        .attr('fill-opacity', depth === 0 ? 1 : 0.85)
        .attr('y', yStart + li * lineH)
        .attr('pointer-events', 'none')
        .attr('class', 'node-label')
        .text(line);
    });
  }
}

/* ── Drag helpers (radial tree) ── */
function dragStarted(e, d) {
  d3.select(this).raise();
}
function dragged(e, d) {
  d3.select(this).attr('transform', `translate(${e.x},${e.y})`);
}
function dragEnded() {}

/* ── Helpers ── */
function radialPoint(angle, radius) {
  return [radius * Math.sin(angle), -radius * Math.cos(angle)];
}

/* ══════════════ DEMO RENDERERS ══════════════ */
const DEMO_DATA = {
  id: 'root', label: 'IoT', icon: '🌐', color: '#4f8ef7', depth: 0, children: [
    { id: 'a', label: 'Devices', icon: '📡', color: '#2ccfb0', depth: 1,
      children: [{ id: 'a1', label: 'Sensors', icon: '🔬', color: '#7ed957', depth: 2, children: [] },
                 { id: 'a2', label: 'Actuators', icon: '⚙', color: '#f5a623', depth: 2, children: [] }] },
    { id: 'b', label: 'Protocols', icon: '📶', color: '#7b5ef8', depth: 1,
      children: [{ id: 'b1', label: 'MQTT', icon: '📨', color: '#2ccfb0', depth: 2, children: [] },
                 { id: 'b2', label: 'HTTP', icon: '🌍', color: '#f75f7a', depth: 2, children: [] }] },
    { id: 'c', label: 'Cloud', icon: '☁️', color: '#f5a623', depth: 1, children: [] },
    { id: 'd', label: 'Apps', icon: '📱', color: '#7ed957', depth: 1, children: [] },
  ]
};

export function renderDemoRadial(containerEl) {
  const s = d3.select(containerEl).append('svg')
    .attr('width', '100%').attr('height', '100%');

  const w = 260, h = 160;
  const cg = s.append('g').attr('transform', `translate(${w/2},${h/2})`);

  const hier = d3.hierarchy(DEMO_DATA, d => d.children);
  const tree = d3.tree().size([2 * Math.PI, 58])
    .separation((a, b) => (a.parent === b.parent ? 1 : 2) / a.depth);
  const td = tree(hier);

  cg.append('g').selectAll('path').data(td.links()).join('path')
    .attr('d', d3.linkRadial().angle(d => d.x).radius(d => d.y))
    .attr('fill', 'none')
    .attr('stroke', d => sk(d.target.depth).stroke)
    .attr('stroke-width', 1.1)
    .attr('stroke-opacity', 0.4)
    .attr('stroke-dasharray', d => d.target.depth > 1 ? '3 3' : null);

  const ng = cg.append('g').selectAll('g').data(td.descendants()).join('g')
    .attr('transform', d => { const [x,y] = radialPoint(d.x, d.y); return `translate(${x},${y})`; });

  ng.append('circle')
    .attr('r', d => [11, 7, 4][Math.min(d.depth, 2)])
    .attr('fill', d => sk(d.depth).stroke)
    .attr('fill-opacity', d => sk(d.depth).fill * 1.5)
    .attr('stroke', d => sk(d.depth).stroke)
    .attr('stroke-width', 1.2);

  ng.append('text')
    .attr('font-family', '"Caveat", cursive')
    .attr('font-size', '8px')
    .attr('text-anchor', 'middle')
    .attr('dy', d => d.depth === 0 ? '0.35em' : '-11px')
    .attr('fill', d => sk(d.depth).stroke)
    .text(d => d.depth <= 1 ? d.data.label : '');
}

export function renderDemoForce(containerEl) {
  const s = d3.select(containerEl).append('svg')
    .attr('width', '100%').attr('height', '100%');

  const w = 260, h = 160;
  const cg = s.append('g').attr('transform', `translate(${w/2},${h/2})`);

  const nodes = [];
  const links = [];
  function flat(n, d = 0, pid = null) {
    nodes.push({ ...n, depth: d });
    if (pid !== null) links.push({ source: pid, target: n.id });
    (n.children||[]).forEach(c => flat(c, d+1, n.id));
  }
  flat(DEMO_DATA);

  const ls = cg.append('g').selectAll('line').data(links).join('line')
    .attr('stroke', d => { const t = nodes.find(n=>n.id===d.target); return sk(t?.depth||1).stroke; })
    .attr('stroke-width', 1.1)
    .attr('stroke-opacity', 0.4)
    .attr('stroke-dasharray', d => { const t = nodes.find(n=>n.id===d.target); return (t?.depth||0) > 1 ? '3 3' : null; });

  const ng = cg.append('g').selectAll('g').data(nodes).join('g');
  ng.append('circle')
    .attr('r', d => [11, 7, 4][Math.min(d.depth, 2)])
    .attr('fill', d => sk(d.depth).stroke)
    .attr('fill-opacity', d => sk(d.depth).fill * 1.5)
    .attr('stroke', d => sk(d.depth).stroke)
    .attr('stroke-width', 1.2);
  ng.append('text')
    .attr('font-family', '"Caveat", cursive')
    .attr('font-size', '8px')
    .attr('text-anchor', 'middle')
    .attr('dy', d => d.depth === 0 ? '0.35em' : '-11px')
    .attr('fill', d => sk(d.depth).stroke)
    .text(d => d.depth <= 1 ? d.label : '');

  const sim = d3.forceSimulation(nodes)
    .force('link', d3.forceLink(links).id(d=>d.id).distance(38).strength(0.7))
    .force('charge', d3.forceManyBody().strength(d => d.depth===0 ? -180 : -55))
    .force('center', d3.forceCenter(0,0))
    .force('collision', d3.forceCollide(13))
    .on('tick', () => {
      ls.attr('x1',d=>d.source.x).attr('y1',d=>d.source.y)
        .attr('x2',d=>d.target.x).attr('y2',d=>d.target.y);
      ng.attr('transform', d => `translate(${d.x},${d.y})`);
    });

  setTimeout(() => sim.stop(), 4000);
}
