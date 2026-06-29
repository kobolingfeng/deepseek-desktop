// Built-in document "skills" — the lightweight equivalent of OfficeCLI's skill packs.
// A skill is just domain knowledge (how to structure the artifact) plus which tool to use;
// invoked as a slash command (`/pitch-deck <topic>`), its `hint` is injected into that turn's
// system prompt so the model produces a professional result with our own tools. No external CLI.

export interface BuiltinSkill {
  id: string;
  name: { en: string; zh: string };
  desc: { en: string; zh: string };
  /** lucide-react icon name. */
  icon: string;
  /** Domain-knowledge guidance injected into the system prompt for this turn. */
  hint: string;
}

export const BUILTIN_SKILLS: BuiltinSkill[] = [
  {
    id: 'pitch-deck',
    name: { en: 'Pitch Deck', zh: '融资路演' },
    desc: { en: 'Fundraising pitch deck (.pptx)', zh: '融资路演 PPT' },
    icon: 'Rocket',
    hint: `You are creating a fundraising PITCH DECK. Use the write_pptx tool to produce a .pptx.
Structure it as ~10-12 slides, one idea per slide: 1) Title (company + one-line value prop), 2) Problem, 3) Solution, 4) Product / how it works, 5) Market size (TAM/SAM/SOM), 6) Business model, 7) Traction / metrics, 8) Competition, 9) Go-to-market, 10) Team, 11) The Ask (amount raising + use of funds). Each slide = a punchy title + 3-5 short bullet points, never paragraphs. Lead with the strongest narrative hook. After writing, briefly summarize the deck.`,
  },
  {
    id: 'morph-ppt',
    name: { en: 'Morph Animation PPT', zh: 'Morph 动画 PPT' },
    desc: { en: 'Cinematic morph-animated deck', zh: '电影级 Morph 动画演示' },
    icon: 'Clapperboard',
    hint: `You are creating a MORPH-ANIMATED PowerPoint. Use the write_morph_pptx tool. Each "frame" is a slide of positioned text items; an item that keeps the SAME name on consecutive frames smoothly MORPHS (moves / resizes / recolors) when the slide advances. Use it for cinematic reveals: a title that starts centered then shrinks into a corner; a colored box that travels across and grows; a big number re-typed across frames so it appears to count up. Give each persistent element a stable name and vary its x/y/w/h/fontSize/fill/color between frames. Coordinates are inches on a 13.33×7.5 widescreen slide. 4-8 frames is plenty. After writing, describe the animation you built.`,
  },
  {
    id: 'financial-model',
    name: { en: 'Financial Model', zh: '财务模型' },
    desc: { en: '3-statement / DCF Excel model', zh: '三大报表 / DCF 财务模型' },
    icon: 'TrendingUp',
    hint: `You are building a FINANCIAL MODEL in Excel via the write_excel tool. Use real FORMULAS (cell strings starting with "=") so the model recalculates — NEVER hard-code a computed number. Best practice: an "Assumptions" sheet (growth rates, margins, headcount, WACC…) that every other sheet references with absolute refs (e.g. "=B5*(1+Assumptions!$B$2)"). For a 3-statement model build Income Statement (revenue → COGS → gross profit → opex → EBIT → taxes → net income), Balance Sheet, and Cash Flow, with each period in its own column and formulas referencing prior periods + assumptions; add totals with SUM(). For a DCF: project free cash flow, discount each year with "=FCF/(1+WACC)^n", and sum to an NPV cell. Label every row in column A. After writing, explain the key assumptions and the headline outputs.`,
  },
  {
    id: 'dashboard',
    name: { en: 'Data Dashboard', zh: '数据仪表盘' },
    desc: { en: 'Interactive KPI dashboard (web)', zh: 'KPI 数据仪表盘(网页)' },
    icon: 'BarChart3',
    hint: `You are building a DATA DASHBOARD. Prefer an interactive WEB dashboard: write one self-contained index.html that loads Chart.js from a CDN and renders KPI cards plus charts (bar / line / pie / doughnut) driven by the user's data. Layout: a row of big KPI numbers at the top, then 2-4 charts in a responsive grid, clean modern styling (cards, soft shadows, a coherent palette). Then start a local server (start_process running "npx --yes serve . -l 5173" or "python -m http.server 5173") and report the http://localhost URL so it opens in the preview pane. If the user explicitly wants an EXCEL dashboard instead, use write_excel with a summary sheet of KPI cells as formulas referencing the data sheet (note: native Excel charts aren't generated on that path).`,
  },
  {
    id: 'deck-3d',
    name: { en: '3D Presentation', zh: '3D 演示' },
    desc: { en: '3D / cinematic web presentation', zh: '3D / 电影级网页演示' },
    icon: 'Box',
    hint: `You are building a 3D / cinematic PRESENTATION as an interactive WEB page (lighter and better-looking than embedding 3D in PowerPoint). Write a self-contained index.html using Three.js from a CDN (e.g. unpkg three, plus GLTFLoader and OrbitControls as needed). Build "slides" as camera positions/moves over animated 3D content; advance on scroll or arrow keys with smooth tweening. If a GLB/GLTF model URL is provided, load it with GLTFLoader; otherwise compose primitive meshes with good lighting and materials. Then start a local server (start_process) and report the http://localhost URL so it opens in the preview pane. One clear focal idea per camera position.`,
  },
  {
    id: 'report',
    name: { en: 'Professional Report', zh: '专业报告' },
    desc: { en: 'Structured Word report (.docx)', zh: '结构化 Word 报告' },
    icon: 'FileText',
    hint: `You are writing a professional REPORT as a Word .docx via the write_word tool (blocks format: heading / paragraph / bullets). Structure: a title (heading level 1), an Executive Summary, then logical sections (heading level 2) with concise, specific paragraphs and bullet lists where they aid scanning. Avoid filler; be well-organized and concrete. End with Conclusions / Next steps.`,
  },
  {
    id: 'paper',
    name: { en: 'Academic Paper', zh: '学术论文' },
    desc: { en: 'Journal/thesis-style paper (.docx)', zh: '期刊/论文格式文档' },
    icon: 'GraduationCap',
    hint: `You are writing an ACADEMIC PAPER as a Word .docx via the write_word tool (blocks format). Structure: Title, Abstract, 1. Introduction, 2. Related Work, 3. Method, 4. Experiments / Results, 5. Discussion, 6. Conclusion, and References. Use heading blocks for section titles and paragraph blocks for prose; keep a precise, academic tone. Describe where figures/tables belong in the text, and list references at the end.`,
  },
];

