import React from 'react';
import { ShieldAlert } from 'lucide-react';

// Full-page screen shown instead of the app (login included) when the API answers
// IP_BLOCKED — after 3 wrong logins in a row, or an admin block on Access Block.
export const IpBlockedScreen: React.FC<{ message: string; onRetry: () => void }> = ({ message, onRetry }) => (
  <div className="min-h-screen bg-[#1f3a6d] flex items-center justify-center p-4 font-sans">
    <div className="bg-white rounded-lg shadow-2xl max-w-md w-full p-8 text-center">
      <ShieldAlert className="w-14 h-14 text-rose-600 mx-auto mb-4" />
      <h1 className="text-xl font-bold text-slate-900 mb-2">Access Blocked</h1>
      <p className="text-sm text-slate-600 mb-6">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="px-8 py-2 bg-[#1662c6] hover:bg-[#1354ab] text-white font-bold text-sm rounded"
      >
        Retry
      </button>
    </div>
  </div>
);
