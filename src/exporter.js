/**
 * exporter.js — Export the mind map SVG as PNG or downloadable SVG
 */

/**
 * Download the current SVG element as an SVG file.
 */
export function exportSVG(svgEl, filename = 'mindmap') {
  const clone = svgEl.cloneNode(true);

  // Inject fonts and base styles so the SVG is self-contained
  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
  style.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap');
    text { font-family: Inter, system-ui, sans-serif; }
  `;
  clone.insertBefore(style, clone.firstChild);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

  // Add a dark background
  const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  bg.setAttribute('width', '100%');
  bg.setAttribute('height', '100%');
  bg.setAttribute('fill', '#060b14');
  clone.insertBefore(bg, clone.firstChild);

  const svgData = new XMLSerializer().serializeToString(clone);
  const blob = new Blob([svgData], { type: 'image/svg+xml' });
  downloadBlob(blob, `${filename}.svg`);
}

/**
 * Export the current SVG as a high-resolution PNG.
 * Uses canvas to rasterize at 2x DPR.
 */
export function exportPNG(svgEl, filename = 'mindmap') {
  const { width, height } = svgEl.getBoundingClientRect();
  const dpr = 2; // 2x for crisp exports
  const W = width * dpr;
  const H = height * dpr;

  const clone = svgEl.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', W);
  clone.setAttribute('height', H);

  // Background
  const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  bg.setAttribute('width', '100%');
  bg.setAttribute('height', '100%');
  bg.setAttribute('fill', '#060b14');
  clone.insertBefore(bg, clone.firstChild);

  const svgData = new XMLSerializer().serializeToString(clone);
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgData)}`;

  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width  = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#060b14';
    ctx.fillRect(0, 0, W, H);
    ctx.drawImage(img, 0, 0);
    canvas.toBlob(blob => downloadBlob(blob, `${filename}.png`), 'image/png');
  };
  img.onerror = () => {
    alert('PNG export failed. Try SVG export instead.');
  };
  img.src = url;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
