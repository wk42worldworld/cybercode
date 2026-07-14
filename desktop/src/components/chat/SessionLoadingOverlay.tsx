export function SessionLoadingOverlay() {
  return (
    <div className="flex-1 flex flex-col overflow-y-auto px-[24px] pt-10 pb-4 animate-fade-in">
      <div data-chat-content-column className="w-full max-w-[878px] mx-auto flex flex-col gap-8">

        {/* Assistant turn */}
        <div className="flex gap-3 items-start">
          <div className="w-6 h-6 rounded-full skeleton-shimmer shrink-0 mt-0.5" />
          <div className="flex flex-col gap-2.5 flex-1 max-w-[540px]">
            <div className="h-3 rounded-full skeleton-shimmer w-[88%]" />
            <div className="h-3 rounded-full skeleton-shimmer w-[63%]" />
            <div className="h-3 rounded-full skeleton-shimmer w-[76%]" />
          </div>
        </div>

        {/* User turn */}
        <div className="flex justify-end">
          <div className="h-9 rounded-lg skeleton-shimmer w-[180px]" />
        </div>

        {/* Assistant turn */}
        <div className="flex gap-3 items-start">
          <div className="w-6 h-6 rounded-full skeleton-shimmer shrink-0 mt-0.5" />
          <div className="flex flex-col gap-2.5 flex-1 max-w-[540px]">
            <div className="h-3 rounded-full skeleton-shimmer w-[91%]" />
            <div className="h-3 rounded-full skeleton-shimmer w-[79%]" />
            <div className="h-3 rounded-full skeleton-shimmer w-[54%]" />
            <div className="h-3 rounded-full skeleton-shimmer w-[84%]" />
          </div>
        </div>

        {/* User turn */}
        <div className="flex justify-end">
          <div className="h-9 rounded-lg skeleton-shimmer w-[130px]" />
        </div>

        {/* Assistant turn */}
        <div className="flex gap-3 items-start">
          <div className="w-6 h-6 rounded-full skeleton-shimmer shrink-0 mt-0.5" />
          <div className="flex flex-col gap-2.5 flex-1 max-w-[540px]">
            <div className="h-3 rounded-full skeleton-shimmer w-[67%]" />
            <div className="h-3 rounded-full skeleton-shimmer w-[82%]" />
            <div className="h-3 rounded-full skeleton-shimmer w-[45%]" />
          </div>
        </div>

      </div>
    </div>
  )
}
