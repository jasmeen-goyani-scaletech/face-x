import type { HTMLAttributes } from 'react';

export default function Card({ className = '', children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={['rounded-l border border-line bg-surface p-5 sm:p-6 shadow-sm transition-shadow duration-200 hover:shadow-md focus-within:shadow-md motion-reduce:transition-none', className].join(' ')}
      {...rest}
    >
      {children}
    </div>
  );
}
