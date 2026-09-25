import React from 'react';

export const LoginIllustration: React.FC<{ className?: string }> = ({ className = "w-full max-w-[360px]" }) => {
  return (
    <div className={`flex items-center justify-center select-none ${className}`}>
      <svg
        viewBox="0 0 360 260"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="w-full h-auto drop-shadow-sm"
      >
        {/* Soft Background Cloud / Blob */}
        <path
          d="M60 140C40 140 25 155 25 175C25 195 40 210 60 210H300C325 210 345 190 345 165C345 142 328 123 306 120C302 95 280 75 254 75C248 75 242 76 236 79C225 55 200 40 172 40C138 40 110 65 106 98C93 90 77 88 64 96C46 107 42 128 50 145C53 143 56 140 60 140Z"
          fill="#EEF3FC"
        />

        {/* Financial Growth Bar Chart */}
        <rect x="75" y="135" width="22" height="95" rx="3" fill="#6B91E8" />
        <rect x="115" y="90" width="22" height="140" rx="3" fill="#527CE0" />
        <rect x="155" y="125" width="22" height="105" rx="3" fill="#6B91E8" />
        <rect x="195" y="65" width="22" height="165" rx="3" fill="#3B69D6" />
        <rect x="235" y="100" width="22" height="130" rx="3" fill="#527CE0" />

        {/* Dynamic Growth Trend Arrow */}
        <path
          d="M60 155 L115 110 L155 138 L200 80 L255 45"
          stroke="#F59E0B"
          strokeWidth="4.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <polygon points="243,45 260,40 255,57" fill="#F59E0B" />

        {/* Banknotes (Cash) */}
        {/* Note 1 (Floating right) */}
        <g transform="rotate(-8 230 150)">
          <rect x="210" y="135" width="46" height="24" rx="3" fill="#22C55E" stroke="#16A34A" strokeWidth="1.5" />
          <rect x="214" y="138" width="38" height="18" rx="2" fill="none" stroke="#DCFCE7" strokeWidth="1" strokeDasharray="2 2" />
          <circle cx="233" cy="147" r="5" fill="#DCFCE7" />
          <circle cx="233" cy="147" r="3" fill="#16A34A" />
        </g>

        {/* Note 2 (Floating mid-left) */}
        <g transform="rotate(6 170 170)">
          <rect x="150" y="160" width="44" height="22" rx="3" fill="#16A34A" stroke="#15803D" strokeWidth="1.5" />
          <rect x="154" y="163" width="36" height="16" rx="2" fill="none" stroke="#DCFCE7" strokeWidth="1" />
          <circle cx="172" cy="171" r="4.5" fill="#DCFCE7" />
          <circle cx="172" cy="171" r="2.5" fill="#15803D" />
        </g>

        {/* Gold Coins Stack */}
        <g transform="translate(145, 205)">
          <ellipse cx="14" cy="22" rx="12" ry="4.5" fill="#D97706" />
          <ellipse cx="14" cy="19" rx="12" ry="4.5" fill="#F59E0B" />
          <ellipse cx="14" cy="16" rx="12" ry="4.5" fill="#FBBF24" />
          <ellipse cx="14" cy="13" rx="12" ry="4.5" fill="#FCD34D" />
          <ellipse cx="28" cy="23" rx="10" ry="4" fill="#D97706" />
          <ellipse cx="28" cy="20" rx="10" ry="4" fill="#F59E0B" />
          <ellipse cx="28" cy="17" rx="10" ry="4" fill="#FBBF24" />
        </g>

        {/* Money Sacks (Burlap Bags) */}
        {/* Large Sack */}
        <g transform="translate(165, 175)">
          {/* Tied top neck */}
          <path d="M12 12C10 8 8 5 12 3C16 1 18 6 16 12Z" fill="#F59E0B" />
          <path d="M10 11C13 12 15 12 18 11" stroke="#B45309" strokeWidth="2" strokeLinecap="round" />
          {/* Main sack pouch */}
          <path
            d="M5 12C2 17 0 28 3 36C6 44 24 45 27 36C30 28 28 17 25 12C21 13 9 13 5 12Z"
            fill="#FBBF24"
            stroke="#D97706"
            strokeWidth="1.5"
          />
          {/* Bag crease / shadow */}
          <path d="M10 24C14 26 18 26 21 23" stroke="#D97706" strokeWidth="1.5" strokeLinecap="round" />
        </g>

        {/* Small Sack */}
        <g transform="translate(185, 185)">
          <path d="M10 10C8 6 6 4 10 2C13 1 15 5 13 10Z" fill="#F59E0B" />
          <path d="M8 9C10 10 12 10 14 9" stroke="#B45309" strokeWidth="1.5" />
          <path
            d="M4 10C2 14 0 23 2 30C5 36 19 37 22 30C24 23 23 14 20 10C17 11 7 11 4 10Z"
            fill="#F59E0B"
            stroke="#D97706"
            strokeWidth="1.2"
          />
        </g>

        {/* Vault / Bank Safe Box */}
        <g transform="translate(205, 170)">
          {/* Shadow */}
          <rect x="4" y="52" width="56" height="6" rx="3" fill="#94A3B8" opacity="0.3" />
          {/* Safe Outer Frame */}
          <rect x="4" y="4" width="56" height="50" rx="6" fill="#D3DCE6" stroke="#94A3B8" strokeWidth="2" />
          {/* Safe Inner Bevel Door */}
          <rect x="8" y="8" width="48" height="42" rx="4" fill="#E2E8F0" stroke="#CBD5E1" strokeWidth="1.5" />
          {/* Corner Rivets */}
          <circle cx="12" cy="12" r="1.5" fill="#64748B" />
          <circle cx="52" cy="12" r="1.5" fill="#64748B" />
          <circle cx="12" cy="46" r="1.5" fill="#64748B" />
          <circle cx="52" cy="46" r="1.5" fill="#64748B" />
          {/* Combination Dial Outer */}
          <circle cx="32" cy="29" r="13" fill="#CBD5E1" stroke="#94A3B8" strokeWidth="1.5" />
          <circle cx="32" cy="29" r="9" fill="#F1F5F9" />
          {/* Dial Marks */}
          <circle cx="32" cy="22" r="1" fill="#475569" />
          <circle cx="39" cy="29" r="1" fill="#475569" />
          <circle cx="32" cy="36" r="1" fill="#475569" />
          <circle cx="25" cy="29" r="1" fill="#475569" />
          {/* Turn Wheel / Handle */}
          <line x1="28" y1="29" x2="36" y2="29" stroke="#334155" strokeWidth="2.5" strokeLinecap="round" />
          <line x1="32" y1="25" x2="32" y2="33" stroke="#334155" strokeWidth="2.5" strokeLinecap="round" />
          <circle cx="32" cy="29" r="2.5" fill="#1E293B" />
          {/* Safe Hinges on right */}
          <rect x="58" y="14" width="3" height="8" rx="1" fill="#64748B" />
          <rect x="58" y="38" width="3" height="8" rx="1" fill="#64748B" />
        </g>

        {/* Planter Box with Plants & Flowers */}
        <g transform="translate(68, 195)">
          {/* Green Sprouting Leaves */}
          <path d="M8 12 Q5 4 2 0 Q10 2 12 12" fill="#22C55E" />
          <path d="M16 12 Q18 2 24 -2 Q24 6 18 12" fill="#16A34A" />
          <path d="M26 12 Q30 3 38 1 Q34 8 28 12" fill="#22C55E" />
          <path d="M38 12 Q42 5 48 3 Q45 9 40 12" fill="#16A34A" />
          {/* Little Flowers */}
          <circle cx="3" cy="2" r="3" fill="#F97316" />
          <circle cx="3" cy="2" r="1.5" fill="#FDE047" />
          <circle cx="25" cy="0" r="3.5" fill="#EF4444" />
          <circle cx="25" cy="0" r="1.5" fill="#FDE047" />
          <circle cx="47" cy="4" r="3" fill="#F97316" />
          <circle cx="47" cy="4" r="1.5" fill="#FDE047" />
          {/* Planter Box Pot */}
          <rect x="0" y="12" width="55" height="16" rx="2" fill="#E06C75" />
          <rect x="-2" y="10" width="59" height="4" rx="1" fill="#D25660" />
        </g>
      </svg>
    </div>
  );
};
