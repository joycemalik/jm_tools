/**
 * extractor.js — PDF and DOCX text extraction, runs entirely in-browser
 */

/**
 * Extract raw text from a File object (PDF or DOCX).
 * Returns { text: string, pageCount: number, filename: string }
 */
export async function extractText(file, onProgress) {
  const ext = file.name.split('.').pop().toLowerCase();

  if (ext === 'pdf') {
    return extractFromPDF(file, onProgress);
  } else if (ext === 'docx' || ext === 'doc') {
    return extractFromDOCX(file, onProgress);
  } else {
    throw new Error(`Unsupported file type: .${ext}. Please upload a PDF or Word document.`);
  }
}

async function extractFromPDF(file, onProgress) {
  onProgress?.('Cracking open the PDF…', 10);

  const arrayBuffer = await file.arrayBuffer();

  // pdf.js is loaded from CDN in index.html
  const pdfjsLib = window['pdfjs-dist/build/pdf'];
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  const pdf = await pdfjsLib.getDocument({
    data: arrayBuffer,
    standardFontDataUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/standard_fonts/',
  }).promise;
  const totalPages = pdf.numPages;

  let fullText = '';
  for (let i = 1; i <= totalPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    // Join text items, preserving line structure
    const pageText = content.items
      .map(item => item.str)
      .join(' ')
      .replace(/\s{3,}/g, '\n\n')  // collapse huge whitespace into paragraphs
      .trim();

    fullText += `\n\n--- Page ${i} ---\n\n${pageText}`;

    const pct = 10 + Math.round((i / totalPages) * 70);
    onProgress?.(`Reading page ${i} of ${totalPages}…`, pct);
  }

  return {
    text: fullText.trim(),
    pageCount: totalPages,
    filename: file.name,
  };
}

async function extractFromDOCX(file, onProgress) {
  onProgress?.('Unfolding the Word doc…', 15);
  const arrayBuffer = await file.arrayBuffer();

  // mammoth.js is loaded from CDN in index.html
  const result = await window.mammoth.extractRawText({ arrayBuffer });

  onProgress?.('Marking what matters…', 60);

  if (result.messages?.length) {
    console.warn('Mammoth warnings:', result.messages);
  }

  return {
    text: result.value,
    pageCount: null,
    filename: file.name,
  };
}

/**
 * Smart chunking: if text is very long (>12000 chars), trim intelligently.
 * Keeps intro + headings + evenly-spaced samples to stay within token limits.
 */
export function prepareTextForAI(rawText, maxChars = 40000) {
  if (rawText.length <= maxChars) return rawText;

  // Try to identify section headings and keep them all
  const lines = rawText.split('\n');
  const headings = lines.filter(l => {
    const t = l.trim();
    return t.length > 3 && t.length < 100 &&
      (/^(UNIT|Chapter|Section|\d+\.|\d+\s)/i.test(t) ||
       t === t.toUpperCase() && t.length > 5);
  });

  // Take first 4000 chars + headings + evenly sampled middle + last 2000
  const first = rawText.slice(0, 4000);
  const last  = rawText.slice(-2000);
  const mid   = rawText.slice(4000, -2000);
  const step  = Math.floor(mid.length / 10);
  const samples = Array.from({ length: 10 }, (_, i) =>
    mid.slice(i * step, i * step + 300)
  ).join('\n…\n');

  const headingsText = headings.length
    ? `\n\n=== DETECTED SECTIONS ===\n${headings.slice(0, 40).join('\n')}\n`
    : '';

  return `${first}${headingsText}\n\n…[content sampled for length]…\n\n${samples}\n\n${last}`;
}
