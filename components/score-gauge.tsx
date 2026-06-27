import { scoreTone } from "@/lib/format";

export function ScoreGauge({ score, size = 200 }: { score: number; size?: number }) {
  const tone = scoreTone(score);
  const stroke = 14;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.max(0, Math.min(100, score)) / 100);
  const center = size / 2;

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth={stroke}
        />
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={tone.ring}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ filter: `drop-shadow(0 0 8px ${tone.ring}88)`, transition: "stroke-dashoffset 1s ease" }}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-5xl font-bold tabular-nums" style={{ color: tone.ring }}>
          {score}
        </span>
        <span className="text-xs uppercase tracking-widest text-white/40">SEO SCORE</span>
        <span className={`mt-1 text-sm font-medium ${tone.className}`}>{tone.label}</span>
      </div>
    </div>
  );
}