/** A user-defined skill the agent created (plain strings; persisted in localStorage). */
export interface UserSkill {
  id: string;
  name: string;
  desc: string;
  icon?: string;
  hint: string;
}

const USER_SKILLS_KEY = 'deepseek.userSkills';
export function loadUserSkills(): UserSkill[] {
  try {
    const raw = localStorage.getItem(USER_SKILLS_KEY);
    const a = raw ? JSON.parse(raw) : [];
    return Array.isArray(a) ? a.filter((s) => s && typeof s.id === 'string' && typeof s.hint === 'string') : [];
  } catch {
    return [];
  }
}
export function saveUserSkills(list: UserSkill[]): void {
  try {
    localStorage.setItem(USER_SKILLS_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

export function findSkill(id: string): BuiltinSkill | undefined {
  return BUILTIN_SKILLS.find((s) => s.id === id);
}

/** The hint for a skill id — built-ins first, then the user's custom skills. */
export function skillHintById(id: string, userSkills: UserSkill[] = []): string | undefined {
  return findSkill(id)?.hint ?? userSkills.find((s) => s.id === id)?.hint;
}

/** Parse a leading "/skill-id rest" command. Returns the skill id + its hint + remaining text. */
export function parseSkillCommand(
  text: string,
  userSkills: UserSkill[] = [],
): { id: string; hint: string; rest: string } | null {
  const m = /^\/([a-z0-9-]+)\s+([\s\S]+)$/.exec(text.trim());
  if (!m) return null;
  const hint = skillHintById(m[1], userSkills);
  return hint ? { id: m[1], hint, rest: m[2].trim() } : null;
}
