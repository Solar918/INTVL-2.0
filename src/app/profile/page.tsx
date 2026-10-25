'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

export default function ProfileIndexRedirect() {
  const router = useRouter();

  useEffect(() => {
    fetch('/api/auth/me', { cache: 'no-store' })
      .then((r) => r.json())
      .then((raw) => {
        const data = raw as {
          authenticated?: boolean;
          user?: { id?: string } | null;
        };
        if (data?.authenticated && data?.user?.id) {
          router.replace(`/profile/${data.user.id}`);
        } else {
          router.replace('/login');
        }
      })
      .catch(() => router.replace('/'));
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-carbon-950">
      <Loader2 className="h-7 w-7 animate-spin text-neon-cyan" />
    </div>
  );
}
