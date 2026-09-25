import { CANDIDATE_SIZES, SPINNER_CANDIDATES } from '@/features/dev/utils/spinner-candidates'

// Reuses the spinner's own utility, so colours and rotation match what ships.
export function SpinnerCandidates() {
  return (
    <div className='grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-(--density-control-gap)'>
      {SPINNER_CANDIDATES.map((candidate) => (
        <div
          className='bg-background flex flex-col gap-3 rounded-md p-(--density-section-padding)'
          key={candidate.id}
        >
          <span className='text-xs font-medium'>{candidate.label}</span>
          <div className='flex items-center gap-4'>
            {CANDIDATE_SIZES.map((size) => (
              <svg
                aria-hidden='true'
                className='spinner-bands'
                fill='none'
                key={size}
                style={{ width: size, height: size }}
                viewBox='0 0 16 16'
              >
                {candidate.rings.map((ring) => (
                  <circle
                    cx='8'
                    cy='8'
                    key={ring.radius}
                    r={ring.radius}
                    strokeDasharray={ring.dash}
                    strokeLinecap={candidate.linecap}
                    strokeWidth={candidate.stroke}
                  />
                ))}
              </svg>
            ))}
          </div>
          <span className='text-muted-foreground text-2xs'>12 · 16 · 24 · 40px</span>
        </div>
      ))}
    </div>
  )
}
