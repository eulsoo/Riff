import { ReactNode, useEffect, useRef } from 'react';

interface ObserverWrapperProps {
  children: ReactNode;
  onIntersect: () => void;
}

export function ObserverWrapper({ children, onIntersect }: ObserverWrapperProps) {
  const ref = useRef<HTMLDivElement>(null);

  const onIntersectRef = useRef(onIntersect);

  useEffect(() => {
    onIntersectRef.current = onIntersect;
  }, [onIntersect]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          onIntersectRef.current();
        }
      },
      { threshold: 0.6 } // 60% 이상 보일 때 연도 업데이트
    );

    if (ref.current) {
      observer.observe(ref.current);
    }

    return () => observer.disconnect();
  }, []);

  return <div ref={ref}>{children}</div>;
}
