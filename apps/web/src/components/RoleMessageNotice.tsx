import React, { useState, useEffect } from 'react';
import { UserSession } from '@pb/types';
import { apiRequest } from '../api/client.js';
import { Megaphone } from 'lucide-react';

interface RoleMessageNoticeProps {
  user: UserSession | null;
}

interface MyMessageData {
  message: string;
  flashMessage: string;
  updatedAt: string | null;
}

// Message = a standing red "MESSAGE / संदेश" ticker bar shown under the navbar on every page
// for that role — matches the live pbmax1.com reference exactly (no dismiss button there;
// it stays up as long as the admin has that role's message set). Flash Message = a one-time
// pop-up per session for that role, meant for urgent/warning-style announcements — shown
// once until acknowledged or changed.
export const RoleMessageNotice: React.FC<RoleMessageNoticeProps> = ({ user }) => {
  const [data, setData] = useState<MyMessageData | null>(null);
  const [showFlash, setShowFlash] = useState(false);

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const res = await apiRequest<MyMessageData>('/messages/mine');
        if (res.data) {
          setData(res.data);

          const flashKey = `role_flash_seen_${user.roleId}`;
          setShowFlash(!!res.data.flashMessage && sessionStorage.getItem(flashKey) !== res.data.flashMessage);
        }
      } catch (err) {
        console.warn('Failed to load role message:', err);
      }
    })();
  }, [user?.roleId]);

  if (!user || !data) return null;

  const handleCloseFlash = () => {
    sessionStorage.setItem(`role_flash_seen_${user.roleId}`, data.flashMessage);
    setShowFlash(false);
  };

  return (
    <>
      {data.message && (
        <div className="flex items-stretch bg-[#e0344c] text-white text-xs font-bold overflow-hidden">
          <div className="bg-[#c41f38] px-4 py-2 flex-shrink-0 whitespace-nowrap tracking-wide">
            MESSAGE / संदेश
          </div>
          <div className="flex-1 overflow-hidden relative flex items-center">
            <div className="marquee-track whitespace-nowrap px-4 py-2">
              {data.message}
            </div>
          </div>
          <style>{`
            @keyframes role-message-marquee {
              0% { transform: translateX(100%); }
              100% { transform: translateX(-100%); }
            }
            .marquee-track {
              display: inline-block;
              animation: role-message-marquee 22s linear infinite;
            }
          `}</style>
        </div>
      )}

      {showFlash && data.flashMessage && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-[200] animate-in fade-in duration-150">
          <div className="bg-white rounded-lg shadow-2xl max-w-md w-full overflow-hidden border border-slate-300">
            <div className="bg-[#b91c1c] text-white px-4 py-2.5 flex items-center gap-2">
              <Megaphone className="h-4 w-4" />
              <h2 className="text-sm font-bold tracking-tight">Announcement</h2>
            </div>
            <div className="p-4 text-sm text-slate-800 font-medium leading-relaxed">
              {data.flashMessage}
            </div>
            <div className="px-4 pb-4 flex justify-end">
              <button
                type="button"
                onClick={handleCloseFlash}
                className="px-5 py-1.5 bg-[#1e3a8a] hover:bg-[#172554] text-white font-bold text-xs rounded shadow-xs"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
