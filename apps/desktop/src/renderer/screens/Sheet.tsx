import { useEffect, useRef, type ReactNode } from 'react';
import { motion } from 'motion/react';

export function Sheet({ title, onClose, children, testId }: { title: string; onClose: () => void; children: ReactNode; testId?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => prev?.focus();
  }, []);
  return (
    <div className="fixed inset-0 z-10 flex justify-end bg-bg/50" onClick={onClose}>
      <motion.div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid={testId}
        initial={{ x: 40, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ duration: 0.2 }}
        className="h-full w-[520px] max-w-full overflow-y-auto border-l border-hairline bg-raised p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-6 flex items-center">
          <h2 className="font-display text-3xl">{title}</h2>
          <button onClick={onClose} className="ml-auto rounded-full border border-hairline px-3 py-1 text-sm" aria-label="Close">Esc</button>
        </div>
        {children}
      </motion.div>
    </div>
  );
}
