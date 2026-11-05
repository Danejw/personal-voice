/** Visual-only cursor, positioned by the same native Windows motion that injects input. */
export default function AssistantPointer() {
  return (
    <div className="assistant-pointer" aria-hidden="true">
      <svg width="52" height="52" viewBox="0 0 52 52" role="presentation">
        <defs>
          <linearGradient id="pv-pointer-gradient" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#86f4e6" />
            <stop offset="1" stopColor="#38aaff" />
          </linearGradient>
        </defs>
        <circle cx="12" cy="12" r="11" fill="#42d9d0" fillOpacity=".12" stroke="#54cde6" strokeOpacity=".65" strokeWidth="1.5" />
        <path d="M12 5 L12 30 L18 23 L24 34 L29 31 L23 20 L33 19 Z"
          fill="url(#pv-pointer-gradient)" stroke="#05151d" strokeWidth="2.6" strokeLinejoin="round"/>
        <rect x="27" y="29" width="20" height="15" rx="6" fill="#0b2530"/>
        <text x="37" y="40" fill="#9ff8e5" textAnchor="middle" fontSize="10" fontWeight="800" fontFamily="system-ui, sans-serif">PV</text>
      </svg>
    </div>
  );
}
