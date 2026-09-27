/**
 * Deterministic SVG greenhouse illustrations (offline-safe stand-ins for the
 * reference photos). Crop changes the plant/fruit accents.
 */

const CROP_COLORS: Record<string, { leaf: string; leafDark: string; fruit: string }> = {
  Tomato: { leaf: "#3f9d54", leafDark: "#2f7a41", fruit: "#e05252" },
  Cucumber: { leaf: "#3b8f4e", leafDark: "#2c6e3c", fruit: "#57a05e" },
  Lettuce: { leaf: "#7cbf5c", leafDark: "#5da344", fruit: "#a9d98a" },
  Spinach: { leaf: "#3e8f49", leafDark: "#2e6f39", fruit: "#54a35f" },
  Strawberry: { leaf: "#4a9d55", leafDark: "#37793f", fruit: "#e05a6d" },
  Chili: { leaf: "#3f9d54", leafDark: "#2f7a41", fruit: "#d84545" },
  "Bell Pepper": { leaf: "#43984f", leafDark: "#33763d", fruit: "#e2a23c" },
  Broccoli: { leaf: "#4c9459", leafDark: "#3a7245", fruit: "#39714a" },
  Melon: { leaf: "#5aab52", leafDark: "#458a3f", fruit: "#d9c26a" },
  Default: { leaf: "#4a9d55", leafDark: "#37793f", fruit: "#c9d8b6" },
};

export function GreenhouseArt({
  crop,
  variant = "interior",
  className = "",
}: {
  crop: string;
  variant?: "interior" | "landscape";
  className?: string;
}) {
  const c = CROP_COLORS[crop] ?? CROP_COLORS.Default;

  if (variant === "landscape") {
    return (
      <svg viewBox="0 0 320 180" className={className} preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id={`sky-${crop.replace(/\W/g, "")}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#bfe0f2" />
            <stop offset="100%" stopColor="#e8f3e4" />
          </linearGradient>
        </defs>
        <rect width="320" height="180" fill={`url(#sky-${crop.replace(/\W/g, "")})`} />
        <path d="M0 96 L52 52 L104 96 Z" fill="#9db8a4" opacity="0.75" />
        <path d="M76 96 L138 40 L200 96 Z" fill="#8aa891" opacity="0.8" />
        <rect y="96" width="320" height="84" fill="#7fae6a" />
        <rect y="96" width="320" height="10" fill="#6d9c5b" opacity="0.7" />
        {/* field rows */}
        {[0, 1, 2, 3].map((i) => (
          <rect key={i} x="12" y={116 + i * 14} width="296" height="4.5" rx="2.25" fill={c.leafDark} opacity={0.35 + i * 0.12} />
        ))}
        {/* greenhouse at right */}
        <g>
          <path d="M206 100 L258 62 L310 100 Z" fill="#dfe9ee" stroke="#ffffff" strokeWidth="3" />
          <path d="M212 100 L258 68 L304 100 Z" fill="#cfe3ee" opacity="0.85" />
          <rect x="206" y="100" width="104" height="5" fill="#eef4f7" />
          <path d="M258 66 L258 100" stroke="#ffffff" strokeWidth="2.5" />
          {[0, 1, 2].map((i) => (
            <circle key={i} cx={234 + i * 24} cy={92} r="5" fill={c.leaf} />
          ))}
        </g>
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 200 120" className={className} preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id={`in-sky-${crop.replace(/\W/g, "")}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#cfe7f3" />
          <stop offset="100%" stopColor="#eaf4e6" />
        </linearGradient>
      </defs>
      <rect width="200" height="120" fill={`url(#in-sky-${crop.replace(/\W/g, "")})`} />
      {/* glass gable */}
      <path d="M8 66 L100 14 L192 66 Z" fill="#dcebf2" stroke="#f4f8fa" strokeWidth="3" opacity="0.95" />
      <path d="M100 14 L100 66" stroke="#f4f8fa" strokeWidth="2.5" />
      <path d="M8 66 L192 66" stroke="#f4f8fa" strokeWidth="3" />
      <path d="M30 66 L100 28 M170 66 L100 28" stroke="#f4f8fa" strokeWidth="1.6" opacity="0.8" />
      {/* soil bed */}
      <rect y="66" width="200" height="54" fill="#8a6a4f" />
      <rect y="66" width="200" height="8" fill="#75593f" />
      {/* plant rows */}
      {[0, 1, 2].map((row) => {
        const y = 82 + row * 16;
        const scale = 1 - row * 0.16;
        return (
          <g key={row} opacity={1 - row * 0.22}>
            {Array.from({ length: 7 }, (_, i) => {
              const x = 18 + i * 27 + row * 6;
              const h = 22 * scale;
              return (
                <g key={i}>
                  <path d={`M${x} ${y} q 2 -${h * 0.7} 0 -${h}`} stroke={c.leafDark} strokeWidth="2" fill="none" />
                  <ellipse cx={x - 4} cy={y - h * 0.45} rx="4.4" ry="2.6" fill={c.leaf} transform={`rotate(-24 ${x - 4} ${y - h * 0.45})`} />
                  <ellipse cx={x + 4} cy={y - h * 0.6} rx="4.4" ry="2.6" fill={c.leaf} transform={`rotate(24 ${x + 4} ${y - h * 0.6})`} />
                  {i % 2 === 0 && row < 2 && <circle cx={x + 3} cy={y - h * 0.28} r={2.4 * scale} fill={c.fruit} />}
                </g>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}
