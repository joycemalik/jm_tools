/**
 * ai.js — OpenRouter API with bulletproof JSON parsing
 */

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

async function callOpenRouter(apiKey, model, messages, signal) {
  const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: 'POST',
    signal,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': window.location.origin,
      'X-Title': 'MindForge',
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.2,
      max_tokens: 5000,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `OpenRouter error ${res.status}`);
  }

  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content;
  if (!raw) throw new Error('No content returned from AI');
  return raw;
}

/* ══════════════════════════════════════════
   ROBUST JSON PARSING  — 5 strategies
══════════════════════════════════════════ */

/** Phase 1: clean common AI output quirks */
function cleanRaw(raw) {
  let s = raw.trim();
  // Strip markdown fences
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
  // Remove JS-style comments
  s = s.replace(/\/\/[^\n\r]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  // Fix trailing commas before ] or } — multiple passes for nesting
  for (let i = 0; i < 10; i++) {
    const prev = s;
    s = s.replace(/,(\s*[}\]])/g, '$1');
    if (s === prev) break;
  }
  return s.trim();
}

/**
 * Phase 2: Repair a truncated / cut-off JSON string.
 * Tracks open brackets and closes them in reverse order.
 * Trims any dangling incomplete value before closing.
 */
function repairJSON(str) {
  const closers = [];
  let inStr  = false;
  let esc    = false;
  let lastSafe = 0;   // index after last fully-closed value

  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (esc)               { esc = false; continue; }
    if (c === '\\' && inStr) { esc = true;  continue; }
    if (c === '"')         { inStr = !inStr; if (!inStr) lastSafe = i + 1; continue; }
    if (inStr)             continue;

    if      (c === '{') { closers.push('}'); }
    else if (c === '[') { closers.push(']'); }
    else if (c === '}' || c === ']') { closers.pop(); lastSafe = i + 1; }
  }

  // If truncated mid-string, rewind to last safe position
  let result = inStr ? str.slice(0, lastSafe) : str;

  // Remove any trailing comma or incomplete primitive before closing
  result = result.trimEnd().replace(/,\s*$/, '').replace(/:\s*$/, ': null');

  // Close all open containers, innermost first (reverse of opening order)
  return result + [...closers].reverse().join('');
}

/**
 * Master parser — tries 5 strategies before giving up.
 */
function parseJSON(raw) {
  const s = cleanRaw(raw);

  // Strategy 1: direct parse after cleaning
  try { return JSON.parse(s); } catch {}

  // Strategy 2: find first '{' and parse from there
  const objIdx = s.indexOf('{');
  if (objIdx >= 0) {
    const fromObj = s.slice(objIdx);

    // Strategy 3: parse extracted object
    try { return JSON.parse(fromObj); } catch {}

    // Strategy 4: repair truncated object then parse
    const repaired = repairJSON(fromObj);
    try {
      const result = JSON.parse(repaired);
      console.warn('MindForge: used JSON repair (truncated response)');
      return result;
    } catch (e) {
      console.warn('Repair failed:', e.message, '\nTail:', repaired.slice(-150));
    }

    // Strategy 5: aggressive — find the deepest valid object we can extract
    try {
      const lastClose = repaired.lastIndexOf('}');
      if (lastClose > 10) {
        const truncated = repaired.slice(0, lastClose + 1);
        return JSON.parse(truncated);
      }
    } catch {}
  }

  throw new Error(
    `The AI returned malformed JSON (possibly hit token limit mid-response).\n` +
    `Try: switch model in Settings ⚙ — Gemma 2 9B or Llama 3.1 8B tend to be more reliable.`
  );
}

/* ══════════════════════════════════════════
   SYSTEM PROMPT  — compact + strict JSON
══════════════════════════════════════════ */
const SYSTEM_PROMPT = `You are a knowledge architect. Analyze the document and output ONLY a valid JSON mind map.

STRICT RULES:
- Output raw JSON only. Zero markdown. Zero explanations. Zero code fences.
- Keep total output under 3500 tokens to avoid truncation.
- Node labels: max 4 words. Excerpts: 1 sentence only.
- No trailing commas. No comments. Valid JSON only.

OUTPUT SCHEMA (follow exactly):
{
  "documentTitle": "string",
  "centralTheme": "3-5 word summary",
  "maps": [
    {
      "id": "master",
      "title": "Master Overview",
      "description": "one sentence",
      "root": {
        "id": "root",
        "label": "short label",
        "icon": "emoji",
        "color": "#c17f3c",
        "excerpt": "one sentence",
        "children": [
          {
            "id": "unique_snake_case",
            "label": "short label",
            "icon": "emoji",
            "color": "#dfd5c0",
            "excerpt": "one sentence",
            "children": [
              { "id": "child_id", "label": "label", "icon": "emoji", "color": "#a09278", "excerpt": "one sentence", "children": [] }
            ]
          }
        ]
      },
      "crossLinks": [
        { "from": "id1", "to": "id2", "label": "verb" }
      ]
    }
  ]
}

MAP STRATEGY:
- Always produce a "master" map (id="master") with 4-7 top-level branches. Each branch can have 2-4 children.
- If document has clear sections/units, add one map per section (id="unit_1" etc.), same structure.
- crossLinks: 2-3 real connections between branches (not parent-child).
- Colors: use only #c17f3c #dfd5c0 #a09278 #8a7b6b #6b5d4f — no others.
- STOP before hitting token limit. A complete smaller map is better than a truncated big one.`;

/* ══════════════════════════════════════════
   PUBLIC API
══════════════════════════════════════════ */
export async function generateMindMap(text, apiKey, model, onProgress, signal) {
  onProgress?.('Nemotron is thinking this through…', 85);

  const raw = await callOpenRouter(apiKey, model, [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user',   content: `Document text:\n\n${text}` },
  ], signal);

  onProgress?.('Almost done — piecing it all together…', 95);

  let parsed;
  try {
    parsed = parseJSON(raw);
  } catch (err) {
    // Log raw response for debugging
    console.error('JSON parse failed. Raw response (first 800 chars):\n', raw?.slice(0, 800));
    throw err;
  }

  // Validate and normalise
  if (!parsed?.maps || !Array.isArray(parsed.maps) || parsed.maps.length === 0) {
    throw new Error('AI returned an unexpected structure. Try a different model in Settings ⚙');
  }

  // Fill in any missing required fields gracefully
  parsed.maps = parsed.maps.map((m, i) => ({
    id:          m.id    || `map_${i}`,
    title:       m.title || `Map ${i + 1}`,
    description: m.description || '',
    root:        m.root  || {
      id: 'root', label: parsed.documentTitle || 'Document',
      icon: '📄', color: '#c17f3c', excerpt: '', children: [],
    },
    crossLinks: Array.isArray(m.crossLinks) ? m.crossLinks : [],
  }));

  return parsed;
}
