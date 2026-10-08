import { useEffect, useRef, useState } from 'react';

/** 生成画面で見た画像は、新着として再通知しない。 */
export function useLatestImageNotice(latestId: string | undefined, viewingGallery: boolean) {
  const [unseenId, setUnseenId] = useState<string | null>(null);
  const lastSeenLatest = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (viewingGallery || !latestId) setUnseenId(null);
    else if (latestId !== lastSeenLatest.current) setUnseenId(latestId);
    lastSeenLatest.current = latestId;
  }, [latestId, viewingGallery]);
  return { unseenId, dismiss: () => setUnseenId(null) };
}
