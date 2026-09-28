import { AlertCircleIcon, AlertTriangleIcon, CheckIcon, InfoIcon, MailIcon } from './Icons';

type Level = 'info' | 'success' | 'warning' | 'danger';

const LEVEL_CLASSES: Record<Level, string> = {
  info: 'bg-info-soft text-info',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger'
};

const LEVEL_ICON: Record<Level, React.ComponentType<{ size?: number }>> = {
  info: InfoIcon,
  success: CheckIcon,
  warning: AlertTriangleIcon,
  danger: AlertCircleIcon
};

export default function Alert({
  level,
  title,
  children,
  icon
}: {
  level: Level;
  title: string;
  children?: React.ReactNode;
  icon?: 'mail';
}) {
  const Icon = icon === 'mail' ? MailIcon : LEVEL_ICON[level];
  return (
    <div className={['flex gap-3 rounded-m px-4 py-3 text-sm mb-4', LEVEL_CLASSES[level]].join(' ')}>
      <Icon size={18} />
      <div>
        <div className="font-bold mb-0.5">{title}</div>
        {children && <p className="opacity-90 m-0">{children}</p>}
      </div>
    </div>
  );
}
