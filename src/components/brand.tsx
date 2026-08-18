import { cn } from "@/lib/utils";

/** BharatVoice wordmark + waveform mark, used on the landing and dashboard. */
export function BharatVoiceMark({
  className,
  showWordmark = true,
}: {
  className?: string;
  showWordmark?: boolean;
}) {
  return (
    <span className={cn("flex flex-col items-start gap-3", className)}>
      <span className="relative flex size-9 shrink-0 items-center justify-center rounded-xl bg-saffron shadow-[inset_0_-2px_0_rgba(0,0,0,0.18)]">
        {/* waveform bars */}
        <span className="flex h-4 items-end gap-[3px]">
          {[10, 16, 22, 13, 18].map((height, i) => (
            <span
              key={i}
              className="w-[3px] rounded-full bg-black"
              style={{ height: `${height}px` }}
            />
          ))}
        </span>
      </span>
      {showWordmark && (
        <span className="flex flex-col leading-none">
          <span className="font-display text-[15px] font-bold tracking-tight text-black">
            BharatVoice
          </span>
          <span className="text-[9.5px] font-semibold uppercase tracking-[0.22em] text-black/70">
            AI · भारतवॉइस
          </span>
        </span>
      )}
    </span>
  );
}
