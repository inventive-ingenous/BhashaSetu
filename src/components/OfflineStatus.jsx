import { useEffect, useState } from 'react';
import { LuWifiOff } from 'react-icons/lu';
import { CloudCheck } from './icons';

function useOnline() {
  const [on, setOn] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const u = () => setOn(true);
    const d = () => setOn(false);
    window.addEventListener('online', u);
    window.addEventListener('offline', d);
    return () => {
      window.removeEventListener('online', u);
      window.removeEventListener('offline', d);
    };
  }, []);
  return on;
}

/**
 * Offline is a built-in strength, not a banner.
 * variant: 'card' (right panel) | 'pill' (sidebar) | 'chip' (compact, on dark backgrounds)
 */
export default function OfflineStatus({ variant = 'pill' }) {
  const online = useOnline();
  if (variant === 'card') {
    return (
      <div className="offline offline--card">
        <CloudCheck size={42} />
        <div>
          <p className="offline__title">
            Offline Mode <span className="offline__state"><i /> Ready</span>
          </p>
          <p className="offline__sub">Core features available without internet</p>
        </div>
      </div>
    );
  }
  return (
    <div className={`offline offline--${variant}`} role="status">
      {online ? <i className="offline__dot" /> : <LuWifiOff size={14} />}
      <span>{online ? 'Offline Ready' : 'Working offline'}</span>
    </div>
  );
}
