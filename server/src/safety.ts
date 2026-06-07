// CMP-12 (input-safety slice). A cheap, high-precision pre-generation check that
// refuses clearly-harmful build requests BEFORE we spend any model tokens
// (REQ-GEN-007). This is intentionally conservative: it matches harmful *intent*
// (a verb + a harmful object), not bare keywords, so ordinary tools like a
// "password generator" or "expense tracker" are never caught. It is a first
// line, not the whole story — a model-based moderation pass (full CMP-12) and an
// output check come later; see ROADMAP.md.
//
// Design rules:
//  - Precision over recall: a false refusal of a legitimate tool is worse here
//    than missing an exotic phrasing, which the model's own refusal still backs.
//  - One user-facing message per outcome (no preachy, category-specific lectures
//    that could be probed); the matched category is logged server-side only.

export type SafetyCategory =
  | "malware"
  | "phishing"
  | "weapons"
  | "drugs"
  | "csam"
  | "self_harm"
  | "surveillance";

export interface SafetyVerdict {
  allowed: boolean;
  /** Server-side only — for logging/metrics, never shown to the user verbatim. */
  category?: SafetyCategory;
  /** Honest, non-judgmental message to surface when a request is refused. */
  message?: string;
}

const GENERIC_REFUSAL =
  "I can't build that — it looks like it's meant to harm people, steal data, or " +
  "break the law, which is out of scope. Tell me what you're actually trying to " +
  "get done and I'll suggest a tool I can build.";

// Self-harm gets a supportive message rather than a flat refusal.
const SELF_HARM_MESSAGE =
  "I can't build that. If you're going through something, you don't have to face " +
  "it alone — you can reach a trained counselor any time by calling or texting 988 " +
  "(in the US) or visiting https://findahelpline.com. I'm happy to build something " +
  "supportive instead, like a mood journal or a grounding-exercise timer.";

interface Rule {
  category: SafetyCategory;
  // Each rule fires only when intent + object co-occur, keeping precision high.
  patterns: RegExp[];
}

const RULES: Rule[] = [
  {
    category: "malware",
    patterns: [
      /\b(keylogger|ransomware|rootkit|botnet|spyware|trojan|worm\s+virus|computer\s+virus)\b/i,
      /\bsteal(?:ing|s|er)?\b[^.?!]{0,40}\b(passwords?|credentials?|logins?|cookies|session\s+tokens?|identit(?:y|ies)|credit\s*cards?)\b/i,
      /\b(crack|brute[-\s]?force|bypass|defeat)\b[^.?!]{0,30}\b(password|2fa|login|authentication|paywall|drm)\b/i,
      /\bexfiltrat\w*\b/i,
    ],
  },
  {
    category: "phishing",
    patterns: [
      /\bphish\w*\b/i,
      /\b(fake|clone|spoof|replica\s+of\s+a)\b[^.?!]{0,30}\b(login|sign[-\s]?in|bank|paypal|wallet|account)\b[^.?!]{0,20}\b(page|site|screen|form|portal)\b/i,
      /\bharvest\b[^.?!]{0,30}\b(credentials?|logins?|passwords?|card\s+numbers?)\b/i,
    ],
  },
  {
    category: "weapons",
    patterns: [
      /\b(build|make|manufacture|assemble|synthesi[sz]e|3d[-\s]?print|instructions?\s+for)\b[^.?!]{0,40}\b(bomb|explosive|pipe\s*bomb|ied|grenade|nerve\s+agent|chemical\s+weapon|bioweapon|ghost\s+gun|untraceable\s+(?:gun|firearm)|silencer|suppressor)\b/i,
    ],
  },
  {
    category: "drugs",
    patterns: [
      /\b(synthesi[sz]e|manufacture|cook|produce|make|extract)\b[^.?!]{0,30}\b(meth(?:amphetamine)?|fentanyl|cocaine|crack|mdma|ecstasy|heroin|lsd)\b/i,
    ],
  },
  {
    category: "csam",
    patterns: [
      /\b(child|children|minor|minors|underage|under[-\s]?age|preteen|pre[-\s]?teen|kid|kids)\b[^.?!]{0,40}\b(sexual|sexuali[sz]ed|porn\w*|nude|nudes|naked|explicit|csam|cp)\b/i,
      /\b(sexual|porn\w*|nude|explicit)\b[^.?!]{0,40}\b(child|children|minor|minors|underage|preteen|kid|kids)\b/i,
    ],
  },
  {
    category: "self_harm",
    patterns: [
      /\b(how\s+to|best\s+way\s+to|help\s+me|plan\s+to|tool\s+to)\b[^.?!]{0,30}\b(kill\s+myself|end\s+my\s+life|commit\s+suicide|hurt\s+myself|harm\s+myself|starve\s+myself)\b/i,
      /\b(suicide|self[-\s]?harm)\b[^.?!]{0,20}\b(method|plan|guide|how)\b/i,
    ],
  },
  {
    category: "surveillance",
    patterns: [
      /\b(track|spy\s+on|monitor|eavesdrop\s+on|secretly\s+record|covertly\s+record)\b[^.?!]{0,40}\b(without\s+(?:their|his|her|your|the\s+person'?s)\s+(?:consent|knowledge|permission)|my\s+ex|my\s+girlfriend|my\s+boyfriend|my\s+spouse|my\s+partner|someone\s+secretly)\b/i,
      /\bstalk(?:er|ing|erware)?\b/i,
    ],
  },
];

/** Classify a build prompt. Returns `{ allowed: true }` for anything that isn't
 *  a clear-cut harmful request. */
export function classifyPrompt(prompt: string): SafetyVerdict {
  const text = prompt.normalize("NFKC");
  for (const rule of RULES) {
    if (rule.patterns.some((re) => re.test(text))) {
      return {
        allowed: false,
        category: rule.category,
        message: rule.category === "self_harm" ? SELF_HARM_MESSAGE : GENERIC_REFUSAL,
      };
    }
  }
  return { allowed: true };
}
