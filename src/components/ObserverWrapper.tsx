import { ReactNode, useEffect, useRef } from 'react';

interface ObserverWrapperProps {
  children: ReactNode;
  onIntersect: () => void;
}

export function ObserverWrapper({ children, onIntersect }: ObserverWrapperProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          onIntersect();
        }
      },
      { threshold: 0.6 } // 60% 이상 보일 때 연도 업데이트
    );

    if (ref.current) {
      observer.observe(ref.current);
    }

    return () => observer.disconnect();
  }, [onIntersect]);

  return <div ref={ref}>{children}</div>;
}
