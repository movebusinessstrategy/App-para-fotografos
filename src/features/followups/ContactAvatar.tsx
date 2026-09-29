import { useEffect, useRef, useState } from 'react';
import { getInitials, useDealAvatar } from '../../components/vendas/dealAvatar';
import { invalidateCachedAvatar } from '../chat/utils/contactCache';

function Photo({ phone, name }: { phone?: string | null; name?: string | null }) {
  const [revision, setRevision] = useState(0);
  const url = useDealAvatar(phone, revision);
  const [failed, setFailed] = useState<string | null>(null);
  function retryPhoto() {
    setFailed(url);
    if (revision || !phone) return;
    invalidateCachedAvatar(phone.replace(/\D/g, ''));
    setRevision(1);
  }
  if (!url || failed === url) return <>{getInitials(name)}</>;
  return <img src={url} alt="" loading="lazy" referrerPolicy="no-referrer"
    onError={retryPhoto} className="h-full w-full rounded-full object-cover" />;
}

// Só consulta fotos de cards visíveis, inclusive nas colunas com rolagem própria.
export function ContactAvatar({ phone, name }: { phone?: string | null; name?: string | null }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: '80px' });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return <span ref={ref} aria-hidden="true"
    className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gray-100 text-[11px] font-semibold text-gray-500 dark:bg-gray-700 dark:text-gray-200">
    {visible ? <Photo key={phone} phone={phone} name={name} /> : getInitials(name)}
  </span>;
}
