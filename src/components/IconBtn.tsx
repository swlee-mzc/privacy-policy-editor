import type { ButtonHTMLAttributes } from 'react';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'danger' | 'ghost';
};

export function IconBtn({ variant = 'default', className, children, ...rest }: Props) {
  const cls = ['icon-btn'];
  if (variant === 'danger') cls.push('danger');
  if (variant === 'ghost') cls.push('ghost');
  if (className) cls.push(className);
  return (
    <button type="button" className={cls.join(' ')} {...rest}>
      {children}
    </button>
  );
}
